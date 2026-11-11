import mongoose from 'mongoose';

const connectionStates = new Map([
  [0, 'disconnected'],
  [1, 'connected'],
  [2, 'connecting'],
  [3, 'disconnecting'],
]);

export function getDatabaseStatus() {
  return connectionStates.get(mongoose.connection.readyState) ?? 'unknown';
}

export async function connectDatabase(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
