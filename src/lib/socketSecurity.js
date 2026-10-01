import { config } from './config.js';
import { isAllowedOrigin } from '../middleware/origin.js';

const buckets = new Map();

function socketKey(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : socket.handshake.address;
  return `${ip || 'unknown'}:${socket.id}`;
}

export function socketSecurity(io) {
  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;
    if (!isAllowedOrigin(origin)) {
      return next(new Error('origin_not_allowed'));
    }
    return next();
  });

  io.on('connection', (socket) => {
    const key = socketKey(socket);

    socket.use((_packet, next) => {
      const now = Date.now();
      const prev = buckets.get(key) || { start: now, count: 0 };

      if (now - prev.start >= 60_000) {
        prev.start = now;
        prev.count = 0;
      }

      prev.count += 1;
      buckets.set(key, prev);

      if (prev.count > config.SOCKET_RATE_LIMIT_MAX) {
        return next(new Error('rate_limited'));
      }
      return next();
    });

    socket.on('disconnect', () => {
      buckets.delete(key);
    });
  });
}
