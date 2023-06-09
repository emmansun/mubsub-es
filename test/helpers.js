const mubsub = require('../lib/index')

exports.uri =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/mubsub_tests'

exports.clear = function (done) {
  const self = this

  mubsub(exports.uri).on('connect', function (db) {
    if (self.client) self.client.close()
    db.dropDatabase().then(() => done())
  })
}

before(function (done) {
  exports.clear.call(this, done)
})

after(function (done) {
  exports.clear.call(this, done)
})
