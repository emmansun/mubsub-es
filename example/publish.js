const mubsub = require('../lib/index')

const client = mubsub(process.env.MONGODB_URI || 'mongodb://localhost:27017/mubsub_example')
const channel = client.channel('example')

channel.on('error', console.error)
client.on('error', console.error)

setInterval(function () {
  channel.publish('foo', { foo: 'bar', time: Date.now() }, function (err) {
    if (err) throw err
  })
}, 2000)
