const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { Server } = require('socket.io');
const storage = require('./src/storage');
const game = require('./src/game');

const PORT = Number(process.env.PORT || 3000);
const app = express();
const server = http.createServer(app);
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || process.env.APP_ORIGINS || process.env.PUBLIC_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function originAllowed(origin) {
  if (!origin || allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (originAllowed(origin)) return callback(null, true);
      return callback(new Error('Origem não autorizada.'), false);
    },
    credentials: false
  },
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 64 * 1024
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/', (_req, res) => res.redirect('/device.html'));
app.get('/desktop', (_req, res) => res.redirect('/desktop.html'));
app.get('/mobile', (_req, res) => res.redirect('/mobile.html'));
app.get('/health', (_req, res) => res.json({ ok: true, storage: storage.status(), rooms: game.rooms.size }));

function adminAuth(req, res, next) {
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!password) return res.status(503).send('ADMIN_PASSWORD não configurada.');
  const header = String(req.headers.authorization || '');
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="001 Admin"');
    return res.status(401).send('Autenticação necessária.');
  }
  let supplied = '';
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    supplied = decoded.slice(decoded.indexOf(':') + 1);
  } catch {
    supplied = '';
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(password);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.set('WWW-Authenticate', 'Basic realm="001 Admin"');
    return res.status(401).send('Senha inválida.');
  }
  next();
}

app.get('/dev-salas', adminAuth, (_req, res) => res.sendFile(path.join(__dirname, 'admin', 'dev-salas.html')));
app.get('/api/admin/rooms', adminAuth, (_req, res) => res.json({ ok: true, rooms: game.liveRoomSummaries(), storage: storage.status() }));
app.get('/api/admin/matches', adminAuth, async (req, res) => {
  try {
    const matches = await storage.recentMatches(req.query.limit || 50);
    res.json({ ok: true, matches, storage: storage.status() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

const socketContext = new Map();
const emptyRoomTimers = new Map();
const botTurnTimers = new Map();
const rateBuckets = new Map();
const EMPTY_ROOM_CLOSE_MS = 10 * 60 * 1000;
const BOT_ACTION_DELAY_MS = Math.max(250, Math.min(1000, Number(process.env.BOT_ACTION_DELAY_MS || 500)));

function clientIp(socket) {
  const forwarded = String(socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || socket.handshake.address || 'unknown';
}

function rateLimit(socket, key, limit, windowMs) {
  const now = Date.now();
  const bucketKey = `${clientIp(socket)}:${key}`;
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(bucketKey, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) throw new Error('Muitas tentativas em pouco tempo. Aguarde alguns instantes.');
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets.entries()) if (now > bucket.resetAt + 300000) rateBuckets.delete(key);
}, 300000).unref?.();

function safeAck(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function contextFor(socket) {
  const ref = socketContext.get(socket.id);
  if (!ref) return null;
  const room = game.rooms.get(ref.roomCode);
  if (!room) return null;
  const player = game.findViewer(room, ref.playerId);
  if (!player) return null;
  return { room, player };
}

function bindSocket(socket, room, player) {
  socketContext.set(socket.id, { roomCode: room.code, playerId: player.id });
  socket.join(room.code);
  cancelRoomCleanup(room.code);
}

function emitRoom(room) {
  const viewers = [...room.players, ...(room.spectators || [])];
  for (const player of viewers) {
    if ((player.type !== 'human' && player.type !== 'spectator') || !player.socketId || !player.connected) continue;
    io.to(player.socketId).emit('room:state', game.publicRoom(room, player.id));
  }
}

function emitGameStart(room) {
  for (const player of room.players) {
    if (player.type !== 'human' || !player.socketId || !player.connected) continue;
    io.to(player.socketId).emit('game:start', game.publicRoom(room, player.id));
  }
}

function maybeRecord(room) {
  if (!room?.game || room.game.phase !== 'gameover' || room.game.recorded) return;
  storage.recordMatch(room).catch((error) => console.warn('[MongoDB] registro:', error.message));
}

function cancelBotTurn(code) {
  const timer = botTurnTimers.get(code);
  if (timer) clearTimeout(timer);
  botTurnTimers.delete(code);
}

function scheduleBotTurn(room, delay = BOT_ACTION_DELAY_MS) {
  if (!room || !game.rooms.has(room.code) || !game.isBotTurn(room)) {
    if (room?.code) cancelBotTurn(room.code);
    return;
  }
  if (botTurnTimers.has(room.code)) return;
  const timer = setTimeout(() => {
    botTurnTimers.delete(room.code);
    const live = game.rooms.get(room.code);
    if (!live || !game.isBotTurn(live)) return;
    try {
      game.runBotAction(live);
      maybeRecord(live);
      emitRoom(live);
      if (game.isBotTurn(live)) scheduleBotTurn(live);
    } catch (error) {
      console.warn(`[BOT ${live.code}]`, error.message);
    }
  }, delay);
  timer.unref?.();
  botTurnTimers.set(room.code, timer);
}

function cancelRoomCleanup(code) {
  const timer = emptyRoomTimers.get(code);
  if (timer) clearTimeout(timer);
  emptyRoomTimers.delete(code);
}

function scheduleRoomCleanup(room) {
  cancelRoomCleanup(room.code);
  if (room.players.some((player) => player.type === 'human' && player.connected)) return;
  const timer = setTimeout(() => {
    const current = game.rooms.get(room.code);
    if (current && !current.players.some((player) => player.type === 'human' && player.connected)) {
      cancelBotTurn(room.code);
      game.rooms.delete(room.code);
    }
    emptyRoomTimers.delete(room.code);
  }, EMPTY_ROOM_CLOSE_MS);
  timer.unref?.();
  emptyRoomTimers.set(room.code, timer);
}

function action(socket, ack, fn) {
  try {
    rateLimit(socket, 'action', Number(process.env.SOCKET_RATE_LIMIT_MAX || 180), 60000);
    const ctx = contextFor(socket);
    if (!ctx) throw new Error('Você não está em uma sala.');
    const result = fn(ctx);
    maybeRecord(ctx.room);
    emitRoom(ctx.room);
    safeAck(ack, { ok: true, result });
    scheduleBotTurn(ctx.room);
  } catch (error) {
    safeAck(ack, { ok: false, error: error.message });
  }
}

io.on('connection', (socket) => {
  if (!originAllowed(socket.handshake.headers.origin)) return socket.disconnect(true);

  socket.on('room:create', (payload = {}, ack) => {
    try {
      rateLimit(socket, 'room-create', 20, 60000);
      const { room, player } = game.createRoom({ name: payload.nickname || payload.name, device: payload.device, socketId: socket.id });
      bindSocket(socket, room, player);
      safeAck(ack, { ok: true, token: player.resumeToken, room: game.publicRoom(room, player.id) });
      emitRoom(room);
      scheduleBotTurn(room);
    } catch (error) {
      safeAck(ack, { ok: false, error: error.message });
    }
  });

  socket.on('room:join', (payload = {}, ack) => {
    try {
      rateLimit(socket, 'room-join', 30, 60000);
      const { room, player } = game.joinRoom({ code: payload.code, name: payload.nickname || payload.name, device: payload.device, socketId: socket.id });
      bindSocket(socket, room, player);
      safeAck(ack, { ok: true, token: player.resumeToken, room: game.publicRoom(room, player.id) });
      emitRoom(room);
      scheduleBotTurn(room);
    } catch (error) {
      safeAck(ack, { ok: false, error: error.message });
    }
  });

  socket.on('room:resume', (payload = {}, ack) => {
    try {
      const { room, player } = game.resumePlayer({ token: payload.token, socketId: socket.id, device: payload.device });
      bindSocket(socket, room, player);
      safeAck(ack, { ok: true, token: player.resumeToken, room: game.publicRoom(room, player.id) });
      emitRoom(room);
      scheduleBotTurn(room);
    } catch (error) {
      safeAck(ack, { ok: false, error: error.message });
    }
  });

  socket.on('room:addBot', (_payload, ack) => action(socket, ack, ({ room, player }) => game.addBot(room, player.id)));
  socket.on('room:removeBot', (payload = {}, ack) => action(socket, ack, ({ room, player }) => game.removeBot(room, player.id, payload.botId)));
  socket.on('room:start', (_payload, ack) => action(socket, ack, ({ room, player }) => {
    if (room.hostId !== player.id) throw new Error('Somente o criador da sala pode iniciar a partida.');
    game.startGame(room);
    setImmediate(() => emitGameStart(room));
    return true;
  }));

  socket.on('room:leave', (_payload, ack) => {
    try {
      const ctx = contextFor(socket);
      if (ctx) {
        game.leaveRoom(ctx.room, ctx.player.id);
        socket.leave(ctx.room.code);
        socketContext.delete(socket.id);
        if (game.rooms.has(ctx.room.code)) emitRoom(ctx.room);
      }
      safeAck(ack, { ok: true });
    } catch (error) {
      safeAck(ack, { ok: false, error: error.message });
    }
  });

  socket.on('game:draw', (_payload, ack) => action(socket, ack, ({ room, player }) => game.playerDraw(room, player.id)));
  socket.on('game:refresh', (_payload, ack) => action(socket, ack, ({ room, player }) => game.playerRefresh(room, player.id)));
  socket.on('game:capture', (payload = {}, ack) => action(socket, ack, ({ room, player }) => game.playerCapture(room, player.id, payload.cardIds)));
  socket.on('game:discard', (payload = {}, ack) => action(socket, ack, ({ room, player }) => game.playerDiscard(room, player.id, payload.cardId)));

  socket.on('restart:request', (_payload, ack) => action(socket, ack, ({ room, player }) => {
    const result = game.requestRestart(room, player.id);
    if (result.restarted) setImmediate(() => io.to(room.code).emit('game:restart'));
    else setImmediate(() => io.to(room.code).emit('restart:requested'));
    return result;
  }));

  socket.on('restart:vote', (payload = {}, ack) => action(socket, ack, ({ room, player }) => {
    const result = game.respondRestart(room, player.id, Boolean(payload.accept));
    if (result.rejected) setImmediate(() => io.to(room.code).emit('restart:rejected', { by: result.by }));
    if (result.restarted) setImmediate(() => io.to(room.code).emit('game:restart'));
    return result;
  }));

  socket.on('disconnect', () => {
    socketContext.delete(socket.id);
    const changed = game.markDisconnected(socket.id);
    for (const room of changed) {
      emitRoom(room);
      scheduleRoomCleanup(room);
    }
  });
});

async function main() {
  await storage.init();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`001 Online em http://localhost:${PORT}`);
    console.log(`MongoDB: ${storage.status().enabled ? 'ativo' : 'opcional/desativado'}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal}: encerrando...`);
  io.close();
  server.close(async () => {
    await storage.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  console.error('Falha ao iniciar:', error);
  process.exit(1);
});
