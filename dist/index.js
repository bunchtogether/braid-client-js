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
} = require('@bunchtogether/braid-messagepack');

/**
 * Class representing a credentials error
 */
class CredentialsError extends Error {
  code        ;
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
  code        ;
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
  code        ;
  constructor(message       , code       ) {
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
    /**
     * Primary data object. Like a native JS Map but with 'set' and 'delete' events.
     *
     * @type ObservedRemoveMap<K, V>
     * @public
     */
    this.data = new ObservedRemoveMap([], { bufferPublishing: 0 });
    this.timeoutDuration = 5000;
    this.subscriptions = new Set();
    this.eventSubscriptions = new Map();
    this.setMaxListeners(0);
    this.reconnectAttempts = 0;
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

      console.log(`${wasClean ? 'Cleanly' : 'Uncleanly'} closed websocket connection to Braid server at ${this.address} with code ${code}${calculatedReason ? `: ${calculatedReason}` : ''}`);
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
      this.emit('error', new Error(`Websocket error when connecting to ${this.address}, check the 'close' event for additional details`));
    };

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('error', onError);
        this.removeListener('open', onOpen);
        try {
          ws.close(1011, `Timeout after ${this.timeoutDuration * 2}`);
        } catch (error) {
          console.log(`Unable to close connection to ${this.address}: ${error.message}`);
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

    console.log(`Opened websocket connection to Braid server at ${this.address}`);

    if (credentials) {
      await this.sendCredentials(credentials);
    } else {
      await this.sendSubscribeRequests();
    }
  }

  async sendSubscribeRequests() {
    const subscriptionPromises = [];

    for (const key of this.subscriptions) {
      subscriptionPromises.push(this.sendSubscribeRequest(key).catch((error) => {
        console.log(`Error subscribing to ${key}: ${error.message}`);
        this.emit('error', error);
      }));
    }

    for (const name of this.eventSubscriptions.keys()) {
      subscriptionPromises.push(this.sendEventSubscribeRequest(name).catch((error) => {
        console.log(`Error subscribing to event ${name}: ${error.message}`);
        this.emit('error', error);
      }));
    }

    await Promise.all(subscriptionPromises);
  }

  reconnect() {
    if (!this.shouldReconnect) {
      return;
    }
    clearTimeout(this.reconnectTimeout);
    clearTimeout(this.reconnectAttemptResetTimeout);
    this.reconnectAttempts += 1;
    clearTimeout(this.reconnectAttemptResetTimeout);
    const duration = this.reconnectAttempts > 5 ? 25000 + Math.round(Math.random() * 10000) : this.reconnectAttempts * this.reconnectAttempts * 1000;
    console.log(`Reconnect attempt ${this.reconnectAttempts} in ${Math.round(duration / 100) / 10} seconds`);
    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.open(this.address, this.credentials);
      } catch (error) {
        console.log(`Reconnect attempt ${this.reconnectAttempts} failed: ${error.message}`);
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

    await this.sendSubscribeRequests();
  }

  /**
   * Subscribe to updates on a key.
   * @param {string} key Key to request updates on
   * @param {(any, any) => void} [callback] Optional callback function
   * @return {Promise<void>}
   */
  async subscribe(key        ) {
    if (!this.subscriptions.has(key)) {
      this.subscriptions.add(key);
      if (this.ws) {
        try {
          await this.sendSubscribeRequest(key);
        } catch (error) {
          this.unsubscribe(key);
          throw error;
        }
      }
    }
  }

  /**
   * Send subscribe request to server
   * @param {string} key Key to request updates on
   * @return {Promise<void>}
   */
  async sendSubscribeRequest(key        ) {
    const responsePromise = new Promise((resolve, reject) => {
      const handleSubscribeResponse = (k, success, code, message) => {
        if (k !== key) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('subscribeResponse', handleSubscribeResponse);
        if (success === true) {
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
  async sendEventSubscribeRequest(name        ) {
    const responsePromise = new Promise((resolve, reject) => {
      const handleEventSubscribeResponse = (n, success, code, message) => {
        if (n !== name) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('eventSubscribeResponse', handleEventSubscribeResponse);
        if (success === true) {
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

  id       ;
  address       ;
  credentials        ;
  subscriptions             ;
  eventSubscriptions                                    ;
  ws           ;
  data                               ;
  timeoutDuration        ;
  reconnectAttempts        ;
  shouldReconnect         ;
  reconnectAttemptResetTimeout           ;
  reconnectTimeout           ;
}

module.exports = Client;
