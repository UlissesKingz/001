const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../src/game');

function freshRoom() {
  game.rooms.clear();
  const { room, player } = game.createRoom({ name: 'Ulisses', device: 'desktop', socketId: 's1' });
  game.addBot(room, player.id);
  return { room, player };
}

test('cria sala simples com código de 4 caracteres', () => {
  game.rooms.clear();
  const { room, player } = game.createRoom({ name: 'Teste', device: 'desktop', socketId: 's1' });
  assert.match(room.code, /^[A-Z2-9]{4}$/);
  assert.equal(room.hostId, player.id);
  assert.equal(room.status, 'lobby');
});

test('inicia partida autoritativa com 9 cartas por jogador e 3 cartas no fluxo', () => {
  const { room, player } = freshRoom();
  game.startGame(room);
  assert.equal(room.status, 'game');
  assert.equal(room.game.players[player.id].hand.length, 9);
  assert.equal(room.game.players[player.id].refresh, 3);
  assert.equal(room.game.conveyor.filter(Boolean).length, 3);
  assert.equal(room.game.discardIndex, 3);
  assert.equal(room.game.phase, 'draw');
});

test('atualização libera bloqueio e a segunda atualização compra automaticamente', () => {
  const { room, player } = freshRoom();
  game.startGame(room);
  const pos1 = room.game.discardIndex % 9;
  room.game.usedSlots.add(pos1);
  game.playerRefresh(room, player.id);
  assert.equal(room.game.usedSlots.has(pos1), false);
  assert.equal(room.game.players[player.id].refresh, 2);
  assert.equal(room.game.phase, 'draw');

  const pos2 = room.game.discardIndex % 9;
  room.game.usedSlots.add(pos2);
  game.playerRefresh(room, player.id);
  assert.equal(room.game.usedSlots.has(pos2), false);
  assert.equal(room.game.players[player.id].refresh, 1);
  assert.equal(room.game.refreshesThisTurn, 2);
  assert.equal(room.game.phase, 'play');
  assert.equal(room.game.players[player.id].hand.length, 10);
});
