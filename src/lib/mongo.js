import mongoose from 'mongoose';
import { config } from './config.js';

let connected = false;

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);

mongoose.connection.on('connected', () => {
  connected = true;
  console.log('MongoDB connected');
});
mongoose.connection.on('disconnected', () => {
  connected = false;
  console.warn('MongoDB disconnected');
});
mongoose.connection.on('error', (err) => {
  connected = false;
  console.error('MongoDB connection error:', err?.message || 'unknown');
});

export async function connectMongo() {
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    minPoolSize: 0,
    autoIndex: config.NODE_ENV !== 'production'
  });
}

export function mongoReady() {
  return connected && mongoose.connection.readyState === 1;
}
