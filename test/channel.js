const assert = require('assert')
const mubsub = require('../lib/index')
const data = require('./fixtures/data')
const helpers = require('./helpers')

describe('Channel', function () {
  beforeEach(function () {
    this.client = mubsub(helpers.uri)
    this.client.on('error', (err) => console.log(err))
    this.channel = this.client.channel('channel')
  })
  afterEach(function () {
    this.channel.close()
  })

  it('unsubscribes properly', function (done) {
    const subscription = this.channel.subscribe('a', function (data) {
      assert.equal(data, 'a')
      subscription.unsubscribe()
      done()
    })

    this.channel.publish('a', 'a')
    this.channel.publish('a', 'a')
    this.channel.publish('a', 'a')
  })

  it('unsubscribes if channel is closed', function (done) {
    const self = this

    this.channel.subscribe('a', function (data) {
      assert.equal(data, 'a')
      self.channel.close()
      done()
    })

    this.channel.publish('a', 'a')
    this.channel.publish('a', 'a')
    this.channel.publish('a', 'a')
  })

  it('unsubscribes if client is closed', function (done) {
    const self = this

    this.channel.subscribe('a', function (data) {
      assert.equal(data, 'a')
      self.client.close(done)
    })

    this.channel.publish('a', 'a')
    this.channel.publish('a', 'a')
    this.channel.publish('a', 'a')
  })

  it('should not emit old events to a second client', function (done) {
    // const self = this
    const channel0 = this.client.channel('channel1')

    const subscription0 = channel0.subscribe('b', function (data) {
      subscription0.unsubscribe()
      assert.equal(data, 'b')

      // Client 0 have now published and received one event
      // Client 1 should not receive that event but should get the second event
      const client1 = mubsub(helpers.uri)
      const channel1 = client1.channel('channel1')

      const subscription1 = channel1.subscribe('b', function (data) {
        subscription1.unsubscribe()
        assert.equal(data, 'a')
        channel0.close()
        channel1.close()
        done()
      })

      channel1.publish('b', 'a')
    })

    channel0.publish('b', 'b')
  })

  it('race condition should not occur', function (done) {
    const client0 = this.client
    const client1 = mubsub(helpers.uri)

    client1.once('connect', function () {
      const channel0 = client0.channel('channel2')
      const channel1 = client1.channel('channel2')

      Promise.all([
        new Promise(function (resolve, reject) {
          client0.channels.channel2.once('error', reject)
          client0.channels.channel2.once('collection', resolve)
        }),
        new Promise(function (resolve, reject) {
          client1.channels.channel2.once('error', reject)
          client1.channels.channel2.once('collection', resolve)
        })
      ]).then(function () {
        channel0.close()
        channel1.close()
        done()
      }, done)
    })
  })

  it('can subscribe and publish different events', function (done) {
    let todo = 3
    const subscriptions = []

    function complete () {
      todo--

      if (!todo) {
        subscriptions.forEach(function (subscriptions) {
          subscriptions.unsubscribe()
        })

        done()
      }
    }

    subscriptions.push(
      this.channel.subscribe('a', function (data) {
        assert.equal(data, 'a')
        complete()
      })
    )

    subscriptions.push(
      this.channel.subscribe('b', function (data) {
        assert.deepEqual(data, { b: 1 })
        complete()
      })
    )

    subscriptions.push(
      this.channel.subscribe('c', function (data) {
        assert.deepEqual(data, ['c'])
        complete()
      })
    )

    this.channel.publish('a', 'a')
    this.channel.publish('b', { b: 1 })
    this.channel.publish('c', ['c'])
  })

  it('gets lots of subscribed data fast enough', function (done) {
    const channel = this.client.channel('channel.bench', {
      size: 1024 * 1024 * 100
    })

    const n = 5000
    let count = 0

    const subscription = channel.subscribe('a', function (_data) {
      assert.deepEqual(_data, data)

      if (++count === n) {
        subscription.unsubscribe()
        channel.close()
        done()
      }
    })

    for (let i = 0; i < n; i++) {
      channel.publish('a', data)
    }
  })

  it('supports polling mode publish and subscribe', function (done) {
    const channel = this.client.channel('channel.polling.basic', {
      mode: 'polling',
      pollInterval: 20
    })

    const subscription = channel.subscribe('a', function (payload) {
      assert.equal(payload, 'polling')
      subscription.unsubscribe()
      channel.close()
      done()
    })

    channel.publish('a', 'polling')
  })

  it('does not replay history in polling mode', function (done) {
    const name = 'channel.polling.nohistory'
    const channel0 = this.client.channel(name, {
      mode: 'polling',
      pollInterval: 20
    })

    channel0.publish('evt', 'old', function (err) {
      if (err) return done(err)

      const client1 = mubsub(helpers.uri)
      const channel1 = client1.channel(name, {
        mode: 'polling',
        pollInterval: 20
      })

      const subscription = channel1.subscribe('evt', function (data) {
        subscription.unsubscribe()
        assert.equal(data, 'new')
        channel0.close()
        channel1.close()
        client1.close(done)
      })

      channel1.publish('evt', 'new')
    })
  })

  it('falls back to polling in auto mode on uncapped collections', function (done) {
    const name = 'channel.auto.fallback'
    const self = this

    this.client.once('connect', function (db) {
      db.createCollection(name).then(() => {
        const channel = self.client.channel(name, {
          mode: 'auto',
          pollInterval: 20
        })

        const subscription = channel.subscribe('f', function (payload) {
          assert.equal(payload, 'ok')
          subscription.unsubscribe()
          channel.close()
          done()
        })

        channel.publish('f', 'ok')
      }).catch(done)
    })
  })

  it('creates ttl index for polling collection when configured', function (done) {
    const channel = this.client.channel('channel.polling.ttl', {
      mode: 'polling',
      pollInterval: 20,
      pollTtlSeconds: 60
    })

    channel.once('ready', function (collection) {
      collection.indexes().then((indexes) => {
        const ttlIndex = indexes.find((index) => index.name === '_mubsub_poll_ttl')
        assert.ok(ttlIndex)
        assert.equal(ttlIndex.expireAfterSeconds, 60)
        channel.close()
        done()
      }).catch(done)
    })
  })

  it('does not create ttl index for polling collection by default', function (done) {
    const channel = this.client.channel('channel.polling.ttl.default', {
      mode: 'polling',
      pollInterval: 20
    })

    channel.once('ready', function (collection) {
      collection.indexes().then((indexes) => {
        const ttlIndex = indexes.find((index) => index.name === '_mubsub_poll_ttl')
        assert.equal(ttlIndex, undefined)
        channel.close()
        done()
      }).catch(done)
    })
  })

  it('ignores poll ttl option in capped mode', function (done) {
    const channel = this.client.channel('channel.capped.ignore.ttl', {
      mode: 'capped',
      pollTtlSeconds: 60
    })

    channel.once('ready', function (collection) {
      collection.indexes().then((indexes) => {
        const ttlIndex = indexes.find((index) => index.name === '_mubsub_poll_ttl')
        assert.equal(ttlIndex, undefined)
        channel.close()
        done()
      }).catch(done)
    })
  })

  it('emits error in capped mode if existing collection is not capped', function (done) {
    const name = 'channel.capped.requires.capped'
    const self = this

    this.client.once('connect', function (db) {
      db.createCollection(name).then(() => {
        const channel = self.client.channel(name, {
          mode: 'capped'
        })

        channel.once('error', function (err) {
          assert.ok(err)
          assert.ok(String(err.message).toLowerCase().includes('not capped'))
          channel.close()
          done()
        })
      }).catch(done)
    })
  })
})
