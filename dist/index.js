//      

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
  PublishRequest,
  PublishResponse,
  PublisherMessage,
  Unpublish,
} = require('@bunchtogether/braid-messagepack');
const baseLogger = require('./logger');

               
                                           
                                          
                                          
                                           
                                                
  

/**
 * Class representing a connection error
 */
class ConnectionError extends Error {
  constructor(message       ) {
    super(message);
    this.name = 'ConnectionError';
  }
}

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
                       
                          
  constructor(itemKey        , message       , code       ) {
    super(message);
    this.itemKey = itemKey;
    this.name = 'SubscribeError';
    this.code = code;
  }
}

/**
 * Class representing an event subscribe error
 */
class EventSubscribeError extends Error {
                       
                           
  constructor(itemName        , message       , code       ) {
    super(message);
    this.itemName = itemName;
    this.name = 'EventSubscribeError';
    this.code = code;
  }
}


/**
 * Class representing an publishing error
 */
class PublishError extends Error {
                       
                           
  constructor(itemName        , message       , code       ) {
    super(message);
    this.itemName = itemName;
    this.name = 'PublishError';
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
    /**
     * Primary data object. Like a native JS Map but with 'set' and 'delete' events.
     *
     * @type ObservedRemoveMap<K, V>
     * @public
     */
    this.data = new ObservedRemoveMap([], { bufferPublishing: 0 });
    this.timeoutDuration = 60000;
    this.subscriptions = new Set();
    this.receivers = new Set();
    this.eventSubscriptions = new Map();
    this.setMaxListeners(0);
    this.reconnectAttempts = 0;
    this.publishQueueMap = new Map();
    this.subscribeRequestPromises = new Map();
    this.eventSubscribeRequestPromises = new Map();
    this.publishRequestPromises = new Map();
    this.setReconnectHandler(() => true);
    this.logger = baseLogger;
  }

  /**
   * Set the reconnect handler. The handler determines if the reconnect should continue.
   * @param {(credentials: Object) => boolean} func - Credentials handler.
   * @return {void}
   */
  setReconnectHandler(func                     ) { // eslint-disable-line no-unused-vars
    this.reconnectHandler = func;
  }

  /**
   * Connects to a server.
   * @param {string} address Websocket URL of the server
   * @param {Object} [credentials] Credentials to send
   * @return {Promise<void>}
   */
  async open(address       , credentials         = {}) {
    if (this.ws) {
      throw new Error(`Connection to ${this.address} already open`);
    }

    clearTimeout(this.reconnectTimeout);

    this.shouldReconnect = true;
    this.address = address;

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
      let calculatedReason = reason;

      if (!calculatedReason) {
        if (code === 1000) {
          calculatedReason = 'Normal closure, meaning that the purpose for which the connection was established has been fulfilled.';
        } else if (code === 1001) {
          calculatedReason = 'An endpoint is "going away", such as a server going down or a browser having navigated away from a page.';
        } else if (code === 1002) {
          calculatedReason = 'An endpoint is terminating the connection due to a protocol error';
        } else if (code === 1003) {
          calculatedReason = 'An endpoint is terminating the connection because it has received a type of data it cannot accept (e.g., an endpoint that understands only text data MAY send this if it receives a binary message).';
        } else if (code === 1004) {
          calculatedReason = 'Reserved. The specific meaning might be defined in the future.';
        } else if (code === 1005) {
          calculatedReason = 'No status code was actually present.';
        } else if (code === 1006) {
          calculatedReason = 'The connection was closed abnormally, e.g., without sending or receiving a Close control frame';
        } else if (code === 1007) {
          calculatedReason = 'An endpoint is terminating the connection because it has received data within a message that was not consistent with the type of the message (e.g., non-UTF-8 [http://tools.ietf.org/html/rfc3629] data within a text message).';
        } else if (code === 1008) {
          calculatedReason = 'An endpoint is terminating the connection because it has received a message that "violates its policy". This reason is given either if there is no other sutible reason, or if there is a need to hide specific details about the policy.';
        } else if (code === 1009) {
          calculatedReason = 'An endpoint is terminating the connection because it has received a message that is too big for it to process.';
        } else if (code === 1010) {
          calculatedReason = `An endpoint (client) is terminating the connection because it has expected the server to negotiate one or more extension, but the server didn't return them in the response message of the WebSocket handshake. <br /> Specifically, the extensions that are needed are: ${reason || 'Unknown'}`;
        } else if (code === 1011) {
          calculatedReason = 'A server is terminating the connection because it encountered an unexpected condition that prevented it from fulfilling the request.';
        } else if (code === 1015) {
          calculatedReason = "The connection was closed due to a failure to perform a TLS handshake (e.g., the server certificate can't be verified).";
        } else {
          calculatedReason = '';
        }
      }
      if (wasClean) {
        this.logger.warn(`Cleanly closed websocket connection to Braid server at ${this.address} with code ${code}${calculatedReason ? `: ${calculatedReason}` : ''}`);
      } else {
        this.logger.warn(`Uncleanly closed websocket connection to Braid server at ${this.address} with code ${code}${calculatedReason ? `: ${calculatedReason}` : ''}`);
      }
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
        this.emit('credentialsResponse', message.value.success, message.value.code, message.value.message);
      } else if (message instanceof SubscribeResponse) {
        this.emit('subscribeResponse', message.value.key, message.value.success, message.value.code, message.value.message);
      } else if (message instanceof EventSubscribeResponse) {
        this.emit('eventSubscribeResponse', message.value.name, message.value.success, message.value.code, message.value.message);
      } else if (message instanceof PublishResponse) {
        this.emit('publishResponse', message.value.key, message.value.success, message.value.code, message.value.message);
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

    ws.onerror = () => {
      this.emit('error', new ConnectionError(`Websocket error when connecting to ${this.address}, check the 'close' event for additional details`));
    };

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('error', onError);
        this.removeListener('open', onOpen);
        try {
          ws.close(1011, `Timeout after ${this.timeoutDuration * 2}`);
        } catch (error) {
          this.logger.error(`Unable to close connection to ${this.address}: ${error.message}`);
        }
        reject(new Error(`Timeout when opening connection to ${this.address}`));
      }, this.timeoutDuration * 2);
      const onOpen = () => {
        clearTimeout(timeout);
        this.removeListener('error', onError);
        resolve();
      };
      const onError = (error      ) => {
        clearTimeout(timeout);
        this.removeListener('open', onOpen);
        reject(error);
      };
      this.once('error', onError);
      this.once('open', onOpen);
    });

    this.logger.info(`Opened websocket connection to Braid server at ${this.address}`);

    if (credentials) {
      await this.sendCredentials(credentials);
    } else {
      await this.sendRequests();
    }
  }

  async sendRequests() {
    const promises = [];

    for (const key of this.subscriptions) {
      promises.push(this.sendSubscribeRequest(key).catch((error) => {
        this.emit('error', error);
      }));
    }

    for (const name of this.eventSubscriptions.keys()) {
      promises.push(this.sendEventSubscribeRequest(name).catch((error) => {
        this.emit('error', error);
      }));
    }

    for (const name of this.receivers) {
      promises.push(this.sendPublishRequest(name).catch((error) => {
        this.emit('error', error);
      }));
    }

    await Promise.all(promises);
  }

  reconnect() {
    if (!this.shouldReconnect) {
      this.emit('reconnect', false);
      return;
    }
    clearTimeout(this.reconnectTimeout);
    clearTimeout(this.reconnectAttemptResetTimeout);
    this.reconnectAttempts += 1;
    clearTimeout(this.reconnectAttemptResetTimeout);
    const duration = this.reconnectAttempts > 5 ? 25000 + Math.round(Math.random() * 10000) : this.reconnectAttempts * this.reconnectAttempts * 1000;
    this.logger.warn(`Reconnect attempt ${this.reconnectAttempts} in ${Math.round(duration / 100) / 10} seconds`);
    this.reconnectTimeout = setTimeout(async () => {
      clearTimeout(this.reconnectAttemptResetTimeout);
      const shouldReconnect = this.reconnectHandler(this.credentials);
      this.emit('reconnect', shouldReconnect !== false);
      if (shouldReconnect === false) {
        this.logger.warn(`Reconnect attempt ${this.reconnectAttempts} cancelled by reconnect handler`);
        this.shouldReconnect = false;
        return;
      }
      this.logger.warn(`Reconnect attempt ${this.reconnectAttempts}`);

      try {
        await this.open(this.address, this.credentials);
      } catch (error) {
        this.logger.error(`Reconnect attempt ${this.reconnectAttempts} failed: ${error.message}`);
        this.emit('error', error);
      }
      this.reconnectAttemptResetTimeout = setTimeout(() => {
        this.reconnectAttempts = 0;
      }, 60000);
    }, duration);
  }

  /**
   * Close connection to server.
   * @param {number} [code] Websocket close reason code to send to the server
   * @param {string} [reason] Websocket close reason to send to the server
   * @return {Promise<void>}
   */
  async close(code         , reason         ) {
    clearTimeout(this.reconnectTimeout);
    clearTimeout(this.reconnectAttemptResetTimeout);
    this.shouldReconnect = false;
    if (!this.ws) {
      return;
    }
    await new Promise((resolve, reject) => {
      const onClose = () => {
        this.removeListener('error', onError);
        resolve();
      };
      const onError = (error       ) => {
        this.removeListener('close', onClose);
        reject(error);
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
    this.credentials = credentials;
    if (!this.ws) {
      return;
    }
    const responsePromise = new Promise((resolve, reject) => {
      const handleCredentialsResponse = (success, code, message) => {
        clearTimeout(timeout);
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        if (success === true) {
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

    await this.sendRequests();
  }

  /**
   * Subscribe to updates on a key.
   * @param {string} key Key to request updates on
   * @param {(any, any) => void} [callback] Optional callback function
   * @return {Promise<void>}
   */
  async subscribe(key        ) {
    if (!this.ws) {
      this.subscriptions.add(key);
      await new Promise((resolve, reject) => {
        const handleError = (error                       ) => {
          if (error instanceof SubscribeError) {
            if (error.itemKey !== key) {
              return;
            }
          }
          if (error instanceof PublishError || error instanceof EventSubscribeError) {
            return;
          }
          this.removeListener('error', handleError);
          this.removeListener('subscribeRequestSuccess', handleSubscribeRequestSuccess);
          this.unsubscribe(key);
          reject(error);
        };
        const handleSubscribeRequestSuccess = (k       ) => {
          if (k !== key) {
            return;
          }
          this.removeListener('error', handleError);
          this.removeListener('subscribeRequestSuccess', handleSubscribeRequestSuccess);
          resolve();
        };
        this.on('error', handleError);
        this.on('subscribeRequestSuccess', handleSubscribeRequestSuccess);
      });
      return;
    }
    const promise = this.subscribeRequestPromises.get(key);
    if (promise) { // The subscription already exists has not been verified
      await promise;
      return;
    }
    // The subscription exists and has been verified
    if (this.subscriptions.has(key)) {
      return;
    }
    this.subscriptions.add(key);
    try {
      await this.sendSubscribeRequest(key);
    } catch (error) {
      this.unsubscribe(key);
      throw error;
    }
  }

  /**
   * Send subscribe request to server
   * @param {string} key Key to request updates on
   * @return {Promise<void>}
   */
  sendSubscribeRequest(key        ) {
    let promise = this.subscribeRequestPromises.get(key);
    if (promise) {
      return promise;
    }
    promise = this._sendSubscribeRequest(key); // eslint-disable-line no-underscore-dangle
    this.subscribeRequestPromises.set(key, promise);
    promise.then(() => {
      this.subscribeRequestPromises.delete(key);
    }).catch(() => {
      this.subscribeRequestPromises.delete(key);
    });
    return promise;
  }

  async _sendSubscribeRequest(key        ) {
    const responsePromise = new Promise((resolve, reject) => {
      const handleSubscribeResponse = (k, success, code, message) => {
        if (k !== key) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('subscribeResponse', handleSubscribeResponse);
        if (success === true) {
          this.emit('subscribeRequestSuccess', key);
          resolve();
        } else {
          const error = new SubscribeError(key, message, code);
          reject(error);
        }
      };
      const timeout = setTimeout(() => {
        this.removeListener('subscribeResponse', handleSubscribeResponse);
        const error = new SubscribeError(key, `Subscription response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
        reject(error);
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
  unsubscribe(key        ) {
    if (!this.subscriptions.has(key)) {
      return;
    }
    this.subscriptions.delete(key);
    if (!this.ws) {
      return;
    }
    this.ws.send(encode(new Unsubscribe(key)));
  }

  /**
   * Subscribe to a server event
   * @param {string} name Name of the event to listen for
   * @param {(...any) => void} callback Callback
   * @return {Promise<void>}
   */
  async addServerEventListener(name        , callback                  ) {
    let callbacks = this.eventSubscriptions.get(name);
    if (!this.ws) {
      if (!callbacks) {
        callbacks = new Set();
        this.eventSubscriptions.set(name, callbacks);
      }
      callbacks.add(callback);
      await new Promise((resolve, reject) => {
        const handleError = (error                            ) => {
          if (error instanceof EventSubscribeError) {
            if (error.itemName !== name) {
              return;
            }
          }
          if (error instanceof SubscribeError || error instanceof PublishError) {
            return;
          }
          this.removeListener('error', handleError);
          this.removeListener('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
          this.removeServerEventListener(name, callback);
          reject(error);
        };
        const handleEventSubscribeRequestSuccess = (n       ) => {
          if (n !== name) {
            return;
          }
          this.removeListener('error', handleError);
          this.removeListener('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
          resolve();
        };
        this.on('error', handleError);
        this.on('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
      });
      return;
    }
    // The event subscription exists
    if (callbacks) {
      callbacks.add(callback);
      const promise = this.eventSubscribeRequestPromises.get(name);
      if (promise) { // The event subscription already exists has not been verified
        try {
          await promise;
        } catch (error) {
          this.removeServerEventListener(name, callback);
          throw error;
        }
      }
      return;
    }
    callbacks = new Set();
    callbacks.add(callback);
    this.eventSubscriptions.set(name, callbacks);
    try {
      await this.sendEventSubscribeRequest(name);
    } catch (error) {
      this.removeServerEventListener(name, callback);
      throw error;
    }
  }

  /**
   * Send event subscribe request to server
   * @param {string} name Name of the event to listen for
   * @return {Promise<void>}
   */
  sendEventSubscribeRequest(name        ) {
    let promise = this.eventSubscribeRequestPromises.get(name);
    if (promise) {
      return promise;
    }
    promise = this._sendEventSubscribeRequest(name); // eslint-disable-line no-underscore-dangle
    this.eventSubscribeRequestPromises.set(name, promise);
    promise.then(() => {
      this.eventSubscribeRequestPromises.delete(name);
    }).catch(() => {
      this.eventSubscribeRequestPromises.delete(name);
    });
    return promise;
  }

  async _sendEventSubscribeRequest(name        ) {
    const responsePromise = new Promise((resolve, reject) => {
      const handleEventSubscribeResponse = (n, success, code, message) => {
        if (n !== name) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('eventSubscribeResponse', handleEventSubscribeResponse);
        if (success === true) {
          this.emit('eventSubscribeRequestSuccess', name);
          resolve();
        } else {
          const error = new EventSubscribeError(name, message, code);
          reject(error);
        }
      };
      const timeout = setTimeout(() => {
        this.removeListener('eventSubscribeResponse', handleEventSubscribeResponse);
        const error = new EventSubscribeError(name, `Event subscription response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
        reject(error);
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
  removeServerEventListener(name        , callback                ) {
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

  /**
   * Start publishing to a receiver
   * @param {string} name Name of the receiver to start publishing to
   * @return {Promise<void>}
   */
  async startPublishing(name        ) {
    if (!this.ws) {
      this.receivers.add(name);
      await new Promise((resolve, reject) => {
        const handleError = (error                     ) => {
          if (error instanceof PublishError) {
            if (error.itemName !== name) {
              return;
            }
          }
          if (error instanceof SubscribeError || error instanceof EventSubscribeError) {
            return;
          }
          this.removeListener('error', handleError);
          this.removeListener('publishRequestSuccess', handlePublishRequestSuccess);
          this.stopPublishing(name);
          reject(error);
        };
        const handlePublishRequestSuccess = (n       ) => {
          if (n !== name) {
            return;
          }
          this.removeListener('error', handleError);
          this.removeListener('publishRequestSuccess', handlePublishRequestSuccess);
          resolve();
        };
        this.on('error', handleError);
        this.on('publishRequestSuccess', handlePublishRequestSuccess);
      });
      return;
    }
    const promise = this.publishRequestPromises.get(name);
    if (promise) { // The publish request already exists has not been verified
      await promise;
      return;
    }
    // The receiver/publisher exists and has been verified
    if (this.receivers.has(name)) {
      return;
    }
    this.receivers.add(name);
    try {
      await this.sendPublishRequest(name);
    } catch (error) {
      this.stopPublishing(name);
      throw error;
    }
  }

  /**
   * Publish message to a receiver
   * @param {string} name Name of the receiver
   * @param {any} message Value to publish, should not contain undefined values
   * @return {Promise<void>}
   */
  publish(name        , message     ) {
    if (!this.receivers.has(name)) {
      throw new Error('Receiver does not exist, call startPublishing()');
    }
    if (typeof message === 'undefined') {
      throw new Error('Unable to publish undefined values');
    }
    if (this.ws) {
      this.ws.send(encode(new PublisherMessage(name, message)));
    } else {
      const publishQueue = this.publishQueueMap.get(name) || [];
      publishQueue.push(message);
      this.publishQueueMap.set(name, publishQueue);
    }
  }

  /**
   * Send event subscribe request to server
   * @param {string} name Name of the event to listen for
   * @return {Promise<void>}
   */

  sendPublishRequest(name        ) {
    let promise = this.publishRequestPromises.get(name);
    if (promise) {
      return promise;
    }
    promise = this._sendPublishRequest(name); // eslint-disable-line no-underscore-dangle
    this.publishRequestPromises.set(name, promise);
    promise.then(() => {
      this.publishRequestPromises.delete(name);
    }).catch(() => {
      this.publishRequestPromises.delete(name);
    });
    return promise;
  }

  async _sendPublishRequest(name        ) {
    const responsePromise = new Promise((resolve, reject) => {
      const handlePublishResponse = (n, success, code, message) => {
        if (n !== name) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('publishResponse', handlePublishResponse);
        if (success === true) {
          this.emit('publishRequestSuccess', name);
          const publishQueue = this.publishQueueMap.get(name) || [];
          while (publishQueue.length > 0) {
            this.publish(name, publishQueue.shift());
          }
          this.publishQueueMap.delete(name);
          resolve();
        } else {
          const error = new PublishError(name, message, code);
          reject(error);
        }
      };
      const timeout = setTimeout(() => {
        this.removeListener('publishResponse', handlePublishResponse);
        const error = new PublishError(name, `Publish response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
        reject(error);
      }, this.timeoutDuration);
      this.on('publishResponse', handlePublishResponse);
    });
    this.ws.send(encode(new PublishRequest(name)));
    await responsePromise;
  }

  /**
   * Stop publishing to a receiver.
   * @param {string} name Name of the receiver to stop publishing to
   * @param {(...any) => void} [callback] Callback
   * @return {Promise<void>}
   */
  stopPublishing(name        ) {
    if (!this.receivers.has(name)) {
      return;
    }
    this.receivers.delete(name);
    if (!this.ws) {
      return;
    }
    this.ws.send(encode(new Unpublish(name)));
  }

                    
                         
                         
                              
                                     
                                 
                                                                 
                        
                                              
                                  
                                    
                                   
                                                  
                                      
                                                
                                                   
                                                               
                                                                    
                                                             
}

module.exports = Client;
