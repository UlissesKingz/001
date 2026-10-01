import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';

import { config } from './src/lib/config.js';
import { connectMongo, mongoReady } from './src/lib/mongo.js';
import { applySecurity } from './src/middleware/security.js';
import { requireAllowedOrigin, isAllowedOrigin } from './src/middleware/origin.js';
import { socketSecurity } from './src/lib/socketSecurity.js';
import { attachRoomHandlers } from './src/lib/rooms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
applySecurity(app);

app.use(express.json({
  limit: '16kb',
  type: ['application/json', 'application/*+json']
}));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use('/api', requireAllowedOrigin);

app.get('/health', (_req, res) => {
  if (!mongoReady()) {
    return res.status(503).json({ ok: false, database: 'unavailable' });
  }
  return res.status(200).json({ ok: true });
});

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    database: mongoReady(),
    version: '0.1.0'
  });
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: config.NODE_ENV === 'production' ? '1h' : 0,
  immutable: false,
  dotfiles: 'deny',
  index: 'index.html'
}));

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err, _req, res, _next) => {
  console.error('Request error:', err?.message || 'unknown');
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal_error' });
});

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  serveClient: true,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 64 * 1024,
  cors: {
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
    methods: ['GET', 'POST'],
    credentials: false
  }
});

socketSecurity(io);

// Lobby/room coordination is authoritative on the server.
// The game engine itself will be migrated server-side in the next implementation phase.
attachRoomHandlers(io);

async function main() {
  await connectMongo();

  server.listen(config.PORT, '0.0.0.0', () => {
    console.log(`001 listening on port ${config.PORT}`);
  });
}

function shutdown(signal) {
  console.log(`${signal}: graceful shutdown`);
  io.close(() => {
    server.close(() => process.exit(0));
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  console.error('Startup failed:', err?.message || err);
  process.exit(1);
});
