const EventEmitter = require("events");
const MongoClient = require("mongodb").MongoClient;
const Channel = require("./channel");

class Connection extends EventEmitter {
  constructor(uri, options) {
    super();
    const self = this;

    options || (options = {});

    // It's a Db instance.
    if (uri.collection) {
      this.db = uri;
    } else {
      MongoClient.connect(uri, options, function (err, client) {
        if (err) return self.emit("error", err);
        self.client = client;
        self.db = client.db();
        self.emit("connect", self.db);
        self.client.on("error", function (err) {
          self.emit("error", err);
        });
      });
    }

    this.destroyed = false;
    this.channels = {};
  }

  get state() {
    let state;

    // Using 'destroyed' to be compatible with the driver.
    if (this.destroyed) {
      state = "destroyed";
    } else if (
      (this.db && !this.client) ||
      this.client?.topology?.isConnected()
    ) {
      // https://github.com/mongodb/node-mongodb-native/blob/d266158c9e968c92e8041211ef99f1783025be40/src/operations/connect.ts#L18
      state = "connected";
    } else {
      state = "connecting";
    }

    return state;
  }

  channel(name, options) {
    if (typeof name === "object") {
      options = name;
      name = "mubsub";
    }

    if (!this.channels[name] || this.channels[name].closed) {
      this.channels[name] = new Channel(this, name, options);
    }

    return this.channels[name];
  }

  close(callback) {
    this.destroyed = true;
    this.client?.close(callback);

    return this;
  }
}

module.exports = Connection;
