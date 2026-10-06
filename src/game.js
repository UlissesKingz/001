const crypto = require('node:crypto');

const COLORS = [
  { id: 'red', name: 'Vermelho', abbr: 'VER' },
  { id: 'blue', name: 'Azul', abbr: 'AZU' },
  { id: 'green', name: 'Verde', abbr: 'VRD' },
  { id: 'yellow', name: 'Amarelo', abbr: 'AMA' }
];

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const START_INTRO_MS = 7000;
const rooms = new Map();

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomRoomCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) code += ROOM_ALPHABET[crypto.randomInt(0, ROOM_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Não foi possível gerar um código de sala.');
}

function sanitizeName(value) {
  const name = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
  if (!name) throw new Error('Informe um nickname.');
  if (!/^[\p{L}\p{N} ._'’\-]{1,18}$/u.test(name)) throw new Error('Nickname inválido.');
  return name;
}

function sanitizeDevice(value) {
  return value === 'mobile' ? 'mobile' : 'desktop';
}

function sanitizeRoomCode(value) {
  const code = String(value || '').normalize('NFKC').trim().toUpperCase();
  if (!/^[A-Z2-9]{4}$/.test(code)) throw new Error('Código de sala inválido.');
  return code;
}

function allPlayers(room) {
  return room.players.slice().sort((a, b) => a.seat - b.seat);
}

function allViewers(room) {
  return [...room.players, ...(room.spectators || [])];
}

function memberCount(room) {
  return room.players.length;
}

function nextSeat(room) {
  const used = new Set(room.players.map((player) => player.seat));
  for (let seat = 0; seat < 4; seat += 1) if (!used.has(seat)) return seat;
  return -1;
}

function findPlayer(room, id) {
  return room.players.find((player) => player.id === id) || null;
}

function findViewer(room, id) {
  return findPlayer(room, id) || room.spectators?.find((viewer) => viewer.id === id) || null;
}

function findHumanByToken(token) {
  if (!token || typeof token !== 'string' || token.length > 256) return null;
  for (const room of rooms.values()) {
    const player = room.players.find((candidate) => candidate.type === 'human' && candidate.resumeToken === token);
    if (player) return { room, player };
    const spectator = room.spectators?.find((candidate) => candidate.type === 'spectator' && candidate.resumeToken === token);
    if (spectator) return { room, player: spectator };
  }
  return null;
}

function nicknameTaken(room, name) {
  const key = name.toLocaleLowerCase('pt-BR');
  return allViewers(room).some((player) => player.name.toLocaleLowerCase('pt-BR') === key);
}

function createRoom({ name, device, socketId }) {
  const safeName = sanitizeName(name);
  const code = randomRoomCode();
  const player = {
    id: crypto.randomUUID(),
    name: safeName,
    device: sanitizeDevice(device),
    type: 'human',
    seat: 0,
    connected: true,
    socketId,
    resumeToken: randomId(24)
  };
  const now = Date.now();
  const room = {
    code,
    hostId: player.id,
    status: 'lobby',
    createdAt: now,
    updatedAt: now,
    players: [player],
    spectators: [],
    restart: null,
    game: null,
    gameNo: 0
  };
  rooms.set(code, room);
  return { room, player };
}

function joinRoom({ code, name, device, socketId }) {
  const safeCode = sanitizeRoomCode(code);
  const room = rooms.get(safeCode);
  if (!room) throw new Error('Sala não encontrada.');
  const safeName = sanitizeName(name);
  if (nicknameTaken(room, safeName)) throw new Error('Este nickname já está sendo usado nesta sala.');

  if (room.status === 'lobby') {
    if (memberCount(room) >= 4) throw new Error('A sala está cheia.');
    const seat = nextSeat(room);
    if (seat < 0) throw new Error('A sala está cheia.');
    const player = {
      id: crypto.randomUUID(),
      name: safeName,
      device: sanitizeDevice(device),
      type: 'human',
      seat,
      connected: true,
      socketId,
      resumeToken: randomId(24)
    };
    room.players.push(player);
    room.updatedAt = Date.now();
    return { room, player };
  }

  if (room.status === 'game') {
    const player = {
      id: crypto.randomUUID(),
      name: safeName,
      device: sanitizeDevice(device),
      type: 'spectator',
      seat: null,
      connected: true,
      socketId,
      resumeToken: randomId(24)
    };
    room.spectators = room.spectators || [];
    room.spectators.push(player);
    room.updatedAt = Date.now();
    return { room, player };
  }

  throw new Error('A sala não está disponível para entrada.');
}

function resumePlayer({ token, socketId, device }) {
  const found = findHumanByToken(token);
  if (!found) throw new Error('Sessão não encontrada.');
  found.player.connected = true;
  found.player.socketId = socketId;
  if (device) found.player.device = sanitizeDevice(device);
  found.room.updatedAt = Date.now();
  return found;
}

function addBot(room, requesterId) {
  if (room.hostId !== requesterId) throw new Error('Somente o criador da sala pode adicionar bots.');
  if (room.status !== 'lobby') throw new Error('A partida já começou.');
  if (memberCount(room) >= 4) throw new Error('A sala está cheia.');
  const seat = nextSeat(room);
  const existingBots = room.players.filter((player) => player.type === 'bot').length;
  const bot = {
    id: `bot_${randomId(6)}`,
    name: `Robô ${existingBots + 1}`,
    device: 'server',
    type: 'bot',
    seat,
    connected: true,
    socketId: null,
    resumeToken: null
  };
  room.players.push(bot);
  room.updatedAt = Date.now();
  return bot;
}

function removeBot(room, requesterId, botId) {
  if (room.hostId !== requesterId) throw new Error('Somente o criador da sala pode remover bots.');
  if (room.status !== 'lobby') throw new Error('A partida já começou.');
  const index = room.players.findIndex((player) => player.id === botId && player.type === 'bot');
  if (index < 0) throw new Error('Bot não encontrado.');
  room.players.splice(index, 1);
  room.updatedAt = Date.now();
}

function transferHost(room) {
  const humans = allPlayers(room).filter((player) => player.type === 'human');
  const connected = humans.find((player) => player.connected);
  room.hostId = (connected || humans[0] || {}).id || null;
}

function leaveRoom(room, playerId) {
  const spectatorIndex = (room.spectators || []).findIndex((viewer) => viewer.id === playerId);
  if (spectatorIndex >= 0) {
    room.spectators.splice(spectatorIndex, 1);
    room.updatedAt = Date.now();
    return;
  }
  const player = findPlayer(room, playerId);
  if (!player || player.type !== 'human') return;
  if (room.status === 'lobby') {
    room.players = room.players.filter((candidate) => candidate.id !== playerId);
    if (room.hostId === playerId) transferHost(room);
    if (!room.players.some((candidate) => candidate.type === 'human')) rooms.delete(room.code);
  } else {
    player.connected = false;
    player.socketId = null;
    if (room.hostId === playerId) transferHost(room);
  }
  room.updatedAt = Date.now();
}

function markDisconnected(socketId) {
  const changed = [];
  for (const room of rooms.values()) {
    const player = room.players.find((candidate) => candidate.type === 'human' && candidate.socketId === socketId);
    if (player) {
      player.connected = false;
      player.socketId = null;
      if (room.hostId === player.id) transferHost(room);
      room.updatedAt = Date.now();
      changed.push(room);
      continue;
    }
    const spectatorIndex = (room.spectators || []).findIndex((candidate) => candidate.socketId === socketId);
    if (spectatorIndex >= 0) {
      room.spectators.splice(spectatorIndex, 1);
      room.updatedAt = Date.now();
      changed.push(room);
    }
  }
  return changed;
}

function colorById(id) {
  return COLORS.find((color) => color.id === id) || null;
}

function isSpecial(card) {
  return Boolean(card && card.special);
}

function cardLabel(card) {
  if (!card) return 'carta';
  if (isSpecial(card)) return `Especial ${card.pair}`;
  return `${colorById(card.color)?.name || card.color} ${card.value}`;
}

function cardCode(card) {
  if (!card) return '—';
  if (isSpecial(card)) return card.pair;
  return `${colorById(card.color)?.abbr || '???'}${card.value}`;
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function makeDeck() {
  let id = 1;
  const cards = [];
  for (const color of COLORS) {
    for (const value of [0, 1]) {
      for (let copy = 0; copy < 12; copy += 1) cards.push({ id: id++, color: color.id, value });
    }
  }
  for (const pair of ['00', '01', '10', '11']) cards.push({ id: id++, special: true, pair, color: null, value: null });
  return shuffle(cards);
}

function addLog(game, text) {
  game.logs.unshift({ at: Date.now(), text: String(text) });
  game.logs = game.logs.slice(0, 80);
}

function setSfxEvent(game, type, actorId) {
  game.sfxSeq = (game.sfxSeq || 0) + 1;
  game.lastSfxEvent = { seq: game.sfxSeq, type, actorId, at: Date.now() };
}

function refreshSlot(game, pos) {
  const stack = game.stacks[pos];
  game.conveyor[pos] = stack.length ? stack[stack.length - 1] : null;
  game.covers[pos] = stack.length;
}

function recyclableCount(game) {
  return game.stacks.reduce((total, stack) => total + Math.max(0, stack.length - 1), 0);
}

function recycleDeck(game) {
  if (game.deck.length) return true;
  const recycled = [];
  for (let pos = 0; pos < game.stacks.length; pos += 1) {
    const stack = game.stacks[pos];
    if (stack.length > 1) {
      recycled.push(...stack.splice(0, stack.length - 1));
      refreshSlot(game, pos);
    }
  }
  if (!recycled.length) return false;
  game.deck = shuffle(recycled);
  addLog(game, `<entrada> refeita com ${recycled.length} carta${recycled.length === 1 ? '' : 's'} oculta${recycled.length === 1 ? '' : 's'} sob o <fluxo>.`);
  return true;
}

function drawCard(game, player) {
  if (!game.deck.length && !recycleDeck(game)) return null;
  const card = game.deck.pop();
  player.hand.push(card);
  return card;
}

function refillToNine(game, player) {
  while (player.hand.length < 9) {
    if (!drawCard(game, player)) break;
  }
}

function takeOpeningNormal(game) {
  let guard = 0;
  while (game.deck.length && guard < 20) {
    guard += 1;
    const card = game.deck.pop();
    if (!isSpecial(card)) return card;
    game.deck.unshift(card);
  }
  return null;
}

function patterns(game) {
  const list = [];
  for (let start = 0; start < 9; start += 1) {
    const indices = [start, (start + 1) % 9, (start + 2) % 9];
    const cards = indices.map((index) => game.conveyor[index]);
    if (cards.every(Boolean)) list.push({ start, indices, cards, locked: indices.some((index) => game.usedSlots.has(index)) });
  }
  return list;
}

function blockedFor(player, card) {
  return Boolean(player && player.offlineColor && card && !isSpecial(card) && card.color === player.offlineColor);
}

function flowAcceptsNormal(flowCard, handCard) {
  if (!flowCard || !handCard || isSpecial(handCard)) return false;
  if (isSpecial(flowCard)) return flowCard.pair.includes(String(handCard.value));
  return flowCard.value === handCard.value && flowCard.color === handCard.color;
}

function flowAcceptsBit(flowCard, bit) {
  if (!flowCard) return false;
  return isSpecial(flowCard) ? flowCard.pair.includes(String(bit)) : flowCard.value === bit;
}

function matchFor(game, player, selectedCards) {
  if (selectedCards.some((card) => blockedFor(player, card))) return null;
  if (selectedCards.length === 3 && selectedCards.every((card) => !isSpecial(card))) {
    const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const pattern of patterns(game)) {
      if (pattern.locked) continue;
      for (const permutation of permutations) {
        if (pattern.cards.every((flowCard, index) => flowAcceptsNormal(flowCard, selectedCards[permutation[index]]))) {
          return { ...pattern, cardOrder: permutation };
        }
      }
    }
  }
  if (selectedCards.length === 2) {
    const specialIndex = selectedCards.findIndex(isSpecial);
    const normalIndex = selectedCards.findIndex((card) => !isSpecial(card));
    if (specialIndex < 0 || normalIndex < 0) return null;
    const special = selectedCards[specialIndex];
    const normal = selectedCards[normalIndex];
    const bits = special.pair.split('').map(Number);
    for (const pattern of patterns(game)) {
      if (pattern.locked) continue;
      for (const start of [0, 1]) {
        const covered = [start, start + 1];
        const remaining = start === 0 ? 2 : 0;
        if (!flowAcceptsNormal(pattern.cards[remaining], normal)) continue;
        if (flowAcceptsBit(pattern.cards[covered[0]], bits[0]) && flowAcceptsBit(pattern.cards[covered[1]], bits[1])) {
          return { ...pattern, specialUse: true, pair: special.pair, covered, remaining, cardOrder: [specialIndex, normalIndex] };
        }
      }
    }
  }
  return null;
}

function allOptions(game, player) {
  const hand = player.hand;
  const options = [];
  for (let a = 0; a < hand.length - 2; a += 1) {
    for (let b = a + 1; b < hand.length - 1; b += 1) {
      for (let c = b + 1; c < hand.length; c += 1) {
        if (isSpecial(hand[a]) || isSpecial(hand[b]) || isSpecial(hand[c])) continue;
        const indices = [a, b, c];
        const cards = indices.map((index) => hand[index]);
        const pattern = matchFor(game, player, cards);
        if (pattern) options.push({ indices, pattern });
      }
    }
  }
  for (let a = 0; a < hand.length - 1; a += 1) {
    for (let b = a + 1; b < hand.length; b += 1) {
      const indices = [a, b];
      const cards = indices.map((index) => hand[index]);
      if (cards.filter(isSpecial).length !== 1) continue;
      const pattern = matchFor(game, player, cards);
      if (pattern) options.push({ indices, pattern });
    }
  }
  return options;
}

function hasConnectedNormal(player) {
  return player.hand.some((card) => !isSpecial(card) && !blockedFor(player, card));
}

function canDiscardCard(player, card) {
  if (!card || blockedFor(player, card)) return false;
  if (!isSpecial(card)) return true;
  return !hasConnectedNormal(player);
}

function currentPlayer(room) {
  const game = room.game;
  if (!game || !game.turnOrder.length) return null;
  return game.players[game.turnOrder[game.currentIndex]] || null;
}

function nextPlayer(room) {
  const game = room.game;
  if (!game || game.phase === 'gameover') return null;
  game.currentIndex = (game.currentIndex + 1) % game.turnOrder.length;
  return startTurn(room);
}

function startTurn(room) {
  const game = room.game;
  const player = currentPlayer(room);
  if (!game || !player) return null;
  game.turnNo += 1;
  game.phase = 'draw';
  game.refreshesThisTurn = 0;
  game.capturedThisTurn = false;
  if (!game.deck.length && !recycleDeck(game)) {
    game.phase = 'gameover';
    game.finishedAt = Date.now();
    addLog(game, 'Não há mais cartas disponíveis na <entrada> nem cartas ocultas suficientes sob o <fluxo>.');
    return player;
  }
  addLog(game, `Turno ${game.turnNo}: ${player.name}.`);
  return player;
}

function seedConveyor(game) {
  for (let i = 0; i < 3; i += 1) {
    const card = takeOpeningNormal(game);
    if (card) {
      game.stacks[i].push(card);
      refreshSlot(game, i);
    }
  }
  game.discardIndex = 3;
  game.lastDiscardPos = null;
  addLog(game, '<fluxo> iniciado com 3 cartas normais nas posições 1–3.');
}

function startGame(room) {
  if (room.players.length < 2) throw new Error('São necessários pelo menos 2 participantes.');
  room.gameNo += 1;
  room.status = 'game';
  room.restart = null;
  const ordered = allPlayers(room);
  const starterOffset = crypto.randomInt(0, ordered.length);
  const turnOrdered = [...ordered.slice(starterOffset), ...ordered.slice(0, starterOffset)];
  const startedAt = Date.now();
  const gamePlayers = {};
  for (const member of ordered) {
    gamePlayers[member.id] = {
      id: member.id,
      name: member.name,
      type: member.type,
      seat: member.seat,
      hand: [],
      captures: 0,
      offlineColor: null,
      refresh: 3
    };
  }
  const game = {
    matchId: crypto.randomUUID(),
    startedAt,
    introEndsAt: startedAt + START_INTRO_MS,
    starterId: turnOrdered[0]?.id || null,
    finishedAt: null,
    deck: makeDeck(),
    players: gamePlayers,
    playerCount: ordered.length,
    turnOrder: turnOrdered.map((member) => member.id),
    currentIndex: 0,
    phase: 'setup',
    turnNo: 0,
    refreshesThisTurn: 0,
    capturedThisTurn: false,
    conveyor: Array(9).fill(null),
    stacks: Array.from({ length: 9 }, () => []),
    covers: Array(9).fill(0),
    usedSlots: new Set(),
    invasionSlots: new Set(),
    discardIndex: 0,
    lastDiscardPos: null,
    winnerId: null,
    logs: [],
    recorded: false,
    sfxSeq: 0,
    lastSfxEvent: null
  };
  room.game = game;
  for (let round = 0; round < 9; round += 1) {
    for (const member of ordered) drawCard(game, game.players[member.id]);
  }
  seedConveyor(game);
  if (game.playerCount === 2) addLog(game, 'Modo 2 jogadores — O Duelo: <invasão 2> ativa por mesma cor ou mesmo valor do espaço anterior.');
  if (game.playerCount === 3) addLog(game, 'Modo 3 jogadores — O Triângulo: <invasão 3> ativa por mesma cor do espaço anterior.');
  addLog(game, 'Nova partida: 9 cartas abertas, 3 <atualização> e 4 marcadores de <capturados> por jogador.');
  addLog(game, `${game.players[game.starterId]?.name || 'Jogador'} foi selecionado aleatoriamente para iniciar a partida.`);
  startTurn(room);
  room.updatedAt = Date.now();
  return game;
}

function refreshUsedSlot(game, pos) {
  game.usedSlots.delete(pos);
}

function useRefresh(room, player) {
  const game = room.game;
  if (!player || player.refresh <= 0) return null;
  if (!game.deck.length && !recycleDeck(game)) return null;
  const card = game.deck.pop();
  player.refresh -= 1;
  const pos = game.discardIndex % 9;
  game.invasionSlots.delete(pos);
  game.stacks[pos].push(card);
  refreshSlot(game, pos);
  refreshUsedSlot(game, pos);
  game.discardIndex += 1;
  game.lastDiscardPos = pos;
  addLog(game, `${player.name} gastou 1 <atualização> e enviou ${cardLabel(card)} ao espaço ${pos + 1} do <fluxo>.`);
  setSfxEvent(game, 'refresh', player.id);
  if (!game.deck.length) recycleDeck(game);
  return card;
}

function invasionRuleFor(game) {
  const count = game?.playerCount || game?.turnOrder?.length || 0;
  if (count === 2) return 'color-or-value';
  if (count === 3) return 'color';
  return null;
}

function invasionMatches(game, discardCard) {
  const rule = invasionRuleFor(game);
  if (!rule || !discardCard || isSpecial(discardCard)) return false;
  const currentPos = game.discardIndex % 9;
  const previousPos = (currentPos + 8) % 9;
  const previousCard = game.conveyor[previousPos];
  if (!previousCard || isSpecial(previousCard)) return false;
  if (rule === 'color') return discardCard.color === previousCard.color;
  return discardCard.color === previousCard.color || discardCard.value === previousCard.value;
}

function takeCardForInvasion(game) {
  if (!game.deck.length && !recycleDeck(game)) return null;
  return game.deck.pop() || null;
}

function placeDiscard(room, player, cardId) {
  const game = room.game;
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error('Carta não encontrada.');
  const card = player.hand[index];
  if (!canDiscardCard(player, card)) throw new Error('Essa carta não pode ser descartada neste turno.');

  const triggersInvasion = invasionMatches(game, card);
  const currentPos = game.discardIndex % 9;
  const invasionCard = triggersInvasion ? takeCardForInvasion(game) : null;

  player.hand.splice(index, 1);

  if (invasionCard) {
    game.invasionSlots.delete(currentPos);
    game.stacks[currentPos].push(invasionCard);
    refreshSlot(game, currentPos);
    refreshUsedSlot(game, currentPos);
    game.invasionSlots.add(currentPos);

    const discardPos = (currentPos + 1) % 9;
    game.invasionSlots.delete(discardPos);
    game.stacks[discardPos].push(card);
    refreshSlot(game, discardPos);
    refreshUsedSlot(game, discardPos);
    game.discardIndex += 2;
    game.lastDiscardPos = discardPos;

    const invasionName = (game.playerCount || game.turnOrder.length) === 2 ? '<invasão 2>' : '<invasão 3>';
    addLog(game, `${player.name} ativou ${invasionName}: ${cardLabel(invasionCard)} da <entrada> invadiu o espaço ${currentPos + 1} e o descarte ${cardLabel(card)} seguiu para o espaço ${discardPos + 1}.`);
  } else {
    game.invasionSlots.delete(currentPos);
    game.stacks[currentPos].push(card);
    refreshSlot(game, currentPos);
    refreshUsedSlot(game, currentPos);
    game.discardIndex += 1;
    game.lastDiscardPos = currentPos;
    addLog(game, `${player.name} descartou ${cardLabel(card)} no espaço ${currentPos + 1} do <fluxo>.`);
  }

  setSfxEvent(game, 'flow', player.id);
  if (!isSpecial(card)) {
    const nextIndex = (game.currentIndex + 1) % game.turnOrder.length;
    const next = game.players[game.turnOrder[nextIndex]];
    if (next) {
      next.offlineColor = card.color;
      addLog(game, `${next.name} deve <desconectar> ${colorById(card.color)?.name || card.color} neste turno.`);
    }
  }
  return card;
}

function applyCapture(room, player, selectedCards, match) {
  const game = room.game;
  const ids = new Set(selectedCards.map((card) => card.id));
  player.hand = player.hand.filter((card) => !ids.has(card.id));
  player.captures += 1;
  game.capturedThisTurn = true;
  match.indices.forEach((index) => game.usedSlots.add(index));
  const flowName = match.indices.map((index) => index + 1).join('–');
  if (match.specialUse) addLog(game, `${player.name} <capturou> o fragmento ${flowName} usando a especial ${match.pair}.`);
  else addLog(game, `${player.name} <capturou> ${selectedCards.map(cardCode).join(' / ')} no fragmento ${flowName}.`);
  setSfxEvent(game, 'capture', player.id);
  if (player.captures >= 4) {
    game.winnerId = player.id;
    game.phase = 'gameover';
    game.finishedAt = Date.now();
    addLog(game, `${player.name} venceu ao capturar o 4º fragmento e completar o pacote de 12 bits.`);
    return;
  }
  refillToNine(game, player);
}

function validateTurn(room, playerId, phase = null) {
  if (!room || room.status !== 'game' || !room.game) throw new Error('A partida ainda não começou.');
  const game = room.game;
  if (game.phase === 'gameover') throw new Error('A partida já terminou.');
  if (game.introEndsAt && Date.now() < game.introEndsAt) throw new Error('O sistema ainda está definindo o primeiro jogador.');
  const player = game.players[playerId];
  if (!player) throw new Error('Jogador inválido.');
  const current = currentPlayer(room);
  if (!current || current.id !== playerId) throw new Error('Não é o seu turno.');
  if (phase && game.phase !== phase) throw new Error('Ação indisponível nesta fase do turno.');
  return { game, player };
}

function playerDraw(room, playerId) {
  const { game, player } = validateTurn(room, playerId, 'draw');
  const card = drawCard(game, player);
  if (!card) {
    game.phase = 'gameover';
    game.finishedAt = Date.now();
    throw new Error('Não há cartas disponíveis para comprar.');
  }
  addLog(game, `${player.name} comprou ${cardLabel(card)} da <entrada>.`);
  game.phase = 'play';
  room.updatedAt = Date.now();
  return card;
}

function playerRefresh(room, playerId) {
  const { game, player } = validateTurn(room, playerId, 'draw');
  if (player.refresh <= 0) throw new Error('Você não possui mais marcadores de <atualização>.');
  if (game.refreshesThisTurn >= 3) throw new Error('O limite é 3 <atualização> por turno.');
  const card = useRefresh(room, player);
  if (!card) throw new Error('Não há carta disponível para atualizar.');
  game.refreshesThisTurn += 1;
  if (game.refreshesThisTurn >= 3) {
    const bought = drawCard(game, player);
    if (!bought) throw new Error('Não há carta disponível para a compra obrigatória.');
    addLog(game, `${player.name} usou a 3ª <atualização> e comprou automaticamente ${cardLabel(bought)}.`);
    game.phase = 'play';
  }
  room.updatedAt = Date.now();
  return card;
}

function playerCapture(room, playerId, cardIds) {
  const { game, player } = validateTurn(room, playerId, 'play');
  if (game.capturedThisTurn) throw new Error('Você já capturou um fragmento neste turno. Agora descarte uma carta no <fluxo>.');
  const unique = [...new Set(Array.isArray(cardIds) ? cardIds.map(Number) : [])];
  if (![2, 3].includes(unique.length)) throw new Error('Selecione 2 ou 3 cartas para capturar.');
  const selected = unique.map((id) => player.hand.find((card) => card.id === id));
  if (selected.some((card) => !card)) throw new Error('Uma das cartas selecionadas não está mais disponível.');
  const match = matchFor(game, player, selected);
  if (!match) throw new Error('Essas cartas não capturam nenhum fragmento disponível do <fluxo>.');
  applyCapture(room, player, selected, match);
  room.updatedAt = Date.now();
  return match;
}

function playerDiscard(room, playerId, cardId) {
  const { game, player } = validateTurn(room, playerId, 'play');
  placeDiscard(room, player, Number(cardId));
  if (game.capturedThisTurn) refillToNine(game, player);
  player.offlineColor = null;
  nextPlayer(room);
  room.updatedAt = Date.now();
}

function topHelpsBot(room, player) {
  const game = room.game;
  if (!game.deck.length) return false;
  const card = game.deck[game.deck.length - 1];
  player.hand.push(card);
  const helps = allOptions(game, player).length > 0;
  player.hand.pop();
  return helps;
}

function chooseBotDiscard(room, player) {
  const game = room.game;
  const participation = Array(player.hand.length).fill(0);
  for (const option of allOptions(game, player)) for (const index of option.indices) participation[index] += 1;
  const legal = player.hand.map((card, index) => canDiscardCard(player, card) ? index : -1).filter((index) => index >= 0);
  if (!legal.length) return -1;
  const normals = legal.filter((index) => !isSpecial(player.hand[index]));
  const pool = normals.length ? normals : legal;
  const minimum = Math.min(...pool.map((index) => participation[index]));
  const best = pool.filter((index) => participation[index] === minimum);
  return best[crypto.randomInt(0, best.length)];
}

function isBotTurn(room) {
  if (!room || room.status !== 'game' || !room.game || room.game.phase === 'gameover') return false;
  return currentPlayer(room)?.type === 'bot';
}

// Executes exactly ONE visible bot action. The server is responsible for
// waiting briefly, broadcasting the new state, then asking for the next one.
function runBotAction(room) {
  const game = room?.game;
  const player = currentPlayer(room);
  if (!game || game.phase === 'gameover' || !player || player.type !== 'bot') return { action: 'none', turnEnded: true };
  if (game.introEndsAt && Date.now() < game.introEndsAt) return { action: 'intro', playerId: player.id };

  if (game.phase === 'draw') {
    const used = game.refreshesThisTurn || 0;
    if (used < 3 && player.refresh > 0 && game.deck.length > 0) {
      const chance = used === 0 ? 480 : used === 1 ? 340 : 260;
      const shouldRefresh = !topHelpsBot(room, player) && crypto.randomInt(0, 1000) < chance;
      if (shouldRefresh) {
        const refreshed = useRefresh(room, player);
        if (refreshed) {
          game.refreshesThisTurn += 1;
          room.updatedAt = Date.now();
          return { action: 'refresh', playerId: player.id, cardId: refreshed.id };
        }
      }
    }

    const bought = drawCard(game, player);
    if (!bought) {
      game.phase = 'gameover';
      game.finishedAt = Date.now();
      room.updatedAt = Date.now();
      return { action: 'gameover', playerId: player.id };
    }
    addLog(game, `${player.name} comprou ${cardLabel(bought)} da <entrada>.`);
    game.phase = 'play';
    room.updatedAt = Date.now();
    return { action: 'draw', playerId: player.id, cardId: bought.id };
  }

  if (game.phase === 'play') {
    // Regra: no máximo 1 captura por turno. Depois da captura, a próxima
    // ação visível do bot é o descarte.
    if (!game.capturedThisTurn) {
      const options = allOptions(game, player);
      if (options.length) {
        const option = options[crypto.randomInt(0, options.length)];
        const selected = option.indices.map((index) => player.hand[index]);
        applyCapture(room, player, selected, option.pattern);
        room.updatedAt = Date.now();
        return { action: game.phase === 'gameover' ? 'win' : 'capture', playerId: player.id };
      }
    }

    const discardIndex = chooseBotDiscard(room, player);
    if (discardIndex >= 0) placeDiscard(room, player, player.hand[discardIndex].id);
    if (game.capturedThisTurn) refillToNine(game, player);
    player.offlineColor = null;
    nextPlayer(room);
    room.updatedAt = Date.now();
    return { action: 'discard', playerId: player.id, turnEnded: true };
  }

  return { action: 'none', playerId: player.id };
}

function requestRestart(room, playerId) {
  if (room.status !== 'game') throw new Error('Não há partida em andamento.');
  const requester = findPlayer(room, playerId);
  if (!requester || requester.type !== 'human') throw new Error('Jogador inválido.');
  if (room.restart) throw new Error('Já existe um pedido de reinício aguardando votos.');
  const humans = room.players.filter((player) => player.type === 'human');
  room.restart = { requestedBy: playerId, votes: new Map([[playerId, true]]), createdAt: Date.now() };
  if (humans.length === 1) {
    startGame(room);
    return { restarted: true };
  }
  return { restarted: false };
}

function respondRestart(room, playerId, accept) {
  if (!room.restart) throw new Error('Não há pedido de reinício ativo.');
  const human = room.players.find((player) => player.id === playerId && player.type === 'human');
  if (!human) throw new Error('Jogador inválido.');
  if (!accept) {
    const by = playerId;
    room.restart = null;
    return { rejected: true, by };
  }
  room.restart.votes.set(playerId, true);
  const humans = room.players.filter((player) => player.type === 'human');
  if (humans.every((player) => room.restart.votes.get(player.id) === true)) {
    startGame(room);
    return { restarted: true };
  }
  return { restarted: false };
}

function publicGame(room) {
  const game = room.game;
  if (!game) return null;
  return {
    matchId: game.matchId,
    startedAt: game.startedAt,
    introEndsAt: game.introEndsAt || null,
    starterId: game.starterId || game.turnOrder[0] || null,
    finishedAt: game.finishedAt,
    phase: game.phase,
    turnNo: game.turnNo,
    currentPlayerId: game.turnOrder[game.currentIndex] || null,
    refreshesThisTurn: game.refreshesThisTurn,
    capturedThisTurn: game.capturedThisTurn,
    deckCount: game.deck.length,
    deckTop: game.deck.length ? game.deck[game.deck.length - 1] : null,
    recyclableCount: recyclableCount(game),
    conveyor: game.conveyor,
    covers: game.covers,
    usedSlots: [...game.usedSlots],
    invasionSlots: [...game.invasionSlots],
    discardIndex: game.discardIndex,
    lastDiscardPos: game.lastDiscardPos,
    winnerId: game.winnerId,
    playerCount: game.playerCount || game.turnOrder.length,
    invasionRule: invasionRuleFor(game),
    turnOrder: [...game.turnOrder],
    players: game.turnOrder.map((id) => ({ ...game.players[id], hand: game.players[id].hand.map((card) => ({ ...card })) })),
    logs: game.logs.map((entry) => ({ ...entry })),
    sfxEvent: game.lastSfxEvent ? { ...game.lastSfxEvent } : null
  };
}

function publicRoom(room, viewerId = null) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    viewerId,
    viewerIsSpectator: Boolean(room.spectators?.some((viewer) => viewer.id === viewerId)),
    gameNo: room.gameNo,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    players: allPlayers(room).map((player) => ({
      id: player.id,
      name: player.name,
      nickname: player.name,
      type: player.type,
      device: player.device,
      seat: player.seat,
      connected: player.type === 'bot' ? true : Boolean(player.connected),
      isHost: player.id === room.hostId
    })),
    spectators: (room.spectators || []).map((viewer) => ({
      id: viewer.id,
      name: viewer.name,
      nickname: viewer.name,
      type: viewer.type,
      device: viewer.device,
      seat: null,
      connected: Boolean(viewer.connected)
    })),
    restart: room.restart ? {
      requestedBy: room.restart.requestedBy,
      votes: Object.fromEntries(room.restart.votes),
      requiredHumanIds: room.players.filter((player) => player.type === 'human').map((player) => player.id)
    } : null,
    game: publicGame(room)
  };
}

function liveRoomSummaries() {
  return [...rooms.values()].map((room) => ({
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    gameNo: room.gameNo,
    playerCount: room.players.length,
    spectatorCount: (room.spectators || []).length,
    humansConnected: room.players.filter((player) => player.type === 'human' && player.connected).length,
    players: allPlayers(room).map((player) => ({ name: player.name, type: player.type, seat: player.seat, connected: player.connected })),
    spectators: (room.spectators || []).map((viewer) => ({ name: viewer.name, type: viewer.type, connected: viewer.connected }))
  }));
}

module.exports = {
  COLORS,
  rooms,
  createRoom,
  joinRoom,
  resumePlayer,
  addBot,
  removeBot,
  leaveRoom,
  markDisconnected,
  findPlayer,
  findViewer,
  publicRoom,
  liveRoomSummaries,
  startGame,
  playerDraw,
  playerRefresh,
  playerCapture,
  playerDiscard,
  isBotTurn,
  runBotAction,
  requestRestart,
  respondRestart,
  sanitizeRoomCode,
  sanitizeName,
  _engine: { makeDeck, matchFor, patterns, canDiscardCard, isSpecial, cardCode, startGame, invasionRuleFor, invasionMatches }
};
