// @flow

const { EventEmitter } = require('events');
const WebSocket = require('isomorphic-ws');
const { ObservedRemoveMap } = require('observed-remove');
const {
  encode,
  decode,
  Credentials,
  CredentialsResponse,
  DataDump,
  SubscribeRequest,
  SubscribeResponse,
  Unsubscribe,
} = require('@bunchtogether/braid-messagepack');

class CredentialsError extends Error {
  code: number;
  constructor(message:string, code:number) {
    super(message);
    this.name = 'CredentialsError';
    this.code = code;
  }
}

class SubscribeError extends Error {
  code: number;
  constructor(message:string, code:number) {
    super(message);
    this.name = 'SubscribeError';
    this.code = code;
  }
}

class Client extends EventEmitter {
  constructor() {
    super();
    this.data = new ObservedRemoveMap([], { bufferPublishing: 0 });
    this.timeoutDuration = 5000;
    this.subscriptions = new Set();
    this.subscriptionHandlers = new Map();
  }

  async open(address:string, credentials?:Object = {}) {
    this.address = address;
    this.credentials = credentials;

    const ws = new WebSocket(address);

    ws.onopen = () => {
      this.emit('open');
      this.ws = ws;
    };

    ws.onclose = (event) => {
      const { wasClean, reason, code } = event;
      console.log(`${wasClean ? 'Cleanly' : 'Uncleanly'} closed websocket connection to ${this.address} with code ${code}: ${reason}`);
      delete this.ws;
      this.emit('close', code, reason);
    };

    ws.onmessage = (event) => {
      const { data } = event;
      const message = decode(data);
      if (message instanceof DataDump) {
        this.data.process(message.queue); // eslint-disable-line no-underscore-dangle
      } else if (message instanceof CredentialsResponse) {
        this.emit('credentialsResponse', ws, message.value.success, message.value.code, message.value.message);
      } else if (message instanceof SubscribeResponse) {
        this.emit('subscribeResponse', message.value.key, message.value.success, message.value.code, message.value.message);
      }
    };

    ws.onerror = (event) => {
      this.emit('error', event);
    };

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.removeListener('error', onError);
        resolve();
      };
      const onError = (event: Event) => {
        this.removeListener('open', onOpen);
        reject(event);
      };
      this.once('error', onError);
      this.once('open', onOpen);
    });

    if (credentials) {
      await this.sendCredentials(credentials);
    }
  }

  async close(code?: number, reason?: string) {
    if (!this.ws) {
      return;
    }
    await new Promise((resolve, reject) => {
      const onClose = () => {
        this.removeListener('error', onError);
        resolve();
      };
      const onError = (event: Event) => {
        this.removeListener('close', onClose);
        reject(event);
      };
      this.once('error', onError);
      this.once('close', onClose);
      this.ws.close(code, reason);
    });
  }

  async sendCredentials(credentials: Object) {
    if (!this.ws) {
      throw new Error('Unable to send credentials, not open');
    }
    const responsePromise = new Promise((resolve, reject) => {
      const handleCredentialsResponse = (success, code, message) => {
        clearTimeout(timeout);
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        if (success) {
          resolve();
        } else {
          reject(new CredentialsError(message, code));
        }
      };
      const timeout = setTimeout(() => {
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        reject(new CredentialsError(`Credentials response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504));
      }, this.timeoutDuration);
      this.on('credentialsResponse', handleCredentialsResponse);
    });
    this.ws.send(encode(new Credentials(credentials)));
    await responsePromise;
  }

  async subscribe(key: string, callback?: (any, any) => void) {
    if (!this.ws) {
      throw new Error('Unable to subscribe, not open');
    }
    if (callback) {
      this.addSubscriptionHandler(key, callback);
    }
    if (!this.subscriptions.has(key)) {
      const responsePromise = new Promise((resolve, reject) => {
        const handleSubscribeResponse = (k, success, code, message) => {
          if (k !== key) {
            return;
          }
          clearTimeout(timeout);
          this.removeListener('subscribeResponse', handleSubscribeResponse);
          if (success) {
            resolve();
          } else {
            reject(new SubscribeError(message, code));
          }
        };
        const timeout = setTimeout(() => {
          this.removeListener('subscribeResponse', handleSubscribeResponse);
          reject(new SubscribeError(`Subscription response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504));
        }, this.timeoutDuration);
        this.on('subscribeResponse', handleSubscribeResponse);
      });
      this.ws.send(encode(new SubscribeRequest(key)));
      this.subscriptions.add(key);
      try {
        await responsePromise;
      } catch (error) {
        this.unsubscribe(key, callback);
        throw error;
      }
    }
    if (callback) {
      callback(this.data.get(key));
    }
  }

  addSubscriptionHandler(key: string, callback: (any, any) => void) {
    let handlers = this.subscriptionHandlers.get(key);
    if (!handlers) {
      handlers = new Map();
      this.subscriptionHandlers.set(key, handlers);
    }
    if (!handlers.has(callback)) {
      const setHandler = (k:string, value:any, previousValue: any) => {
        callback(value, previousValue);
      };
      const deleteHandler = (k:string, previousValue:any) => {
        callback(undefined, previousValue);
      };
      handlers.set(callback, [setHandler, deleteHandler]);
      this.data.on('set', setHandler);
      this.data.on('set', deleteHandler);
    }
  }

  unsubscribe(key: string, callback?: (any, any) => void) {
    if (!this.subscriptions.has(key)) {
      return;
    }
    if (!this.ws) {
      throw new Error('Unable to unsubscribe, not open');
    }
    const handlers = this.subscriptionHandlers.get(key);
    if (handlers) {
      if (callback) {
        const dataHandlers = handlers.get(callback);
        if (!dataHandlers) {
          throw new Error(`Unable to unsubscribe to key ${key}, callback does not exist`);
        }
        const [setHandler, deleteHandler] = dataHandlers;
        this.data.removeListener('set', setHandler);
        this.data.removeListener('delete', deleteHandler);
        handlers.delete(callback);
        if (handlers.size > 0) {
          return;
        }
      }
      for (const [setHandler, deleteHandler] of handlers.values()) {
        this.data.removeListener('set', setHandler);
        this.data.removeListener('delete', deleteHandler);
      }
    }
    this.subscriptionHandlers.delete(key);
    this.subscriptions.delete(key);
    this.ws.send(encode(new Unsubscribe(key)));
  }

  id:string;
  address:string;
  credentials: Object;
  subscriptions: Set<string>;
  subscriptionHandlers:Map<string, Map<(any, any) => void, [(string, any, any) => void, (string, any) => void]>>;
  ws: WebSocket;
  data:ObservedRemoveMap<string, any>;
  timeoutDuration: number;
}

module.exports = Client;
