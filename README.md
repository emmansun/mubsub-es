## mubsub

Mubsub is a pub/sub implementation for Node.js and MongoDB.  It utilizes Mongo's capped collections and tailable cursors to notify subscribers of inserted documents that match a given query. It supports mongodb driver 6.x and mongodb 7.x now.

[![NPM](https://img.shields.io/npm/v/mubsub-es.svg?style=flat)](http://npm.im/mubsub-es)
[![Run tests](https://github.com/emmansun/mubsub-es/actions/workflows/ci.yml/badge.svg)](https://github.com/emmansun/mubsub-es/actions/workflows/ci.yml)
[![NPM Downloads][npm-downloads-image]][npm-url]

## Example

```javascript
var mubsub = require('mubsub-es');

var client = mubsub('mongodb://localhost:27017/mubsub_example');
var channel = client.channel('test');

client.on('error', console.error);
channel.on('error', console.error);

channel.subscribe('bar', function (message) {
    console.log(message.foo); // => 'bar'
});

channel.subscribe('baz', function (message) {
    console.log(message); // => 'baz'
});

channel.publish('bar', { foo: 'bar' });
channel.publish('baz', 'baz');

```

## Usage

### Create a client

You can pass a Db instance or a URI string. For more information about the URI format visit [http://mongodb.github.io/node-mongodb-native/driver-articles/mongoclient.html](http://mongodb.github.io/node-mongodb-native/driver-articles/mongoclient.html)

```javascript
var mubsub = require('mubsub-es');

// Using a URI
var client = mubsub('mongodb://localhost:27017/mubsub_example', [options]);

// Passing a MongoDB driver `Db` instance directly.
var client = mubsub(new Db(...));
```

### Channels

A channel maps one-to-one with a capped collection (Mubsub will create these if they do not already exist in the database).  Optionally specify the byte size of the collection and/or the max number of documents in the collection when creating a channel.

**WARNING**: You should not create lots of channels because Mubsub will poll from the cursor position.

```javascript
var channel = client.channel('foo', { size: 100000, max: 500 });
```

Options:

 - `size` max size of the collection in bytes, default is 5mb
 - `max` max amount of documents in the collection
 - `retryInterval` time in ms to wait if no docs are found, default is 200ms. This options will be used to set **maxAwaitTimeMS** now. Reference [Tailable Cursor Option tailableRetryInterval Ignored](https://jira.mongodb.org/browse/NODE-2358)
 - `recreate` recreate the tailable cursor when an error occurs, default is true


**WARNING**: Don't remove collections with running publishers. It's possible for `mongod` to recreate the collection on the next insert (before Mubsub has the chance to do so).  If this happens the collection will be recreated as a normal, uncapped collection.

### Subscribe

```javascript
var subscription = channel.subscribe([event], callback);
```

Subscriptions register a callback to be called whenever a document matching the specified event is inserted (published) into the collection (channel).  You can omit the event to match all inserted documents. To later unsubscribe a particular callback, call `unsubscribe` on the returned subscription object:

```javascript
subscription.unsubscribe();
```
### Publish

```javascript
channel.publish(event, obj, [callback]);
```

Publishing a document simply inserts the document into the channel's capped collection.  A callback is optional.

**WARNING**: If you publish events concurrently, when mubsub re-listen the collection, the subscriber will receive some outdated events due to **latest** can't get the record with the max **_id**.
```javascript
    const cursor = collection
        .find(latest ? { _id: latest._id } : {}, { timeout: false })
        .hint({ $natural: -1 })
        .limit(1)

    const cursor = collection.find(
      { _id: { $gt: latest._id } },
      {
        tailable: true,
        awaitData: true,
        timeout: false,
        maxAwaitTimeMS: self.options.retryInterval
      }).hint({ $natural: 1 })        
```
### Listen to events

The following events will be emitted:

```javascript
// The given event was published
channel.on('myevent', console.log);

// Any event was published
channel.on('message', console.log);

// Document was inserted
channel.on('document', console.log);

// Mubsub is ready to receive new documents
channel.on('ready', console.log);

// Connection error
client.on('error', console.log);

// Channel error
channel.on('error', console.log);
```

### Close

```javascript
client.close();
```

Closes the MongoDB connection.

## Install

    npm install mubsub-es

## Tests

    make test

You can optionally specify the MongoDB URI to be used for tests:

    MONGODB_URI=mongodb://localhost:27017/mubsub_tests make test

## Projects using mubsub

- [simpleio](https://github.com/kof/simpleio) Simple long polling based communication.

[npm-downloads-image]: https://badgen.net/npm/dm/mubsub-es
[npm-url]: https://npmjs.org/package/mubsub-es
