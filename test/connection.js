const assert = require('assert')
const mubsub = require('../lib/index')
const helpers = require('./helpers')

describe('Connection', function () {
  it('emits "error" event', function (done) {
    mubsub('mongodb://localhost:6666/mubsub_tests', {
      serverSelectionTimeoutMS: 3000
    }).on('error', function () {
      done()
    })
  })

  it('emits "connect" event', function (done) {
    this.client = mubsub(helpers.uri)

    this.client.on('connect', function (db) {
      done()
    })
  })

  it('states are correct', function (done) {
    const self = this

    this.client = mubsub(helpers.uri)

    this.client.on('connect', function () {
      assert.equal(self.client.state, 'connected')

      self.client.close(function () {
        assert.equal(self.client.state, 'destroyed')
        done()
      })
    })

    assert.equal(self.client.state, 'connecting')
  })
})
