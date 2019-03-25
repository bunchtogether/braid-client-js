//      

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
  EventSubscribeRequest,
  EventSubscribeResponse,
  EventUnsubscribe,
  BraidEvent,
} = require('@bunchtogether/braid-messagepack');

/**
 * Class representing a credentials error
 */
class CredentialsError extends Error {
               
  constructor(message       , code       ) {
    super(message);
    this.name = 'CredentialsError';
    this.code = code;
  }
}

/**
 * Class representing a subscribe error
 */
class SubscribeError extends Error {
               
  constructor(message       , code       ) {
    super(message);
    this.name = 'SubscribeError';
    this.code = code;
  }
}

/**
 * Class representing an event subscribe error
 */
class EventSubscribeError extends Error {
               
  constructor(message       , code       ) {
    super(message);
    this.name = 'EventSubscribeError';
    this.code = code;
  }
}

/**
 * Class representing a Braid Server
 */
class Client extends EventEmitter {
<<<<<<< Updated upstream
=======
<<<<<<< Updated upstream
=======
<<<<<<< Updated upstream
=======

>>>>>>> Stashed changes
>>>>>>> Stashed changes
>>>>>>> Stashed changes
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
  }

  /**
   * Connects to a server.
   * @param {string} address Websocket URL of the server
   * @param {Object} [credentials] Credentials to send
   * @return {Promise<void>}
   */
  async open(address       , credentials         = {}) {
    this.address = address;
    this.credentials = credentials;

    const ws = new WebSocket(address);

    ws.onopen = () => {
      this.emit('open');
      this.ws = ws;
    };

    ws.onclose = (event) => {
      const { wasClean, reason, code } = event;
      console.log(`${wasClean ? 'Cleanly' : 'Uncleanly'} closed websocket connection to ${this.address} with code ${code}${reason ? `: ${reason}` : ''}`);
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
      const onError = (event       ) => {
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

  /**
   * Close connection to server.
   * @param {number} [code] Websocket close reason code to send to the server
   * @param {string} [reason] Websocket close reason to send to the server
   * @return {Promise<void>}
   */
  async close(code         , reason         ) {
    if (!this.ws) {
      return;
    }
    await new Promise((resolve, reject) => {
      const onClose = () => {
        this.removeListener('error', onError);
        resolve();
      };
      const onError = (event       ) => {
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
  async sendCredentials(credentials        ) {
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
  async subscribe(key        , callback                     ) {
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

  /**
   * Unsubscribe from updates on a key. If the callback parameter is not provided, all callbacks are unsubscribed.
   * @param {string} key Key to stop updates on
   * @param {(any, any) => void} [callback] Optional callback function
   * @return {Promise<void>}
   */
  unsubscribe(key        , callback                     ) {
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

  /**
   * Add a subscription handler to a key
   * @param {string} key Key to add handlers to
   * @param {(any, any) => void} callback Callback function
   * @return {Promise<void>}
   */
  addSubscriptionHandler(key        , callback                    ) {
    let handlers = this.subscriptionHandlers.get(key);
    if (!handlers) {
      handlers = new Map();
      this.subscriptionHandlers.set(key, handlers);
    }
    if (!handlers.has(callback)) {
      const setHandler = (k       , value    , previousValue     ) => {
        callback(value, previousValue);
      };
      const deleteHandler = (k       , previousValue    ) => {
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
  async addServerEventListener(name        , callback                  ) {
    if (!this.ws) {
      throw new Error('Unable to subscribe to event, not open');
    }
    let callbacks = this.eventSubscriptions.get(name);
    if (callbacks) {
      callbacks.add(callback);
      return;
    }
    callbacks = new Set();
    callbacks.add(callback);
    this.eventSubscriptions.set(name, callbacks);
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
    try {
      await responsePromise;
    } catch (error) {
      this.removeServerEventListener(name, callback);
      throw error;
    }
  }

  /**
   * Unsubscribe from a server event. If the callback parameter is not provided, all callbacks are unsubscribed.
   * @param {string} name Name of the event to stop listening
   * @param {(...any) => void} [callback] Callback
   * @return {Promise<void>}
   */
  removeServerEventListener(name        , callback                ) {
    const callbacks = this.eventSubscriptions.get(name);
    if (!callbacks) {
      return;
    }
    if (!this.ws) {
      throw new Error('Unable to unsubscribe from server event, not open');
    }
    if (callback) {
      callbacks.delete(callback);
      if (callbacks.size > 0) {
        return;
      }
    }
    this.eventSubscriptions.delete(name);
    this.ws.send(encode(new EventUnsubscribe(name)));
  }

            
                 
                      
                             
                                                         
                                                                                                                 
                
                                      
                          
}

module.exports = Client;
