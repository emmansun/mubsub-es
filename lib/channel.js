const EventEmitter = require('events');
const noop = function () {};

class Channel extends EventEmitter {
    /**
     * Channel constructor.
     *
     * @param {Connection} connection
     * @param {String} [name] optional channel/collection name, default is 'mubsub'
     * @param {Object} [options] optional options
     *   - `size` max size of the collection in bytes, default is 5mb
     *   - `max` max amount of documents in the collection
     *   - `retryInterval` time in ms to wait if no docs found, default is 200ms
     *   - `recreate` recreate the tailable cursor on error, default is true
     * @api public
     */    
    constructor(connection, name, options) {
        super();
        options || (options = {});
        this.options = {
            recreate: typeof options.recreate === 'boolean' ? options.recreate : true,
            retryInterval: typeof options.retryInterval === 'number' ? options.retryInterval : 200
          };
        
        this.collectionOpts = {
            capped: true,
            size: options.size || 1024 * 1024 * 5,
            max: options.max
        };
    
        this.options = options;
        this.connection = connection;
        this.closed = false;
        this.listening = null;
        this.name = name || 'mubsub';
    
        this.create().listen();
        this.setMaxListeners(0);        
    }

    /**
     * Close the channel.
     *
     * @return {Channel} this
     * @api public
     */
    close() {
        this.closed = true;

        return this;
    }

    /**
     * Publish an event.
     *
     * @param {String} event
     * @param {Object} [message]
     * @param {Function} [callback]
     * @return {Channel} this
     * @api public
     */
    publish(event, message, callback) {
        const options = callback ? { safe: true } : {};
        callback || (callback = noop);
    
        this.ready(function (collection) {
            collection.insertOne({ event: event, message: message }, options, function (err, result) {
                if (err) return callback(err);
                callback(null, result);
            });
        });
    
        return this;        
    }

    /**
     * Subscribe an event.
     *
     * @param {String} [event] if no event passed - all events are subscribed.
     * @param {Function} callback
     * @return {Object} unsubscribe function
     * @api public
    */
    subscribe(event, callback) {
        const self = this;

        if (typeof event == 'function') {
            callback = event;
            event = 'message';
        }
    
        this.on(event, callback);
    
        return {
            unsubscribe: function () {
                self.removeListener(event, callback);
            }
        };        
    }

    /**
     * Create a channel collection.
     *
     * @return {Channel} this
     * @api private
     */
    create() {
        const self = this;

        function create() {
            self.connection.db.createCollection(
                self.name,
                self.collectionOpts,
                function (err, collection) {
                    const collectionExistsError = err && (
                            err.message === 'collection already exists' ||
                            err.message.toLowerCase().includes('collection already exists') ||
                            err.message.match(/^a collection.+already exists$/)
                        );
                    if (collectionExistsError) {
                        self.collection = self.connection.db.collection(self.name);
                        self.emit('collection', self.collection);
                        return;
                    } else if (err) {
                        return self.emit('error', err);
                    }
    
                    self.emit('collection', self.collection = collection);
                }
            );
        }
    
        this.connection.db ? create() : this.connection.once('connect', create);
    
        return this;
    }

    /**
     * Create a listener which will emit events for subscribers.
     * It will listen to any document with event property.
     *
     * @param {Object} [latest] latest document to start listening from
     * @return {Channel} this
     * @api private
     */
    listen(latest) {
        const self = this;

        this.latest(latest, this.handle(true, function (latest, collection) {
            const cursor = collection
                    .find(
                        { _id: { $gt: latest._id }},
                        {
                            tailable: true,
                            awaitData: true,
                            timeout: false,
                            sortValue: {$natural: -1},
                            numberOfRetries: Number.MAX_VALUE,
                            tailableRetryInterval: self.options.retryInterval
                        }
                    );
    
            const next = self.handle(function (doc) {
                // There is no document only if the cursor is closed by accident.
                // F.e. if collection was dropped or connection died.
                if (!doc) {
                    return setTimeout(function () {
                        self.emit('error', new Error('Mubsub: broken cursor.'));
                        if (self.options.recreate) {
                            self.create().listen(latest);
                        }
                    }, 1000);
                }
    
                latest = doc;
    
                if (doc.event) {
                    self.emit(doc.event, doc.message);
                    self.emit('message', doc.message);
                }
                self.emit('document', doc);
                process.nextTick(more);
            });
    
            const more = function () {
                cursor.next(next);
            };
    
            more();
            self.listening = collection;
            self.emit('ready', collection);
        }));
    
        return this;
    }

    /**
     * Get the latest document from the collection. Insert a dummy object in case
     * the collection is empty, because otherwise we don't get a tailable cursor
     * and need to poll in a loop.
     *
     * @param {Object} [latest] latest known document
     * @param {Function} callback
     * @return {Channel} this
     * @api private
     */
    latest(latest, callback) {
        function onCollection(collection) {
            collection
                .find(latest ? { _id: latest._id } : null, {timeout: false})
                .sort({$natural: -1})
                .limit(1)
                .next(function (err, doc) {
                    if (err || doc) return callback(err, doc, collection);
    
                    collection.insertOne({ 'dummy': true }, { safe: true }, function (err, result) {
                        if (err) return callback(err);
                        callback(null, result, collection);
                    });
                });
        }
    
        this.collection ? onCollection(this.collection) : this.once('collection', onCollection);
    
        return this;
    }

    /**
     * Return a function which will handle errors and consider channel and connection
     * state.
     *
     * @param {Boolean} [exit] if error happens and exit is true, callback will not be called
     * @param {Function} callback
     * @return {Function}
     * @api private
     */
    handle(exit, callback) {
        const self = this;
    
        if (typeof exit === 'function') {
            callback = exit;
            exit = null;
        }
    
        return function () {
            if (self.closed || self.connection.destroyed) return;
    
            const args = [].slice.call(arguments);
            const err = args.shift();
    
            if (err) self.emit('error', err);
            if (err && exit) return;
    
            callback.apply(self, args);
        };
    }

    /**
     * Call back if collection is ready for publishing.
     *
     * @param {Function} callback
     * @return {Channel} this
     * @api private
     */
    ready(callback) {
        if (this.listening) {
            callback(this.listening);
        } else {
            this.once('ready', callback);
        }
    
        return this;        
    }
}

module.exports = Channel;
