// Mongoose connection bootstrap. Reads MONGO_URI from env.
// Single global connection; reuses across requests.

import mongoose from 'mongoose';

let connectPromise = null;

export function connectDb() {
  if (connectPromise) return connectPromise;
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI not set — copy .env.example to .env and fill it in.');
  }
  mongoose.set('strictQuery', true);
  connectPromise = mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
  }).then(conn => {
    console.log(`[db] connected — ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  }).catch(err => {
    console.error('[db] connection failed:', err.message);
    connectPromise = null;
    throw err;
  });
  return connectPromise;
}

export function disconnectDb() {
  return mongoose.disconnect();
}
