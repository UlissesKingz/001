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

test('atualização libera bloqueio e permite usar os 3 marcadores no mesmo turno', () => {
  const { room, player } = freshRoom();
  game.startGame(room);

  for (let use = 1; use <= 3; use += 1) {
    const pos = room.game.discardIndex % 9;
    room.game.usedSlots.add(pos);
    game.playerRefresh(room, player.id);
    assert.equal(room.game.usedSlots.has(pos), false);
    assert.equal(room.game.players[player.id].refresh, 3 - use);
    assert.equal(room.game.refreshesThisTurn, use);
    assert.equal(room.game.phase, use < 3 ? 'draw' : 'play');
  }

  assert.equal(room.game.players[player.id].hand.length, 10);
});


test('permite apenas uma captura por turno', () => {
  const { room, player } = freshRoom();
  game.startGame(room);
  room.game.currentIndex = room.game.turnOrder.indexOf(player.id);
  room.game.phase = 'play';
  room.game.capturedThisTurn = true;
  assert.throws(
    () => game.playerCapture(room, player.id, []),
    /já capturou um fragmento neste turno/
  );
});
