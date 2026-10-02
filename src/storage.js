const DEFAULT_DB_NAME = '001_online';
let client = null;
let db = null;
let enabled = false;
let lastError = null;

async function init() {
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) {
    enabled = false;
    lastError = null;
    console.log('[MongoDB] MONGODB_URI não configurada; persistência desativada. O jogo continuará funcionando em memória.');
    return { enabled: false };
  }
  try {
    const { MongoClient } = require('mongodb');
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 7000 });
    await client.connect();
    db = client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);
    await db.collection('matches').createIndex({ matchId: 1 }, { unique: true });
    await db.collection('matches').createIndex({ finishedAt: -1 });
    enabled = true;
    lastError = null;
    console.log(`[MongoDB] Conectado a ${db.databaseName}.`);
    return { enabled: true };
  } catch (error) {
    enabled = false;
    lastError = error.message;
    console.warn(`[MongoDB] Persistência indisponível: ${error.message}. O jogo continuará funcionando em memória.`);
    return { enabled: false, error: error.message };
  }
}

function status() {
  return { enabled, database: db?.databaseName || null, lastError };
}

async function recordMatch(room) {
  if (!enabled || !db || !room?.game || room.game.recorded) return false;
  const game = room.game;
  const winner = game.winnerId ? game.players[game.winnerId] : null;
  const doc = {
    matchId: game.matchId,
    roomCode: room.code,
    gameNo: room.gameNo,
    startedAt: game.startedAt ? new Date(game.startedAt) : null,
    finishedAt: game.finishedAt ? new Date(game.finishedAt) : new Date(),
    durationMs: game.startedAt ? Math.max(0, (game.finishedAt || Date.now()) - game.startedAt) : null,
    winnerId: winner?.id || null,
    winnerName: winner?.name || null,
    players: game.turnOrder.map((id) => {
      const player = game.players[id];
      return {
        id: player.id,
        name: player.name,
        type: player.type,
        seat: player.seat,
        captures: player.captures,
        updatesLeft: player.refresh
      };
    })
  };
  try {
    await db.collection('matches').updateOne({ matchId: doc.matchId }, { $setOnInsert: doc }, { upsert: true });
    game.recorded = true;
    return true;
  } catch (error) {
    lastError = error.message;
    console.warn(`[MongoDB] Falha ao registrar partida: ${error.message}`);
    return false;
  }
}

async function recentMatches(limit = 50) {
  if (!enabled || !db) return [];
  return db.collection('matches').find({}).sort({ finishedAt: -1 }).limit(Math.max(1, Math.min(200, Number(limit) || 50))).toArray();
}

async function close() {
  if (client) await client.close().catch(() => {});
  client = null;
  db = null;
  enabled = false;
}

module.exports = { init, status, recordMatch, recentMatches, close };
