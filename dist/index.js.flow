// @flow

const { EventEmitter } = require('events');
const WebSocket = require('isomorphic-ws');
const ObservedRemoveMap = require('observed-remove/dist/map');
const {
  encode,
  decode,
  Credentials,
  CredentialsResponse,
  DataDump,
  SubscribeRequest,
  SubscribeResponse,
  Unsubscribe,
  EventSubscribeRequest,
  EventSubscribeResponse,
  EventUnsubscribe,
  BraidEvent,
} = require('@bunchtogether/braid-messagepack');

/**
 * Class representing a credentials error
 */
class CredentialsError extends Error {
  code: number;
  constructor(message:string, code:number) {
    super(message);
    this.name = 'CredentialsError';
    this.code = code;
  }
}

/**
 * Class representing a subscribe error
 */
class SubscribeError extends Error {
  code: number;
  constructor(message:string, code:number) {
    super(message);
    this.name = 'SubscribeError';
    this.code = code;
  }
}

/**
 * Class representing an event subscribe error
 */
class EventSubscribeError extends Error {
  code: number;
  constructor(message:string, code:number) {
    super(message);
    this.name = 'EventSubscribeError';
    this.code = code;
  }
}

/**
 * Class representing a Braid Client
 */
class Client extends EventEmitter {
  /**
   * Create a Braid Client.
   */
  constructor() {
    super();
    this.data = new ObservedRemoveMap([], { bufferPublishing: 0 });
    this.timeoutDuration = 5000;
    this.subscriptions = new Set();
    this.eventSubscriptions = new Map();
    this.subscriptionHandlers = new Map();
    this.setMaxListeners(Infinity);
    this.reconnectAttempts = 0;
  }

  /**
   * Connects to a server.
   * @param {string} address Websocket URL of the server
   * @param {Object} [credentials] Credentials to send
   * @return {Promise<void>}
   */
  async open(address:string, credentials?:Object = {}) {
    this.shouldReconnect = true;
    this.address = address;
    this.credentials = credentials;

    const ws = new WebSocket(address);

    const heartbeatInterval = setInterval(() => {
      if (ws.readyState === 1) {
        ws.send(new Uint8Array([0]));
      }
    }, 5000);

    const flushInterval = setInterval(() => {
      this.data.flush();
    }, 30000);

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      this.emit('open');
      this.ws = ws;
    };

    ws.onclose = (event) => {
      clearInterval(heartbeatInterval);
      clearInterval(flushInterval);
      const { wasClean, reason, code } = event;
      console.log(`${wasClean ? 'Cleanly' : 'Uncleanly'} closed websocket connection to Braid server at ${this.address} with code ${code}${reason ? `: ${reason}` : ''}`);
      delete this.ws;
      this.emit('close', code, reason);
      this.reconnect();
    };

    ws.onmessage = (event) => {
      const { data } = event;
      const message = decode(data);
      if (message instanceof DataDump) {
        this.data.process(message.queue, true); // eslint-disable-line no-underscore-dangle
      } else if (message instanceof CredentialsResponse) {
        this.emit('credentialsResponse', ws, message.value.success, message.value.code, message.value.message);
      } else if (message instanceof SubscribeResponse) {
        this.emit('subscribeResponse', message.value.key, message.value.success, message.value.code, message.value.message);
      } else if (message instanceof EventSubscribeResponse) {
        this.emit('eventSubscribeResponse', message.value.name, message.value.success, message.value.code, message.value.message);
      } else if (message instanceof BraidEvent) {
        const callbacks = this.eventSubscriptions.get(message.name);
        if (!callbacks) {
          return;
        }
        for (const callback of callbacks) {
          callback(...message.args);
        }
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

    console.log(`Opened websocket connection to Braid server at ${this.address}`);

    if (credentials) {
      await this.sendCredentials(credentials);
    }

    const subscriptionPromises = [];

    for (const key of this.subscriptions) {
      subscriptionPromises.push(this.sendSubscribeRequest(key).catch((error) => {
        console.error(error);
        this.emit('error', error);
      }));
    }

    for (const name of this.eventSubscriptions.keys()) {
      subscriptionPromises.push(this.sendEventSubscribeRequest(name).catch((error) => {
        console.error(error);
        this.emit('error', error);
      }));
    }

    await Promise.all(subscriptionPromises);
  }

  async reconnect() {
    if (!this.shouldReconnect) {
      return;
    }
    this.reconnectAttempts += 1;
    clearTimeout(this.reconnectAttemptResetTimeout);
    const duration = this.reconnectAttempts > 5 ? 25000 + Math.round(Math.random() * 10000) : this.reconnectAttempts * this.reconnectAttempts * 1000;
    console.log(`Reconnect attempt ${this.reconnectAttempts} in ${Math.round(duration / 100) / 10} seconds`);
    await new Promise((resolve) => setTimeout(resolve, duration));
    this.open(this.address, this.credentials);
    this.reconnectAttemptResetTimeout = setTimeout(() => {
      this.reconnectAttempts = 0;
    }, 60000);
  }

  /**
   * Close connection to server.
   * @param {number} [code] Websocket close reason code to send to the server
   * @param {string} [reason] Websocket close reason to send to the server
   * @return {Promise<void>}
   */
  async close(code?: number, reason?: string) {
    if (!this.ws) {
      return;
    }
    this.shouldReconnect = false;
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

  /**
   * Send credentials to a server with an open connection.
   * @param {Object} [credentials] Credentials to send
   * @return {Promise<void>}
   */
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

  /**
   * Subscribe to updates on a key.
   * @param {string} key Key to request updates on
   * @param {(any, any) => void} [callback] Optional callback function
   * @return {Promise<void>}
   */
  async subscribe(key: string, callback?: (any, any) => void) {
    if (callback) {
      this.addSubscriptionHandler(key, callback);
    }
    if (!this.subscriptions.has(key)) {
      this.subscriptions.add(key);
      if (this.ws) {
        try {
          await this.sendSubscribeRequest(key);
        } catch (error) {
          this.unsubscribe(key, callback);
          throw error;
        }
      }
    }
    if (callback) {
      callback(this.data.get(key));
    }
  }

  /**
   * Send subscribe request to server
   * @param {string} key Key to request updates on
   * @return {Promise<void>}
   */
  async sendSubscribeRequest(key: string) {
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
    await responsePromise;
  }

  /**
   * Unsubscribe from updates on a key. If the callback parameter is not provided, all callbacks are unsubscribed.
   * @param {string} key Key to stop updates on
   * @param {(any, any) => void} [callback] Optional callback function
   * @return {Promise<void>}
   */
  unsubscribe(key: string, callback?: (any, any) => void) {
    if (!this.subscriptions.has(key)) {
      return;
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
    if (!this.ws) {
      return;
    }
    this.ws.send(encode(new Unsubscribe(key)));
  }

  /**
   * Add a subscription handler to a key
   * @param {string} key Key to add handlers to
   * @param {(any, any) => void} callback Callback function
   * @return {Promise<void>}
   */
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
      this.data.on('delete', deleteHandler);
    }
  }


  /**
   * Subscribe to a server event
   * @param {string} name Name of the event to listen for
   * @param {(...any) => void} callback Callback
   * @return {Promise<void>}
   */
  async addServerEventListener(name: string, callback: (...any) => void) {
    let callbacks = this.eventSubscriptions.get(name);
    if (callbacks) {
      callbacks.add(callback);
      return;
    }
    callbacks = new Set();
    callbacks.add(callback);
    this.eventSubscriptions.set(name, callbacks);
    if (this.ws) {
      try {
        await this.sendEventSubscribeRequest(name);
      } catch (error) {
        this.removeServerEventListener(name, callback);
        throw error;
      }
    }
  }

  /**
   * Send event subscribe request to server
   * @param {string} name Name of the event to listen for
   * @return {Promise<void>}
   */
  async sendEventSubscribeRequest(name: string) {
    const responsePromise = new Promise((resolve, reject) => {
      const handleEventSubscribeResponse = (n, success, code, message) => {
        if (n !== name) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('eventSubscribeResponse', handleEventSubscribeResponse);
        if (success) {
          resolve();
        } else {
          reject(new EventSubscribeError(message, code));
        }
      };
      const timeout = setTimeout(() => {
        this.removeListener('eventSubscribeResponse', handleEventSubscribeResponse);
        reject(new EventSubscribeError(`Event subscription response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504));
      }, this.timeoutDuration);
      this.on('eventSubscribeResponse', handleEventSubscribeResponse);
    });
    this.ws.send(encode(new EventSubscribeRequest(name)));
    await responsePromise;
  }

  /**
   * Unsubscribe from a server event. If the callback parameter is not provided, all callbacks are unsubscribed.
   * @param {string} name Name of the event to stop listening
   * @param {(...any) => void} [callback] Callback
   * @return {Promise<void>}
   */
  removeServerEventListener(name: string, callback?: (any) => void) {
    const callbacks = this.eventSubscriptions.get(name);
    if (!callbacks) {
      return;
    }
    if (callback) {
      callbacks.delete(callback);
      if (callbacks.size > 0) {
        return;
      }
    }
    this.eventSubscriptions.delete(name);
    if (!this.ws) {
      return;
    }
    this.ws.send(encode(new EventUnsubscribe(name)));
  }

  id:string;
  address:string;
  credentials: Object;
  subscriptions: Set<string>;
  eventSubscriptions: Map<string, Set<(...any) => void>>;
  subscriptionHandlers:Map<string, Map<(any, any) => void, [(string, any, any) => void, (string, any) => void]>>;
  ws: WebSocket;
  data:ObservedRemoveMap<string, any>;
  timeoutDuration: number;
  reconnectAttempts: number;
  shouldReconnect: boolean;
  reconnectAttemptResetTimeout: TimeoutID;
}

module.exports = Client;
