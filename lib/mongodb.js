const mongoose = require('mongoose');

let cached = global.mongoose || { conn: null, promise: null };

async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    cached.conn = mongoose;
    return cached.conn;
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gatewise';
    cached.promise = (async () => {
      try {
        return await mongoose.connect(MONGODB_URI, {
          serverSelectionTimeoutMS: 2000,
          bufferCommands: false,
        });
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('Local MongoDB not running. Launching in-memory Mongo server...');
          const { MongoMemoryServer } = require('mongodb-memory-server');
          const mongod = await MongoMemoryServer.create();
          return await mongoose.connect(mongod.getUri());
        }
        throw e;
      }
    })();
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  global.mongoose = cached;
  return cached.conn;
}

module.exports = { connectToDatabase };
