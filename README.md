# Braid Client

[![CircleCI](https://circleci.com/gh/bunchtogether/braid-client-js.svg?style=svg)](https://circleci.com/gh/bunchtogether/braid-client-js) [![npm version](https://badge.fury.io/js/%40bunchtogether%2Fbraid-client.svg)](http://badge.fury.io/js/%40bunchtogether%2Fbraid-client) [![codecov](https://codecov.io/gh/bunchtogether/braid-client-js/branch/master/graph/badge.svg)](https://codecov.io/gh/bunchtogether/braid-client-js)

WebSocket-based key-value synchronization.

See also:

*   [Server](https://github.com/bunchtogether/braid-server)
*   [MessagePack Definitions](https://github.com/bunchtogether/braid-messagepack)

## API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

#### Table of Contents

*   [ConnectionError](#connectionerror)
    *   [Parameters](#parameters)
*   [CredentialsError](#credentialserror)
    *   [Parameters](#parameters-1)
*   [SubscribeError](#subscribeerror)
    *   [Parameters](#parameters-2)
*   [EventSubscribeError](#eventsubscribeerror)
    *   [Parameters](#parameters-3)
*   [PublishError](#publisherror)
    *   [Parameters](#parameters-4)
*   [ServerRequestError](#serverrequesterror)
    *   [Parameters](#parameters-5)
*   [Client](#client)
    *   [data](#data)
    *   [setReconnectHandler](#setreconnecthandler)
        *   [Parameters](#parameters-6)
    *   [open](#open)
        *   [Parameters](#parameters-7)
    *   [close](#close)
        *   [Parameters](#parameters-8)
    *   [sendCredentials](#sendcredentials)
        *   [Parameters](#parameters-9)
    *   [subscribe](#subscribe)
        *   [Parameters](#parameters-10)
    *   [sendSubscribeRequest](#sendsubscriberequest)
        *   [Parameters](#parameters-11)
    *   [unsubscribe](#unsubscribe)
        *   [Parameters](#parameters-12)
    *   [addServerEventListener](#addservereventlistener)
        *   [Parameters](#parameters-13)
    *   [sendEventSubscribeRequest](#sendeventsubscriberequest)
        *   [Parameters](#parameters-14)
    *   [removeServerEventListener](#removeservereventlistener)
        *   [Parameters](#parameters-15)
    *   [startPublishing](#startpublishing)
        *   [Parameters](#parameters-16)
    *   [publish](#publish)
        *   [Parameters](#parameters-17)
    *   [sendPublishRequest](#sendpublishrequest)
        *   [Parameters](#parameters-18)
    *   [stopPublishing](#stoppublishing)
        *   [Parameters](#parameters-19)

### ConnectionError

**Extends Error**

Class representing a connection error

#### Parameters

*   `message` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 

### CredentialsError

**Extends Error**

Class representing a credentials error

#### Parameters

*   `message` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
*   `code` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 

### SubscribeError

**Extends Error**

Class representing a subscribe error

#### Parameters

*   `itemKey` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
*   `message` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
*   `code` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 

### EventSubscribeError

**Extends Error**

Class representing an event subscribe error

#### Parameters

*   `itemName` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
*   `message` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
*   `code` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 

### PublishError

**Extends Error**

Class representing an publishing error

#### Parameters

*   `itemName` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
*   `message` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
*   `code` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 

### ServerRequestError

**Extends Error**

Class representing an error that interupts a pending server
request, for example if a connection closes prematurely

#### Parameters

*   `message` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
*   `code` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 

### Client

**Extends EventEmitter**

Class representing a Braid Client

#### data

Primary data object. Like a native JS Map but with 'set' and 'delete' events.

#### setReconnectHandler

Set the reconnect handler. The handler determines if the reconnect should continue.

##### Parameters

*   `func` **function ([Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)): [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** 

Returns **void** 

#### open

Connects to a server.

##### Parameters

*   `address` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Websocket URL of the server
*   `credentials` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** Credentials to send

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### close

Close connection to server.

##### Parameters

*   `code` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?** Websocket close reason code to send to the server
*   `reason` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?** Websocket close reason to send to the server

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### sendCredentials

Send credentials to a server with an open connection.

##### Parameters

*   `credentials` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** Credentials to send

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### subscribe

Subscribe to updates on a key.

##### Parameters

*   `key` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Key to request updates on

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### sendSubscribeRequest

Send subscribe request to server

##### Parameters

*   `key` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Key to request updates on

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### unsubscribe

Unsubscribe from updates on a key. If the callback parameter is not provided, all callbacks are unsubscribed.

##### Parameters

*   `key` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Key to stop updates on

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### addServerEventListener

Subscribe to a server event

##### Parameters

*   `name` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Name of the event to listen for
*   `callback` **function (): void** 

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### sendEventSubscribeRequest

Send event subscribe request to server

##### Parameters

*   `name` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Name of the event to listen for

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### removeServerEventListener

Unsubscribe from a server event. If the callback parameter is not provided, all callbacks are unsubscribed.

##### Parameters

*   `name` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Name of the event to stop listening
*   `callback` **function (any): void?** 

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### startPublishing

Start publishing to a receiver

##### Parameters

*   `name` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Name of the receiver to start publishing to

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### publish

Publish message to a receiver

##### Parameters

*   `name` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Name of the receiver
*   `message` **any** Value to publish, should not contain undefined values

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### sendPublishRequest

Send event subscribe request to server

##### Parameters

*   `name` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Name of the event to listen for

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 

#### stopPublishing

Stop publishing to a receiver.

##### Parameters

*   `name` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Name of the receiver to stop publishing to

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>** 
