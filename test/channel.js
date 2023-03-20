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
})
