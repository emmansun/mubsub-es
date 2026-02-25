const EventEmitter = require('events')
const noop = function () {}

class Channel extends EventEmitter {
  /**
   * Channel constructor.
   *
   * @param {Connection} connection
   * @param {String} [name] optional channel/collection name, default is 'mubsub'
   * @param {Object} [options] optional options
   *   - `size` max size of the collection in bytes, default is 5mb
   *   - `max` max amount of documents in the collection
   *   - `retryInterval` time in ms to wait if no docs found, default is 200ms (capped mode)
   *   - `pollInterval` time in ms between polling cycles, default is 1000ms (polling mode)
   *   - `pollTtlSeconds` ttl in seconds for polling collection retention, disabled by default
   *   - `mode` transport mode: auto | capped | polling, default is auto
   *   - `recreate` recreate the tailable cursor on error, default is true
   * @api public
   */
  constructor (connection, name, options) {
    super()
    options || (options = {})
    this.options = {
      recreate: typeof options.recreate === 'boolean' ? options.recreate : true,
      retryInterval:
        typeof options.retryInterval === 'number' ? options.retryInterval : 200,
      pollInterval:
        typeof options.pollInterval === 'number' ? options.pollInterval : 1000,
      pollTtlSeconds:
        typeof options.pollTtlSeconds === 'number' ? options.pollTtlSeconds : 0,
      mode: ['auto', 'capped', 'polling'].includes(options.mode)
        ? options.mode
        : 'auto'
    }

    this.collectionOpts = {
      capped: true,
      size: options.size || 1024 * 1024 * 5,
      max: options.max
    }

    this.connection = connection
    this.closed = false
    this.listening = null
    this.transport = null
    this.pollingTimer = null
    this.name = name || 'mubsub'

    this.initializeTransport()
    this.setMaxListeners(0)
  }

  /**
   * Close the channel.
   *
   * @return {Channel} this
   * @api public
   */
  close () {
    this.closed = true
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer)
      this.pollingTimer = null
    }

    return this
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
  publish (event, message, callback) {
    callback || (callback = noop)

    this.ready(function (collection) {
      collection
        .insertOne({ event, message, _ts: new Date() })
        .then((result) => {
          callback(null, { _id: result.insertedId })
        })
        .catch((err) => {
          callback(err)
        })
    })

    return this
  }

  /**
   * Subscribe an event.
   *
   * @param {String} [event] if no event passed - all events are subscribed.
   * @param {Function} callback
   * @return {Object} unsubscribe function
   * @api public
   */
  subscribe (event, callback) {
    const self = this

    if (typeof event === 'function') {
      callback = event
      event = 'message'
    }

    this.on(event, callback)

    return {
      unsubscribe: function () {
        self.removeListener(event, callback)
      }
    }
  }

  /**
   * Initialize transport for the channel.
   *
   * @return {Channel} this
   * @api private
   */
  initializeTransport () {
    const mode = this.options.mode

    if (mode === 'polling') {
      return this.createPolling().startPollingListener()
    }

    if (mode === 'capped') {
      return this.createCapped().startTailableListener()
    }

    this.createCapped().startTailableListener(undefined, true)

    return this
  }

  /**
   * Create a channel collection.
   *
   * @return {Channel} this
   * @api private
   */
  createCapped () {
    const self = this

    function create () {
      self.connection.db
        .createCollection(self.name, self.collectionOpts)
        .then((collection) => {
          self.collection = collection
          self.transport = 'capped'
          self.emit('collection', self.collection)
        })
        .catch((err) => {
          const collectionExistsError =
            err &&
            (err.codeName === 'NamespaceExists' ||
              err.message === 'collection already exists' ||
              err.message.toLowerCase().includes('collection already exists') ||
              err.message.match(/^a collection.+already exists$/) ||
              err.message.match(/^Collection.+already exists\.$/))
          if (collectionExistsError) {
            const collection = self.connection.db.collection(self.name)
            collection.isCapped().then((capped) => {
              if (!capped) {
                if (self.options.mode === 'auto') {
                  self.collection = collection
                  self.transport = 'polling'
                  self.emit('collection', self.collection)
                } else {
                  self.emit('error', new Error(`${err.message}, but it's NOT capped.`))
                }
              } else {
                self.collection = collection
                self.transport = 'capped'
                self.emit('collection', self.collection)
              }
            })
          } else if (err) {
            if (self.options.mode === 'auto' && self.isCappedUnsupportedError(err)) {
              self.createPolling()
            } else {
              self.emit('error', err)
            }
          }
        })
    }

    this.connection.db ? create() : this.connection.once('connect', create)

    return this
  }

  /**
   * Create or open a polling channel collection.
   *
   * @return {Channel} this
   * @api private
   */
  createPolling () {
    const self = this

    function openCollection () {
      self.connection.db
        .createCollection(self.name)
        .then((collection) => {
          self.collection = collection
          self.transport = 'polling'
          self.ensurePollingTtlIndex(collection)
            .then(() => {
              self.emit('collection', self.collection)
            })
            .catch((err) => {
              self.emit('error', err)
            })
        })
        .catch((err) => {
          const collectionExistsError =
            err &&
            (err.codeName === 'NamespaceExists' ||
              err.message === 'collection already exists' ||
              err.message.toLowerCase().includes('collection already exists') ||
              err.message.match(/^a collection.+already exists$/) ||
              err.message.match(/^Collection.+already exists\.$/))

          if (collectionExistsError) {
            const collection = self.connection.db.collection(self.name)
            self.collection = collection
            self.transport = 'polling'
            self.ensurePollingTtlIndex(collection)
              .then(() => {
                self.emit('collection', self.collection)
              })
              .catch((ttlErr) => {
                self.emit('error', ttlErr)
              })
          } else if (err) {
            self.emit('error', err)
          }
        })
    }

    this.connection.db ? openCollection() : this.connection.once('connect', openCollection)

    return this
  }

  /**
   * Ensure polling collection has TTL index if configured.
   *
   * @param {Collection} collection
   * @return {Promise<void>}
   * @api private
   */
  ensurePollingTtlIndex (collection) {
    const pollTtlSeconds = this.options.pollTtlSeconds

    if (!pollTtlSeconds || pollTtlSeconds <= 0) {
      return Promise.resolve()
    }

    return collection
      .createIndex({ _ts: 1 }, { expireAfterSeconds: pollTtlSeconds, name: '_mubsub_poll_ttl' })
      .then(() => {})
  }

  /**
   * Determine whether current error implies capped/tailable unsupported.
   *
   * @param {Error} err
   * @return {Boolean}
   * @api private
   */
  isCappedUnsupportedError (err) {
    if (!err) return false
    const message = `${err.message || ''}`.toLowerCase()
    const codeName = `${err.codeName || ''}`.toLowerCase()

    return (
      message.includes('not capped') ||
      message.includes('capped') ||
      message.includes('tailable') ||
      message.includes('special') ||
      message.includes('unsupported') ||
      codeName.includes('commandnotsupported') ||
      codeName.includes('illegaloperation')
    )
  }

  /**
   * Create a listener which will emit events for subscribers.
   * It will listen to any document with event property.
   *
   * @param {Object} [latest] latest document to start listening from
   * @param {Boolean} [allowFallback] whether to fallback to polling on unsupported capped mode
   * @return {Channel} this
   * @api private
   */
  startTailableListener (latest, allowFallback) {
    const self = this

    this.latest(
      latest,
      { insertDummy: true },
      this.handle(true, function (latest, collection) {
        const cursor = collection.find(
          { _id: { $gt: latest._id } },
          {
            tailable: true,
            awaitData: true,
            timeout: false,
            maxAwaitTimeMS: self.options.retryInterval
          }
        ).hint({ $natural: 1 })
        const next = self.handle(function (doc) {
          // There is no document only if the cursor is closed by accident.
          // F.e. if collection was dropped or connection died.
          if (!doc) {
            return setTimeout(function () {
              self.emit('error', new Error('Mubsub: broken cursor.'))
              if (self.options.recreate) {
                self.create().listen(latest)
              }
            }, 1000)
          }
          latest = doc
          if (doc.event) {
            self.emit(doc.event, doc.message)
            self.emit('message', doc.message)
          }

          self.emit('document', doc)
          process.nextTick(more)
        })

        const more = function () {
          cursor
            .next()
            .then((doc) => next(undefined, doc))
            .catch((err) => next(err))
        }

        more()
        self.listening = collection
        self.emit('ready', collection)
      }, function (err) {
        if (allowFallback && self.options.mode === 'auto' && self.isCappedUnsupportedError(err)) {
          self.collection = null
          self.createPolling().startPollingListener(latest)
          return true
        }

        return false
      })
    )

    return this
  }

  /**
   * Start polling listener mode.
   *
   * @param {Object} [latest] latest document to start listening from
   * @return {Channel} this
   * @api private
   */
  startPollingListener (latest) {
    const self = this

    this.latest(
      latest,
      { insertDummy: false },
      this.handle(true, function (cursor, collection) {
        self.listening = collection
        self.emit('ready', collection)

        const poll = function () {
          if (self.closed || self.connection.destroyed) {
            return
          }

          collection
            .find({ _id: { $gt: cursor._id } })
            .sort({ _id: 1 })
            .toArray()
            .then((docs) => {
              if (docs.length) {
                docs.forEach((doc) => {
                  cursor = doc
                  if (doc.event) {
                    self.emit(doc.event, doc.message)
                    self.emit('message', doc.message)
                  }
                  self.emit('document', doc)
                })
              }

              self.pollingTimer = setTimeout(poll, self.options.pollInterval)
            })
            .catch((err) => {
              self.emit('error', err)
              self.pollingTimer = setTimeout(poll, self.options.pollInterval)
            })
        }

        poll()
      })
    )

    return this
  }

  /**
   * Get the latest document from the collection. Insert a dummy object in case
   * the collection is empty, because otherwise we don't get a tailable cursor
   * and need to poll in a loop.
   *
   * @param {Object} [latest] latest known document
   * @param {Object} [options]
   * @param {Boolean} [options.insertDummy]
   * @param {Function} callback
   * @return {Channel} this
   * @api private
   */
  latest (latest, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }

    const opts = Object.assign({ insertDummy: true }, options)

    function onCollection (collection) {
      const cursor = collection
        .find(latest ? { _id: latest._id } : {}, { timeout: false })
        .hint({ $natural: -1 })
        .limit(1)
      cursor
        .next()
        .then((doc) => {
          cursor.close() // Is this required?
          if (doc) { // further check if there are larger _id than this doc.
            collection.findOne({ _id: { $gt: doc._id } }, { sort: { _id: -1 } }).then((record) => {
              if (record) {
                return callback(undefined, record, collection)
              }
              return callback(undefined, doc, collection)
            }).catch(err => {
              console.warn(`failed to find the largest _id: ${err.message}, ignore it.`)
              return callback(undefined, doc, collection)
            })
          } else if (!opts.insertDummy) {
            callback(undefined, { _id: 0 }, collection)
          } else {
            collection
              .insertOne({ dummy: true })
              .then((result) => {
                callback(null, { _id: result.insertedId }, collection)
              })
              .catch((err) => {
                callback(err, undefined, collection)
              })
          }
        })
        .catch((err) => {
          callback(err, undefined, collection)
        })
    }

    this.collection
      ? onCollection(this.collection)
      : this.once('collection', onCollection)

    return this
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
  handle (exit, callback, recovery) {
    const self = this

    if (typeof exit === 'function') {
      callback = exit
      exit = null
    }

    return function () {
      if (self.closed || self.connection.destroyed) {
        return
      }

      const args = [].slice.call(arguments)
      const err = args.shift()
      if (err) {
        if (typeof recovery === 'function' && recovery.call(self, err)) {
          return
        }
        self.emit('error', err)
      }
      if (err && exit) return
      callback.apply(self, args)
    }
  }

  /**
   * Call back if collection is ready for publishing.
   *
   * @param {Function} callback
   * @return {Channel} this
   * @api private
   */
  ready (callback) {
    if (this.listening) {
      callback(this.listening)
    } else {
      this.once('ready', callback)
    }

    return this
  }
}

module.exports = Channel
