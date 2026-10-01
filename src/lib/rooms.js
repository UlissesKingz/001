import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const socketRooms = new Map();
const cleanupTimers = new Map();

const nicknameSchema = z.string()
  .trim()
  .min(2)
  .max(18)
  .regex(/^[\p{L}\p{N} _.-]+$/u, 'invalid_nickname');

const deviceSchema = z.enum(['desktop', 'mobile']);
const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/);

function randomRoomCode() {
  for (let tries = 0; tries < 100; tries++) {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (const b of bytes) code += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error('room_code_exhausted');
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.roomCode || !payload?.playerId || !payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function memberCount(room) {
  return room.players.length + room.bots.length;
}

function allSeats(room) {
  return [...room.players, ...room.bots].sort((a, b) => a.seat - b.seat);
}

function nextSeat(room) {
  const used = new Set(allSeats(room).map(p => p.seat));
  for (let i = 0; i < 4; i++) if (!used.has(i)) return i;
  return -1;
}

function nicknameTaken(room, nickname, excludingId = null) {
  const target = nickname.toLocaleLowerCase('pt-BR');
  return allSeats(room).some(p => p.id !== excludingId && p.nickname.toLocaleLowerCase('pt-BR') === target);
}

function publicRoom(room, viewerId = null) {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    viewerId,
    gameNo: room.gameNo,
    createdAt: room.createdAt,
    players: allSeats(room).map(p => ({
      id: p.id,
      nickname: p.nickname,
      device: p.device,
      type: p.type,
      seat: p.seat,
      connected: p.type === 'bot' ? true : Boolean(p.connected),
      isHost: p.id === room.hostId
    })),
    restart: room.restart ? {
      requestedBy: room.restart.requestedBy,
      votes: Object.fromEntries(room.restart.votes),
      requiredHumanIds: room.players.map(p => p.id)
    } : null
  };
}

function emitRoom(io, room) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('room:state', publicRoom(room, p.id));
  }
}

function clearCleanup(playerId) {
  const t = cleanupTimers.get(playerId);
  if (t) clearTimeout(t);
  cleanupTimers.delete(playerId);
}

function transferHost(room) {
  if (room.players.some(p => p.id === room.hostId && p.connected)) return;
  const next = room.players.find(p => p.connected) || room.players[0];
  room.hostId = next?.id || null;
}

function removePlayer(io, room, playerId) {
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) return;
  room.players.splice(idx, 1);
  clearCleanup(playerId);
  if (room.hostId === playerId) transferHost(room);
  if (!room.players.length) {
    rooms.delete(room.code);
    return;
  }
  emitRoom(io, room);
}

function getContext(socket) {
  const ref = socketRooms.get(socket.id);
  if (!ref) return null;
  const room = rooms.get(ref.roomCode);
  if (!room) return null;
  const player = room.players.find(p => p.id === ref.playerId);
  if (!player) return null;
  return { room, player };
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

export function attachRoomHandlers(io) {
  io.on('connection', socket => {
    socket.on('room:create', (raw, ack) => {
      const parsed = z.object({ nickname: nicknameSchema, device: deviceSchema }).safeParse(raw);
      if (!parsed.success) return safeAck(ack, { ok: false, error: 'invalid_input' });

      const code = randomRoomCode();
      const playerId = crypto.randomUUID();
      const room = {
        code,
        hostId: playerId,
        phase: 'lobby',
        gameNo: 0,
        createdAt: Date.now(),
        players: [{
          id: playerId,
          socketId: socket.id,
          nickname: parsed.data.nickname,
          device: parsed.data.device,
          type: 'human',
          seat: 0,
          connected: true
        }],
        bots: [],
        restart: null
      };
      rooms.set(code, room);
      socketRooms.set(socket.id, { roomCode: code, playerId });
      socket.join(code);
      const token = signSession({ roomCode: code, playerId, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
      safeAck(ack, { ok: true, token, room: publicRoom(room, playerId) });
      emitRoom(io, room);
    });

    socket.on('room:join', (raw, ack) => {
      const parsed = z.object({ code: roomCodeSchema, nickname: nicknameSchema, device: deviceSchema }).safeParse(raw);
      if (!parsed.success) return safeAck(ack, { ok: false, error: 'invalid_input' });
      const room = rooms.get(parsed.data.code);
      if (!room) return safeAck(ack, { ok: false, error: 'room_not_found' });
      if (room.phase !== 'lobby') return safeAck(ack, { ok: false, error: 'game_already_started' });
      if (memberCount(room) >= 4) return safeAck(ack, { ok: false, error: 'room_full' });
      if (nicknameTaken(room, parsed.data.nickname)) return safeAck(ack, { ok: false, error: 'nickname_taken' });
      const seat = nextSeat(room);
      if (seat < 0) return safeAck(ack, { ok: false, error: 'room_full' });

      const playerId = crypto.randomUUID();
      room.players.push({
        id: playerId,
        socketId: socket.id,
        nickname: parsed.data.nickname,
        device: parsed.data.device,
        type: 'human',
        seat,
        connected: true
      });
      socketRooms.set(socket.id, { roomCode: room.code, playerId });
      socket.join(room.code);
      const token = signSession({ roomCode: room.code, playerId, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
      safeAck(ack, { ok: true, token, room: publicRoom(room, playerId) });
      emitRoom(io, room);
    });

    socket.on('room:resume', (raw, ack) => {
      const token = typeof raw?.token === 'string' ? raw.token : '';
      const session = verifySession(token);
      if (!session) return safeAck(ack, { ok: false, error: 'invalid_session' });
      const room = rooms.get(session.roomCode);
      if (!room) return safeAck(ack, { ok: false, error: 'room_not_found' });
      const player = room.players.find(p => p.id === session.playerId);
      if (!player) return safeAck(ack, { ok: false, error: 'player_not_found' });
      clearCleanup(player.id);
      player.socketId = socket.id;
      player.connected = true;
      socketRooms.set(socket.id, { roomCode: room.code, playerId: player.id });
      socket.join(room.code);
      safeAck(ack, { ok: true, room: publicRoom(room, player.id) });
      emitRoom(io, room);
      if (room.phase === 'game') socket.emit('game:start', { room: publicRoom(room, player.id), resumed: true });
    });

    socket.on('room:addBot', (_raw, ack) => {
      const ctx = getContext(socket);
      if (!ctx) return safeAck(ack, { ok: false, error: 'not_in_room' });
      const { room, player } = ctx;
      if (room.phase !== 'lobby') return safeAck(ack, { ok: false, error: 'not_in_lobby' });
      if (room.hostId !== player.id) return safeAck(ack, { ok: false, error: 'host_only' });
      if (memberCount(room) >= 4) return safeAck(ack, { ok: false, error: 'room_full' });
      const seat = nextSeat(room);
      const botNo = room.bots.length ? Math.max(...room.bots.map(b => b.botNo || 0)) + 1 : 1;
      room.bots.push({ id: `bot-${crypto.randomUUID()}`, nickname: `BOT ${botNo}`, device: 'server', type: 'bot', seat, botNo });
      emitRoom(io, room);
      safeAck(ack, { ok: true });
    });

    socket.on('room:removeBot', (raw, ack) => {
      const parsed = z.object({ botId: z.string().min(5).max(80) }).safeParse(raw);
      if (!parsed.success) return safeAck(ack, { ok: false, error: 'invalid_input' });
      const ctx = getContext(socket);
      if (!ctx) return safeAck(ack, { ok: false, error: 'not_in_room' });
      const { room, player } = ctx;
      if (room.phase !== 'lobby') return safeAck(ack, { ok: false, error: 'not_in_lobby' });
      if (room.hostId !== player.id) return safeAck(ack, { ok: false, error: 'host_only' });
      room.bots = room.bots.filter(b => b.id !== parsed.data.botId);
      emitRoom(io, room);
      safeAck(ack, { ok: true });
    });

    socket.on('room:start', (_raw, ack) => {
      const ctx = getContext(socket);
      if (!ctx) return safeAck(ack, { ok: false, error: 'not_in_room' });
      const { room, player } = ctx;
      if (room.hostId !== player.id) return safeAck(ack, { ok: false, error: 'host_only' });
      if (room.phase !== 'lobby') return safeAck(ack, { ok: false, error: 'already_started' });
      if (memberCount(room) < 2) return safeAck(ack, { ok: false, error: 'need_two_players' });
      room.phase = 'game';
      room.gameNo += 1;
      room.restart = null;
      emitRoom(io, room);
      io.to(room.code).emit('game:start', { room: publicRoom(room) });
      safeAck(ack, { ok: true });
    });

    socket.on('room:leave', (_raw, ack) => {
      const ctx = getContext(socket);
      if (!ctx) return safeAck(ack, { ok: true });
      const { room, player } = ctx;
      socketRooms.delete(socket.id);
      socket.leave(room.code);
      removePlayer(io, room, player.id);
      safeAck(ack, { ok: true });
    });

    socket.on('restart:request', (_raw, ack) => {
      const ctx = getContext(socket);
      if (!ctx) return safeAck(ack, { ok: false, error: 'not_in_room' });
      const { room, player } = ctx;
      if (room.phase !== 'game') return safeAck(ack, { ok: false, error: 'not_in_game' });
      if (room.restart) return safeAck(ack, { ok: false, error: 'restart_pending' });
      room.restart = { requestedBy: player.id, votes: new Map([[player.id, true]]), createdAt: Date.now() };
      emitRoom(io, room);
      io.to(room.code).emit('restart:requested', { requestedBy: player.id });
      if (room.players.length === 1) {
        room.gameNo += 1;
        room.restart = null;
        io.to(room.code).emit('game:restart', { gameNo: room.gameNo });
        emitRoom(io, room);
      }
      safeAck(ack, { ok: true });
    });

    socket.on('restart:vote', (raw, ack) => {
      const parsed = z.object({ accept: z.boolean() }).safeParse(raw);
      if (!parsed.success) return safeAck(ack, { ok: false, error: 'invalid_input' });
      const ctx = getContext(socket);
      if (!ctx) return safeAck(ack, { ok: false, error: 'not_in_room' });
      const { room, player } = ctx;
      if (!room.restart) return safeAck(ack, { ok: false, error: 'no_restart_pending' });
      room.restart.votes.set(player.id, parsed.data.accept);
      if (!parsed.data.accept) {
        room.restart = null;
        io.to(room.code).emit('restart:rejected', { by: player.id });
        emitRoom(io, room);
        return safeAck(ack, { ok: true, result: 'rejected' });
      }
      const allAccepted = room.players.every(p => room.restart.votes.get(p.id) === true);
      if (allAccepted) {
        room.gameNo += 1;
        room.restart = null;
        io.to(room.code).emit('game:restart', { gameNo: room.gameNo });
        emitRoom(io, room);
        return safeAck(ack, { ok: true, result: 'accepted' });
      }
      emitRoom(io, room);
      safeAck(ack, { ok: true, result: 'pending' });
    });

    socket.on('disconnect', () => {
      const ref = socketRooms.get(socket.id);
      socketRooms.delete(socket.id);
      if (!ref) return;
      const room = rooms.get(ref.roomCode);
      if (!room) return;
      const player = room.players.find(p => p.id === ref.playerId);
      if (!player) return;
      player.connected = false;
      player.socketId = null;
      transferHost(room);
      emitRoom(io, room);
      clearCleanup(player.id);
      const delay = room.phase === 'game' ? 120_000 : 30_000;
      cleanupTimers.set(player.id, setTimeout(() => {
        const currentRoom = rooms.get(room.code);
        const currentPlayer = currentRoom?.players.find(p => p.id === player.id);
        if (currentRoom && currentPlayer && !currentPlayer.connected) removePlayer(io, currentRoom, player.id);
      }, delay));
    });
  });
}
