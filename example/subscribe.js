const mubsub = require('../lib/index')

const client = mubsub(process.env.MONGODB_URI || 'mongodb://localhost:27017/mubsub_example')
const channel = client.channel('example', {
  mode: process.env.MUBSUB_MODE || 'auto',
  pollInterval: Number(process.env.MUBSUB_POLL_INTERVAL || 1000),
  pollTtlSeconds: Number(process.env.MUBSUB_POLL_TTL_SECONDS || 0)
})

channel.on('error', console.error)
client.on('error', console.error)

channel.subscribe('foo', function (message) {
  console.log(message)
})
