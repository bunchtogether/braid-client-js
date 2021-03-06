// @flow

const { EventEmitter } = require('events');
const WebSocket = require('isomorphic-ws');
const { default: PQueue } = require('p-queue');
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

type Logger = {
  debug: (string | number, ...any) => void,
  info: (string | number, ...any) => void,
  warn: (string | number, ...any) => void,
  error: (string | number, ...any) => void,
  errorStack: (error:Error | MediaError) => void
};

/**
 * Class representing a connection error
 */
class ConnectionError extends Error {
  constructor(message:string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

/**
 * Class representing a credentials error
 */
class CredentialsError extends Error {
  declare code: number;
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
  declare code: number;
  declare itemKey: string;
  constructor(itemKey: string, message:string, code:number) {
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
  declare code: number;
  declare itemName: string;
  constructor(itemName: string, message:string, code:number) {
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
  declare code: number;
  declare itemName: string;
  constructor(itemName: string, message:string, code:number) {
    super(message);
    this.itemName = itemName;
    this.name = 'PublishError';
    this.code = code;
  }
}

/**
 * Class representing an error that interupts a pending server
 * request, for example if a connection closes prematurely
 */
class ServerRequestError extends Error {
  declare code: number;
  constructor(message:string, code:number) {
    super(message);
    this.name = 'ServerRequestError';
    this.code = code;
  }
}

const isTransactionError = (error:Error) => (error instanceof SubscribeError) || (error instanceof EventSubscribeError) || (error instanceof PublishError);

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
    this.connectionQueue = new PQueue({ concurrency: 1 });
    this.credentialQueue = new PQueue({ concurrency: 1 });
    this.confirmedSubscriptions = new Set();
    this.receivers = new Set();
    this.confirmedReceivers = new Set();
    this.eventSubscriptions = new Map();
    this.confirmedEventSubscriptions = new Set();
    this.setMaxListeners(0);
    this.reconnectAttempts = 0;
    this.publishQueueMap = new Map();
    this.subscribeRequestPromises = new Map();
    this.eventSubscribeRequestPromises = new Map();
    this.publishRequestPromises = new Map();
    this.setReconnectHandler(() => true);
    this.logger = baseLogger;
    this.credentialQueue.once('active', () => {
      this.credentialQueue.on('idle', () => {
        this.logger.info('Credentials queue is idle, sending requests');
        this.sendRequests();
      });
    });
  }

  /**
   * Set the reconnect handler. The handler determines if the reconnect should continue.
   * @param {(credentials: Object) => boolean} func - Credentials handler.
   * @return {void}
   */
  setReconnectHandler(func: (Object) => boolean) { // eslint-disable-line no-unused-vars
    this.reconnectHandler = func;
  }

  /**
   * Connects to a server.
   * @param {string} address Websocket URL of the server
   * @param {Object} [credentials] Credentials to send
   * @return {Promise<void>}
   */

  open(address:string, credentials?:Object) {
    if (this.connectionQueue.size > 0 || this.connectionQueue.pending > 0) {
      this.logger.error(`Connection already initiated, ${this.connectionQueue.size} connection${this.connectionQueue.size !== 1 ? 's' : ''} queued and ${this.connectionQueue.pending} connection${this.connectionQueue.pending !== 1 ? 's' : ''} pending`);
    }
    return this.connectionQueue.add(() => this._open(address, credentials)); // eslint-disable-line no-underscore-dangle
  }

  async _open(address:string, credentials?:Object) {
    if (this.ws) {
      if (this.address === address) {
        if (JSON.stringify(credentials || '') === JSON.stringify(this.credentials || '')) {
          this.logger.error(`Connection already open, duplicate open call made to ${address} using the same credentials`);
        } else if (typeof credentials === 'object') {
          this.logger.error(`Connection already open, open call made to ${address} using alternate credentials`);
          await this.sendCredentials(credentials);
        } else {
          this.logger.error(`Connection already open, open call made to ${address} without credentials`);
          await this.sendCredentials({});
        }
        return;
      }
      this.logger.error(`Connection already open, closing connection to ${this.address} and opening new connection to ${address}`);
      await this.close(1000, `Connecting to ${address}`);
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
      this.confirmedSubscriptions.clear();
      this.confirmedEventSubscriptions.clear();
      this.confirmedReceivers.clear();
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

    ws.onerror = (event:Object) => {
      this.emit('error', new ConnectionError(`Websocket error when connecting to ${this.address}, check the 'close' event for additional details${event ? `: ${JSON.stringify(event)}` : ''}`));
    };

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('open', handleOpen);
        this.removeListener('error', handleError);
        this.removeListener('close', handleClose);
        try {
          ws.close(1011, `Timeout after ${this.timeoutDuration * 2}`);
        } catch (error) {
          this.logger.error(`Unable to close connection to ${this.address}: ${error.message}`);
        }
        reject(new Error(`Timeout when opening connection to ${this.address}`));
      }, this.timeoutDuration * 2);
      const handleOpen = () => {
        clearTimeout(timeout);
        this.removeListener('open', handleOpen);
        this.removeListener('error', handleError);
        this.removeListener('close', handleClose);
        resolve();
      };
      const handleError = (error:Error) => {
        if (isTransactionError(error)) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('open', handleOpen);
        this.removeListener('error', handleError);
        this.removeListener('close', handleClose);
        reject(error);
      };
      const handleClose = () => {
        clearTimeout(timeout);
        this.removeListener('open', handleOpen);
        this.removeListener('error', handleError);
        this.removeListener('close', handleClose);
        this.logger.error('Connection closed before an open event was received');
        reject(new ServerRequestError('Connection closed before an open event was received', 502));
      };
      this.on('open', handleOpen);
      this.on('error', handleError);
      this.on('close', handleClose);
    });

    this.logger.info(`Opened websocket connection to Braid server at ${this.address}`);

    if (typeof credentials === 'object') {
      await this.sendCredentials(credentials);
    } else {
      await this.sendRequests();
    }
  }

  async sendRequests() {
    const promises = [];

    for (const key of this.subscriptions) {
      const promise = (async () => {
        if (this.confirmedSubscriptions.has(key)) {
          return;
        }
        this.subscriptions.add(key);
        if (this.ws) {
          this.sendSubscribeRequest(key);
        }
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.removeListener('error', handleError);
            this.removeListener('subscribeRequestSuccess', handleSubscribeRequestSuccess);
            const error = new SubscribeError(key, `Subscription timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
            reject(error);
          }, this.timeoutDuration + 1000);
          const handleError = (error:Error | SubscribeError) => {
            if (!(error instanceof SubscribeError)) {
              return;
            }
            if (error.itemKey !== key) {
              return;
            }
            clearTimeout(timeout);
            this.removeListener('error', handleError);
            this.removeListener('subscribeRequestSuccess', handleSubscribeRequestSuccess);
            if (error.code === 502) {
              this.logger.warn(`Connection closed before a credentials response was received when subscribing to ${key} while opening connection to Braid server at ${this.address}`);
              resolve();
              return;
            }
            reject(error);
          };
          const handleSubscribeRequestSuccess = (k:string) => {
            if (k !== key) {
              return;
            }
            clearTimeout(timeout);
            this.removeListener('error', handleError);
            this.removeListener('subscribeRequestSuccess', handleSubscribeRequestSuccess);
            resolve();
          };
          this.on('error', handleError);
          this.on('subscribeRequestSuccess', handleSubscribeRequestSuccess);
        });
      })().catch((error) => {
        this.logger.error(`Error when subscribing to ${key} while opening connection to Braid server at ${this.address}`);
        this.logger.errorStack(error);
      });
      promises.push(promise);
    }

    for (const name of this.eventSubscriptions.keys()) {
      const promise = (async () => {
        if (this.confirmedEventSubscriptions.has(name)) {
          return;
        }
        if (this.ws) {
          this.sendEventSubscribeRequest(name);
        }
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.removeListener('error', handleError);
            this.removeListener('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
            const error = new EventSubscribeError(name, `Event subscription timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
            reject(error);
          }, this.timeoutDuration + 1000);
          const handleError = (error:Error | EventSubscribeError) => {
            if (!(error instanceof EventSubscribeError)) {
              return;
            }
            if (error.itemName !== name) {
              return;
            }
            clearTimeout(timeout);
            this.removeListener('error', handleError);
            this.removeListener('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
            if (error.code === 502) {
              this.logger.warn(`Connection closed before a credentials response was received when subscribing to event ${name} while opening connection to Braid server at ${this.address}`);
              resolve();
              return;
            }
            reject(error);
          };
          const handleEventSubscribeRequestSuccess = (n:string) => {
            if (n !== name) {
              return;
            }
            clearTimeout(timeout);
            this.removeListener('error', handleError);
            this.removeListener('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
            resolve();
          };
          this.on('error', handleError);
          this.on('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
        });
      })().catch((error) => {
        this.logger.error(`Error when subscribing to event ${name} while opening connection to Braid server at ${this.address}`);
        this.logger.errorStack(error);
      });
      promises.push(promise);
    }

    for (const name of this.receivers) {
      const promise = (async () => {
        if (this.confirmedReceivers.has(name)) {
          return;
        }
        this.receivers.add(name);
        if (this.ws) {
          this.sendPublishRequest(name);
        }
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.removeListener('error', handleError);
            this.removeListener('publishRequestSuccess', handlePublishRequestSuccess);
            const error = new PublishError(name, `Publish timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
            reject(error);
          }, this.timeoutDuration + 1000);
          const handleError = (error:Error | PublishError) => {
            if (!(error instanceof PublishError)) {
              return;
            }
            if (error.itemName !== name) {
              return;
            }
            clearTimeout(timeout);
            this.removeListener('error', handleError);
            this.removeListener('publishRequestSuccess', handlePublishRequestSuccess);
            if (error.code === 502) {
              this.logger.warn(`Connection closed before a credentials response was received when publishing to ${name} while opening connection to Braid server at ${this.address}`);
              resolve();
              return;
            }
            reject(error);
          };
          const handlePublishRequestSuccess = (n:string) => {
            if (n !== name) {
              return;
            }
            clearTimeout(timeout);
            this.removeListener('error', handleError);
            this.removeListener('publishRequestSuccess', handlePublishRequestSuccess);
            resolve();
          };
          this.on('error', handleError);
          this.on('publishRequestSuccess', handlePublishRequestSuccess);
        });
      })().catch((error) => {
        this.logger.error(`Error when publishing to ${name} while opening connection to Braid server at ${this.address}`);
        this.logger.errorStack(error);
      });
      promises.push(promise);
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
    clearTimeout(this.reconnectAttemptResetTimeout);
    const duration = this.reconnectAttempts > 5 ? 25000 + Math.round(Math.random() * 10000) : this.reconnectAttempts * this.reconnectAttempts * 1000;
    this.reconnectAttempts += 1;
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
  async close(code?: number, reason?: string) {
    clearTimeout(this.reconnectTimeout);
    clearTimeout(this.reconnectAttemptResetTimeout);
    this.shouldReconnect = false;
    if (!this.ws) {
      return;
    }
    await new Promise((resolve, reject) => {
      const handleClose = () => {
        clearTimeout(timeout);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        resolve();
      };
      const handleError = (error: Error) => {
        if (isTransactionError(error)) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        reject(error);
      };
      this.on('close', handleClose);
      this.on('error', handleError);
      const timeout = setTimeout(() => {
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        reject(new ConnectionError(`Did not receive a close event after ${this.timeoutDuration * 2 / 1000} seconds`));
      }, this.timeoutDuration * 2);
      this.ws.close(code, reason);
    });
  }

  /**
   * Send credentials to a server with an open connection.
   * @param {Object} [credentials] Credentials to send
   * @return {Promise<void>}
   */
  sendCredentials(credentials: Object) {
    if (this.credentialQueue.size > 0 || this.credentialQueue.pending > 0) {
      this.logger.error(`Credentials already sent, ${this.credentialQueue.size} request${this.credentialQueue.size !== 1 ? 's' : ''} queued and ${this.credentialQueue.pending} request${this.credentialQueue.pending !== 1 ? 's' : ''} pending`);
    }
    return this.credentialQueue.add(() => this._sendCredentials(credentials)); // eslint-disable-line no-underscore-dangle
  }

  async _sendCredentials(credentials: Object) {
    if (!this.ws) {
      throw new Error(`Can not send credentials, connection to ${this.address} is not open`);
    }
    this.credentials = credentials;
    await new Promise((resolve, reject) => {
      const handleCredentialsResponse = (success, code, message) => {
        clearTimeout(timeout);
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        if (success === true) {
          resolve();
        } else {
          reject(new CredentialsError(message, code));
        }
      };
      const handleClose = () => {
        clearTimeout(timeout);
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        this.logger.error('Connection closed before a credentials response was received');
        reject(new ServerRequestError('Connection closed before a credentials response was received', 502));
      };
      const handleError = (error:Error) => {
        if (isTransactionError(error)) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        this.logger.error(`Error received before a credentials response was received: ${error.message || 'Unknown error'}`);
        reject(new ServerRequestError(`Error received before a credentials response was received: ${error.message || 'Unknown error'}`, 500));
      };
      const timeout = setTimeout(() => {
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        reject(new CredentialsError(`Credentials response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504));
      }, this.timeoutDuration);
      this.on('credentialsResponse', handleCredentialsResponse);
      this.on('close', handleClose);
      this.on('error', handleError);
      this.ws.send(encode(new Credentials(credentials)));
    });
  }

  /**
   * Subscribe to updates on a key.
   * @param {string} key Key to request updates on
   * @param {(any, any) => void} [callback] Optional callback function
   * @return {Promise<void>}
   */
  async subscribe(key: string) {
    if (this.confirmedSubscriptions.has(key)) {
      return;
    }
    this.subscriptions.add(key);
    if (this.ws) {
      this.sendSubscribeRequest(key);
    }
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('error', handleError);
        this.removeListener('subscribeRequestSuccess', handleSubscribeRequestSuccess);
        const error = new SubscribeError(key, `Subscription timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
        reject(error);
      }, this.timeoutDuration + 1000);
      const handleError = (error:Error | SubscribeError) => {
        if (!(error instanceof SubscribeError)) {
          return;
        }
        if (error.itemKey !== key) {
          return;
        }
        if (error.code === 502) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('error', handleError);
        this.removeListener('subscribeRequestSuccess', handleSubscribeRequestSuccess);
        this.unsubscribe(key);
        reject(error);
      };
      const handleSubscribeRequestSuccess = (k:string) => {
        if (k !== key) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('error', handleError);
        this.removeListener('subscribeRequestSuccess', handleSubscribeRequestSuccess);
        resolve();
      };
      this.on('error', handleError);
      this.on('subscribeRequestSuccess', handleSubscribeRequestSuccess);
    });
  }

  /**
   * Send subscribe request to server
   * @param {string} key Key to request updates on
   * @return {Promise<void>}
   */
  sendSubscribeRequest(key: string) {
    let promise = this.subscribeRequestPromises.get(key);
    if (promise) {
      return promise;
    }
    promise = this._sendSubscribeRequest(key); // eslint-disable-line no-underscore-dangle
    this.subscribeRequestPromises.set(key, promise);
    promise.then(() => {
      this.subscribeRequestPromises.delete(key);
    }).catch((error:Error) => {
      this.subscribeRequestPromises.delete(key);
      this.emit('error', error);
    });
    return promise;
  }

  async _sendSubscribeRequest(key: string) {
    if (this.connectionQueue.size > 0 || this.credentialQueue.size > 0 || this.connectionQueue.pending > 0 || this.credentialQueue.pending > 0) {
      this.emit('subscribeRequestCredentialsCheck', key);
      await this.connectionQueue.onIdle();
      await this.credentialQueue.onIdle();
    }
    if (!this.ws) {
      throw new SubscribeError(key, 'Connection closed before a subscription request was sent', 502);
    }
    await new Promise((resolve, reject) => {
      const handleSubscribeResponse = (k, success, code, message) => {
        if (k !== key) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('subscribeResponse', handleSubscribeResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        if (success === true) {
          this.confirmedSubscriptions.add(key);
          this.emit('subscribeRequestSuccess', key);
          resolve();
        } else {
          const error = new SubscribeError(key, message, code);
          reject(error);
        }
      };
      const handleClose = () => {
        clearTimeout(timeout);
        this.removeListener('subscribeResponse', handleSubscribeResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        const closeError = new SubscribeError(key, 'Connection closed before a subscription response was received', 502);
        reject(closeError);
      };
      const handleError = (error:Error) => {
        if (isTransactionError(error)) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('subscribeResponse', handleSubscribeResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        if (error instanceof ConnectionError) {
          reject(new SubscribeError(key, `Connection error received before a subscription response was received: ${error.message || 'Unknown error'}`, 502));
          return;
        }
        reject(new SubscribeError(key, `Error received before a subscription response was received: ${error.message || 'Unknown error'}`, 500));
      };
      const timeout = setTimeout(() => {
        this.removeListener('subscribeResponse', handleSubscribeResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        const error = new SubscribeError(key, `Subscription response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
        reject(error);
      }, this.timeoutDuration);
      this.on('subscribeResponse', handleSubscribeResponse);
      this.on('close', handleClose);
      this.on('error', handleError);
      this.ws.send(encode(new SubscribeRequest(key)));
    });
  }

  /**
   * Unsubscribe from updates on a key. If the callback parameter is not provided, all callbacks are unsubscribed.
   * @param {string} key Key to stop updates on
   * @param {(any, any) => void} [callback] Optional callback function
   * @return {Promise<void>}
   */
  unsubscribe(key: string) {
    if (!this.subscriptions.has(key)) {
      return;
    }
    this.subscriptions.delete(key);
    this.confirmedSubscriptions.delete(key);
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

  async addServerEventListener(name: string, callback: (...any) => void) {
    let callbacks = this.eventSubscriptions.get(name);
    if (!callbacks) {
      callbacks = new Set();
      this.eventSubscriptions.set(name, callbacks);
    }
    callbacks.add(callback);
    if (this.confirmedEventSubscriptions.has(name)) {
      return;
    }
    if (this.ws) {
      this.sendEventSubscribeRequest(name);
    }
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('error', handleError);
        this.removeListener('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
        const error = new EventSubscribeError(name, `Event subscription timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
        reject(error);
      }, this.timeoutDuration + 1000);
      const handleError = (error:Error | EventSubscribeError) => {
        if (!(error instanceof EventSubscribeError)) {
          return;
        }
        if (error.itemName !== name) {
          return;
        }
        if (error.code === 502) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('error', handleError);
        this.removeListener('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
        this.removeServerEventListener(name, callback);
        reject(error);
      };
      const handleEventSubscribeRequestSuccess = (n:string) => {
        if (n !== name) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('error', handleError);
        this.removeListener('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
        resolve();
      };
      this.on('error', handleError);
      this.on('eventSubscribeRequestSuccess', handleEventSubscribeRequestSuccess);
    });
  }

  /**
   * Send event subscribe request to server
   * @param {string} name Name of the event to listen for
   * @return {Promise<void>}
   */
  sendEventSubscribeRequest(name: string) {
    let promise = this.eventSubscribeRequestPromises.get(name);
    if (promise) {
      return promise;
    }
    promise = this._sendEventSubscribeRequest(name); // eslint-disable-line no-underscore-dangle
    this.eventSubscribeRequestPromises.set(name, promise);
    promise.then(() => {
      this.eventSubscribeRequestPromises.delete(name);
    }).catch((error:Error) => {
      this.eventSubscribeRequestPromises.delete(name);
      this.emit('error', error);
    });
    return promise;
  }

  async _sendEventSubscribeRequest(name: string) {
    if (this.connectionQueue.size > 0 || this.credentialQueue.size > 0 || this.connectionQueue.pending > 0 || this.credentialQueue.pending > 0) {
      this.emit('eventSubscribeRequestCredentialsCheck', name);
      await this.connectionQueue.onIdle();
      await this.credentialQueue.onIdle();
    }
    if (!this.ws) {
      throw new EventSubscribeError(name, 'Connection closed before an event subscription request was sent', 502);
    }
    await new Promise((resolve, reject) => {
      const handleEventSubscribeResponse = (n, success, code, message) => {
        if (n !== name) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('eventSubscribeResponse', handleEventSubscribeResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        if (success === true) {
          this.confirmedEventSubscriptions.add(name);
          this.emit('eventSubscribeRequestSuccess', name);
          resolve();
        } else {
          const error = new EventSubscribeError(name, message, code);
          reject(error);
        }
      };
      const handleClose = () => {
        clearTimeout(timeout);
        this.removeListener('eventSubscribeResponse', handleEventSubscribeResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        const closeError = new EventSubscribeError(name, 'Connection closed before an event subscription response was received', 502);
        reject(closeError);
      };
      const handleError = (error:Error) => {
        if (isTransactionError(error)) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('eventSubscribeResponse', handleEventSubscribeResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        if (error instanceof ConnectionError) {
          reject(new EventSubscribeError(name, `Connection error received before an event subscription response was received: ${error.message || 'Unknown error'}`, 502));
          return;
        }
        reject(new EventSubscribeError(name, `Error received before an event subscription response was received: ${error.message || 'Unknown error'}`, 500));
      };
      const timeout = setTimeout(() => {
        this.removeListener('eventSubscribeResponse', handleEventSubscribeResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        const error = new EventSubscribeError(name, `Event subscription response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
        reject(error);
      }, this.timeoutDuration);
      this.on('eventSubscribeResponse', handleEventSubscribeResponse);
      this.on('close', handleClose);
      this.on('error', handleError);
      this.ws.send(encode(new EventSubscribeRequest(name)));
    });
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
    this.confirmedEventSubscriptions.delete(name);
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

  async startPublishing(name: string) {
    if (this.confirmedReceivers.has(name)) {
      return;
    }
    this.receivers.add(name);
    if (this.ws) {
      this.sendPublishRequest(name);
    }
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('error', handleError);
        this.removeListener('publishRequestSuccess', handlePublishRequestSuccess);
        const error = new PublishError(name, `Publish timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
        reject(error);
      }, this.timeoutDuration + 1000);
      const handleError = (error:Error | PublishError) => {
        if (!(error instanceof PublishError)) {
          return;
        }
        if (error.itemName !== name) {
          return;
        }
        if (error.code === 502) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('error', handleError);
        this.removeListener('publishRequestSuccess', handlePublishRequestSuccess);
        this.stopPublishing(name);
        reject(error);
      };
      const handlePublishRequestSuccess = (n:string) => {
        if (n !== name) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('error', handleError);
        this.removeListener('publishRequestSuccess', handlePublishRequestSuccess);
        resolve();
      };
      this.on('error', handleError);
      this.on('publishRequestSuccess', handlePublishRequestSuccess);
    });
  }

  /**
   * Publish message to a receiver
   * @param {string} name Name of the receiver
   * @param {any} message Value to publish, should not contain undefined values
   * @return {Promise<void>}
   */
  publish(name: string, message: any) {
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

  sendPublishRequest(name: string) {
    let promise = this.publishRequestPromises.get(name);
    if (promise) {
      return promise;
    }
    promise = this._sendPublishRequest(name); // eslint-disable-line no-underscore-dangle
    this.publishRequestPromises.set(name, promise);
    promise.then(() => {
      this.publishRequestPromises.delete(name);
    }).catch((error:Error) => {
      this.publishRequestPromises.delete(name);
      this.emit('error', error);
    });
    return promise;
  }

  async _sendPublishRequest(name: string) {
    if (this.connectionQueue.size > 0 || this.credentialQueue.size > 0 || this.connectionQueue.pending > 0 || this.credentialQueue.pending > 0) {
      this.emit('publishRequestCredentialsCheck', name);
      await this.connectionQueue.onIdle();
      await this.credentialQueue.onIdle();
    }
    if (!this.ws) {
      throw new PublishError(name, 'Connection closed before a publish request was sent', 502);
    }
    await new Promise((resolve, reject) => {
      const handlePublishResponse = (n, success, code, message) => {
        if (n !== name) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        this.removeListener('publishResponse', handlePublishResponse);
        if (success === true) {
          this.confirmedReceivers.add(name);
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
      const handleClose = () => {
        clearTimeout(timeout);
        this.removeListener('publishResponse', handlePublishResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        const closeError = new PublishError(name, 'Connection closed before an publish response was received', 502);
        reject(closeError);
      };
      const handleError = (error:Error) => {
        if (isTransactionError(error)) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('publishResponse', handlePublishResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        if (error instanceof ConnectionError) {
          reject(new PublishError(name, `Connection error received before an publish response was received: ${error.message || 'Unknown error'}`, 502));
          return;
        }
        reject(new PublishError(name, `Error received before an publish response was received: ${error.message || 'Unknown error'}`, 500));
      };
      const timeout = setTimeout(() => {
        this.removeListener('publishResponse', handlePublishResponse);
        this.removeListener('close', handleClose);
        this.removeListener('error', handleError);
        const error = new PublishError(name, `Publish response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504);
        reject(error);
      }, this.timeoutDuration);
      this.on('publishResponse', handlePublishResponse);
      this.on('close', handleClose);
      this.on('error', handleError);
      this.ws.send(encode(new PublishRequest(name)));
    });
  }

  /**
   * Stop publishing to a receiver.
   * @param {string} name Name of the receiver to stop publishing to
   * @param {(...any) => void} [callback] Callback
   * @return {Promise<void>}
   */
  stopPublishing(name: string) {
    if (!this.receivers.has(name)) {
      return;
    }
    this.receivers.delete(name);
    this.confirmedReceivers.delete(name);
    if (!this.ws) {
      return;
    }
    this.ws.send(encode(new Unpublish(name)));
  }

  declare id:string;
  declare address:string;
  declare logger: Logger;
  declare connectionQueue: PQueue;
  declare credentialQueue: PQueue;
  declare connectionHash: string | void;
  declare credentials: Object;
  declare subscriptions: Set<string>;
  declare confirmedSubscriptions: Set<string>;
  declare receivers: Set<string>;
  declare confirmedReceivers: Set<string>;
  declare eventSubscriptions: Map<string, Set<(...any) => void>>;
  declare confirmedEventSubscriptions: Set<string>;
  declare ws: WebSocket;
  declare data:ObservedRemoveMap<string, any>;
  declare timeoutDuration: number;
  declare reconnectAttempts: number;
  declare shouldReconnect: boolean;
  declare reconnectAttemptResetTimeout: TimeoutID;
  declare reconnectTimeout: TimeoutID;
  declare reconnectHandler: (Object) => boolean;
  declare publishQueueMap: Map<string, Array<any>>;
  declare subscribeRequestPromises: Map<string, Promise<void>>;
  declare eventSubscribeRequestPromises: Map<string, Promise<void>>;
  declare publishRequestPromises: Map<string, Promise<void>>;
  static ConnectionError:Class<ConnectionError>;
}

Client.ConnectionError = ConnectionError;

module.exports = Client;
