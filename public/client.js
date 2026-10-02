(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const DEVICE = document.body.dataset.device === 'mobile' ? 'mobile' : 'desktop';
  const COLORS = {
    red: { name: 'Vermelho', abbr: 'VER', css: 'var(--red)' },
    blue: { name: 'Azul', abbr: 'AZU', css: 'var(--blue)' },
    green: { name: 'Verde', abbr: 'VRD', css: 'var(--green)' },
    yellow: { name: 'Amarelo', abbr: 'AMA', css: 'var(--yellow)' }
  };
  const COLOR_ORDER = { red: 0, blue: 1, green: 2, yellow: 3 };
  const SPECIAL_ORDER = { '00': 0, '01': 1, '10': 2, '11': 3 };
  const state = {
    socket: null,
    room: null,
    token: localStorage.getItem('001_room_token') || '',
    selected: new Set(),
    sortMode: 'free',
    handOrder: [],
    shownWinnerMatch: null,
    flowMatchId: null,
    flowCardIds: null,
    drag: { id: null, startX: 0, startY: 0, dragging: false, targetId: null, after: false, pointerId: null, suppressClick: false }
  };

  localStorage.setItem('001_device', DEVICE);

  function showScreen(id) {
    $$('.pre-screen').forEach((screen) => screen.classList.remove('active'));
    $(id)?.classList.add('active');
  }

  function setEntryStatus(text = '') { if ($('#entryStatus')) $('#entryStatus').textContent = text; }
  function setLobbyStatus(text = '') { if ($('#lobbyStatus')) $('#lobbyStatus').textContent = text; }
  function saveToken(token) {
    state.token = token || '';
    if (state.token) localStorage.setItem('001_room_token', state.token);
    else localStorage.removeItem('001_room_token');
  }
  function myLobbyPlayer() { return state.room?.players?.find((player) => player.id === state.room.viewerId) || null; }
  function viewerEntry() { return state.room?.players?.find((player) => player.id === state.room.viewerId) || state.room?.spectators?.find((viewer) => viewer.id === state.room.viewerId) || null; }
  function viewerIsSpectator() { return Boolean(state.room?.viewerIsSpectator); }
  function isHost() { return Boolean(state.room && !viewerIsSpectator() && state.room.hostId === state.room.viewerId); }
  function playerName(id) { return state.room?.players?.find((player) => player.id === id)?.name || state.room?.spectators?.find((viewer) => viewer.id === id)?.name || 'Jogador'; }
  function isSpecial(card) { return Boolean(card?.special); }
  function colorInfo(id) { return COLORS[id] || { name: id || 'Cor', abbr: '???', css: '#7f8a99' }; }
  function cardCode(card) { return isSpecial(card) ? card.pair : `${colorInfo(card.color).abbr}${card.value}`; }
  function cardLabel(card) { return isSpecial(card) ? `Especial ${card.pair}` : `${colorInfo(card.color).name} ${card.value}`; }
  function gamePlayer(id) { return state.room?.game?.players?.find((player) => player.id === id) || null; }
  function me() { return gamePlayer(state.room?.viewerId); }
  function isMyTurn() { return state.room?.game?.currentPlayerId === state.room?.viewerId && state.room?.game?.phase !== 'gameover'; }
  function blockedFor(player, card) { return Boolean(player?.offlineColor && card && !isSpecial(card) && card.color === player.offlineColor); }

  function renderLobby() {
    const room = state.room;
    if (!room) return;
    $('#lobbyCode').textContent = room.code;
    const grid = $('#lobbyGrid');
    grid.innerHTML = '';
    for (let seat = 0; seat < 4; seat += 1) {
      const player = room.players.find((candidate) => candidate.seat === seat);
      const item = document.createElement('div');
      item.className = `lobby-seat${player ? ' filled' : ''}${player?.id === room.viewerId ? ' me' : ''}${player?.type === 'bot' ? ' bot' : ''}`;
      if (!player) {
        item.innerHTML = `<div class="seat-no">ESPAÇO ${seat + 1}</div><div class="seat-name" style="color:#53677d">VAZIO</div><div class="seat-meta">aguardando</div>`;
      } else {
        const meta = player.type === 'bot'
          ? 'BOT'
          : `${player.device || 'desktop'}${player.isHost ? ' • HOST' : ''}${player.connected === false ? ' • DESCONECTADO' : ''}`;
        item.innerHTML = `<div><div class="seat-no">ESPAÇO ${seat + 1}</div><div class="seat-name"></div></div><div class="seat-meta"></div>`;
        item.querySelector('.seat-name').textContent = player.name;
        item.querySelector('.seat-meta').textContent = meta;
        if (isHost() && player.type === 'bot') {
          const remove = document.createElement('button');
          remove.className = 'btn';
          remove.style.padding = '4px 7px';
          remove.style.fontSize = '8px';
          remove.textContent = 'REMOVER';
          remove.addEventListener('click', () => emitAck('room:removeBot', { botId: player.id }, (res) => { if (!res.ok) setLobbyStatus(res.error); }));
          item.appendChild(remove);
        }
      }
      grid.appendChild(item);
    }
    $('#addBotBtn').style.display = isHost() ? 'inline-flex' : 'none';
    $('#startRoomBtn').style.display = isHost() ? 'inline-flex' : 'none';
    $('#addBotBtn').disabled = room.players.length >= 4 || room.status !== 'lobby';
    $('#startRoomBtn').disabled = room.players.length < 2 || room.status !== 'lobby';
    if (room.restart) renderRestartVote();
  }

  function renderRestartVote() {
    const restart = state.room?.restart;
    if (!restart) {
      $('#restartVoteModal')?.classList.remove('open');
      return;
    }
    $('#restartVoteText').textContent = `${playerName(restart.requestedBy)} pediu para reiniciar a partida. Todos os jogadores humanos precisam aceitar.`;
    const list = $('#restartVotes');
    list.innerHTML = '';
    for (const player of state.room.players.filter((candidate) => candidate.type === 'human')) {
      const row = document.createElement('div');
      row.className = 'restart-vote-line';
      const vote = restart.votes?.[player.id];
      const left = document.createElement('span');
      const right = document.createElement('b');
      left.textContent = player.name;
      right.textContent = vote === true ? 'ACEITOU' : vote === false ? 'RECUSOU' : 'AGUARDANDO';
      row.append(left, right);
      list.appendChild(row);
    }
    const myVote = restart.votes?.[state.room.viewerId];
    $('#restartVoteYes').disabled = viewerIsSpectator() || myVote === true;
    $('#restartVoteNo').disabled = viewerIsSpectator() || myVote === false;
    if (viewerIsSpectator()) $('#restartVoteText').textContent += ' Você está assistindo como espectador.';
    $('#restartVoteModal').classList.add('open');
  }

  function updateHandOrder() {
    const hand = me()?.hand || [];
    const ids = new Set(hand.map((card) => card.id));
    state.handOrder = state.handOrder.filter((id) => ids.has(id));
    for (const card of hand) if (!state.handOrder.includes(card.id)) state.handOrder.push(card.id);
    state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
    if (!isMyTurn()) state.selected.clear();
  }

  function orderedHand(player, isViewer) {
    const cards = [...(player?.hand || [])];
    if (!isViewer) return cards;
    if (state.sortMode === 'number') {
      return cards.sort((a, b) => {
        if (isSpecial(a) || isSpecial(b)) {
          if (isSpecial(a) && isSpecial(b)) return (SPECIAL_ORDER[a.pair] ?? 9) - (SPECIAL_ORDER[b.pair] ?? 9) || a.id - b.id;
          return isSpecial(a) ? 1 : -1;
        }
        return (Number(a.value) * 4 + (COLOR_ORDER[a.color] ?? 9)) - (Number(b.value) * 4 + (COLOR_ORDER[b.color] ?? 9)) || a.id - b.id;
      });
    }
    if (state.sortMode === 'color') {
      return cards.sort((a, b) => {
        if (isSpecial(a) || isSpecial(b)) {
          if (isSpecial(a) && isSpecial(b)) return (SPECIAL_ORDER[a.pair] ?? 9) - (SPECIAL_ORDER[b.pair] ?? 9) || a.id - b.id;
          return isSpecial(a) ? 1 : -1;
        }
        return (COLOR_ORDER[a.color] ?? 9) - (COLOR_ORDER[b.color] ?? 9) || a.value - b.value || a.id - b.id;
      });
    }
    const order = new Map(state.handOrder.map((id, index) => [id, index]));
    return cards.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }

  function makeCard(card, player, interactive = false) {
    const el = document.createElement(interactive ? 'button' : 'div');
    el.className = 'card';
    if (isSpecial(card)) {
      el.classList.add('special');
      el.style.setProperty('--c', '#f2ca68');
      el.dataset.abbr = '2 BITS';
      el.dataset.fullcolor = 'ESPECIAL';
      el.dataset.valueLabel = card.pair;
      el.append(document.createTextNode(card.pair));
    } else {
      if (blockedFor(player, card)) el.classList.add('blocked');
      const info = colorInfo(card.color);
      el.style.setProperty('--c', info.css);
      el.dataset.abbr = info.abbr;
      el.dataset.fullcolor = info.name.toUpperCase();
      el.dataset.valueLabel = String(card.value);
      el.append(document.createTextNode(String(card.value)));
    }
    const lock = document.createElement('span');
    lock.className = 'lock';
    lock.textContent = 'OFF';
    el.appendChild(lock);
    el.dataset.cardId = card.id;
    el.dataset.help = isSpecial(card)
      ? `Carta especial ${card.pair}. Pode substituir duas posições consecutivas de um fragmento.`
      : `Carta ${colorInfo(card.color).name} ${card.value}.`;
    if (interactive) {
      el.type = 'button';
      if (state.selected.has(card.id)) el.classList.add('selected');
      el.addEventListener('click', () => {
        if (state.drag.suppressClick) return;
        toggleSelected(card.id);
      });
    }
    return el;
  }

  function patternList() {
    const game = state.room?.game;
    if (!game) return [];
    const used = new Set(game.usedSlots || []);
    const list = [];
    for (let start = 0; start < 9; start += 1) {
      const indices = [start, (start + 1) % 9, (start + 2) % 9];
      const cards = indices.map((index) => game.conveyor[index]);
      if (cards.every(Boolean)) list.push({ start, indices, cards, locked: indices.some((index) => used.has(index)) });
    }
    return list;
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
  function matchForClient(cards) {
    const player = me();
    if (!player || cards.some((card) => blockedFor(player, card))) return null;
    if (cards.length === 3 && cards.every((card) => !isSpecial(card))) {
      const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
      for (const pattern of patternList()) {
        if (pattern.locked) continue;
        for (const perm of perms) {
          if (pattern.cards.every((flowCard, index) => flowAcceptsNormal(flowCard, cards[perm[index]]))) return { ...pattern, cardOrder: perm };
        }
      }
    }
    if (cards.length === 2) {
      const specialIndex = cards.findIndex(isSpecial);
      const normalIndex = cards.findIndex((card) => !isSpecial(card));
      if (specialIndex < 0 || normalIndex < 0) return null;
      const special = cards[specialIndex];
      const normal = cards[normalIndex];
      const bits = special.pair.split('').map(Number);
      for (const pattern of patternList()) {
        if (pattern.locked) continue;
        for (const start of [0, 1]) {
          const covered = [start, start + 1];
          const remaining = start === 0 ? 2 : 0;
          if (!flowAcceptsNormal(pattern.cards[remaining], normal)) continue;
          if (flowAcceptsBit(pattern.cards[covered[0]], bits[0]) && flowAcceptsBit(pattern.cards[covered[1]], bits[1])) return { ...pattern, specialUse: true, pair: special.pair };
        }
      }
    }
    return null;
  }

  function canDiscardClient(card) {
    const player = me();
    if (!player || !card || blockedFor(player, card)) return false;
    if (!isSpecial(card)) return true;
    return !player.hand.some((candidate) => !isSpecial(candidate) && !blockedFor(player, candidate));
  }

  function selectedCards() {
    const hand = me()?.hand || [];
    return [...state.selected].map((id) => hand.find((card) => card.id === id)).filter(Boolean);
  }

  function syncSelectionUI() {
    $$('#hand0 .card').forEach((card) => {
      card.classList.toggle('selected', state.selected.has(Number(card.dataset.cardId)));
    });
    renderControls();
  }

  function toggleSelected(cardId) {
    const game = state.room?.game;
    if (!game || !isMyTurn() || game.phase !== 'play') return;
    if (state.selected.has(cardId)) state.selected.delete(cardId);
    else if (state.selected.size < 3) state.selected.add(cardId);
    syncSelectionUI();
  }

  function renderMarkers(container, player) {
    container.innerHTML = '';
    const capturedLabel = document.createElement('span');
    capturedLabel.className = 'caplabel';
    capturedLabel.textContent = '<capturados>';
    container.appendChild(capturedLabel);
    for (let i = 0; i < 4; i += 1) {
      const marker = document.createElement('span');
      marker.className = `meldmark${i < player.captures ? ' on' : ''}`;
      container.appendChild(marker);
    }
    const updateLabel = document.createElement('span');
    updateLabel.className = 'updlabel';
    updateLabel.textContent = '<atualização>';
    container.appendChild(updateLabel);
    for (let i = 0; i < 3; i += 1) {
      const marker = document.createElement('span');
      marker.className = `refreshmark${i < player.refresh ? ' on' : ''}`;
      container.appendChild(marker);
    }
  }

  function renderBlockedSummary() {
    const box = $('#blocked');
    box.innerHTML = '';
    const game = state.room?.game;
    for (const player of game?.players || []) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      const bold = document.createElement('b');
      bold.textContent = `${(!viewerIsSpectator() && player.id === state.room.viewerId) ? 'Você' : player.name}:`;
      pill.appendChild(bold);
      if (player.offlineColor) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = colorInfo(player.offlineColor).css;
        pill.append(' ', dot, ` ${colorInfo(player.offlineColor).name}`);
      } else pill.append(' online');
      box.appendChild(pill);
    }
  }

  function renderGame() {
    const room = state.room;
    const game = room?.game;
    if (!room || !game) return;
    updateHandOrder();
    document.body.classList.add('in-game');
    $('#restartVoteModal')?.classList.toggle('open', Boolean(room.restart));

    const viewer = me();
    const spectator = viewerIsSpectator();
    document.body.classList.toggle('viewer-spectator', spectator);
    const participants = [...game.players].sort((a, b) => a.seat - b.seat);
    const display = spectator ? participants : [viewer, ...participants.filter((player) => player.id !== room.viewerId)].filter(Boolean);
    const banner = $('#viewerBanner');
    if (banner) {
      const spectators = room.spectators?.length || 0;
      banner.textContent = spectator
        ? `Você entrou como espectador • sala ${room.code} • espectadores: ${spectators}`
        : (spectators ? `Espectadores conectados: ${spectators}` : '');
      banner.classList.toggle('show', Boolean(banner.textContent));
    }
    if ($('#newBtn')) $('#newBtn').disabled = spectator;
    for (let slot = 0; slot < 4; slot += 1) {
      const player = display[slot];
      const seat = $(`#seat${slot}`);
      if (!seat) continue;
      seat.style.display = player ? '' : 'none';
      if (!player) continue;
      const title = seat.querySelector('h3 > span');
      if (title) title.textContent = (!spectator && slot === 0) ? 'VOCÊ' : player.name.toUpperCase();
      const handBox = $(`#hand${slot}`);
      handBox.innerHTML = '';
      const allowInteract = !spectator && slot === 0;
      const cards = orderedHand(player, allowInteract);
      for (const card of cards) handBox.appendChild(makeCard(card, player, allowInteract));
      handBox.classList.toggle('selecting', allowInteract && isMyTurn() && game.phase === 'play');
      $(`#meta${slot}`).textContent = `${player.hand.length} cartas • ${player.captures}/4 capturas • ${player.refresh} atualizações`;
      renderMarkers($(`#melds${slot}`), player);
      seat.classList.toggle('active', game.currentPlayerId === player.id && !game.winnerId);
      seat.classList.toggle('winner', game.winnerId === player.id);
    }

    $('#deckCount').textContent = game.deckCount;
    const deckPile = $('#deckPile');
    deckPile.innerHTML = '';
    deckPile.classList.toggle('empty', !game.deckTop);
    if (game.deckTop) {
      const top = makeCard(game.deckTop, null, false);
      top.setAttribute('aria-label', `Topo da entrada: ${cardLabel(game.deckTop)}`);
      deckPile.appendChild(top);
    } else {
      const empty = document.createElement('div'); empty.className = 'deckcard'; deckPile.appendChild(empty);
    }

    const current = gamePlayer(game.currentPlayerId);
    const winner = gamePlayer(game.winnerId);
    $('#turnText').textContent = winner ? `${winner.name} venceu` : `${(!spectator && current?.id === room.viewerId) ? 'Você' : current?.name || '—'} • turno ${game.turnNo}`;
    const order = $('#turnOrder');
    order.innerHTML = '';
    game.turnOrder.forEach((id, index) => {
      const player = gamePlayer(id);
      const chip = document.createElement('span');
      chip.className = `turn-chip${id === game.currentPlayerId && !game.winnerId ? ' active' : ''}`;
      chip.textContent = (!spectator && id === room.viewerId) ? 'Você' : player?.name || 'Jogador';
      order.appendChild(chip);
      if (index < game.turnOrder.length - 1) { const arrow = document.createElement('span'); arrow.className = 'turn-arrow'; arrow.textContent = '→'; order.appendChild(arrow); }
    });
    const loop = document.createElement('span'); loop.className = 'turn-arrow'; loop.textContent = '↺'; order.appendChild(loop);
    renderBlockedSummary();

    const used = new Set(game.usedSlots || []);
    const conveyor = $('#conveyor');
    const currentFlowIds = game.conveyor.map((card) => card?.id ?? null);
    const previousFlowIds = state.flowMatchId === game.matchId ? state.flowCardIds : null;
    const enteredFlowSlots = new Set();
    if (previousFlowIds) {
      currentFlowIds.forEach((id, index) => {
        if (id !== null && id !== previousFlowIds[index]) enteredFlowSlots.add(index);
      });
    }
    state.flowMatchId = game.matchId;
    state.flowCardIds = currentFlowIds;
    conveyor.innerHTML = '';
    const nextPos = game.discardIndex % 9;
    game.conveyor.forEach((card, index) => {
      const slot = document.createElement('div');
      slot.className = `slot${index === nextPos ? ' current-discard' : ''}${index === game.lastDiscardPos ? ' latest-discard' : ''}${used.has(index) ? ' used-space' : ''}`;
      const num = document.createElement('span'); num.className = 'slotnum'; num.textContent = index + 1; slot.appendChild(num);
      if (card) {
        const cardEl = makeCard(card, null, false);
        cardEl.classList.add('flowcard');
        if (enteredFlowSlots.has(index)) cardEl.classList.add('flow-enter');
        cardEl.innerHTML = '';
        const bits = document.createElement('span'); bits.className = `bitpair${isSpecial(card) ? ' small' : ''}`; bits.textContent = isSpecial(card) ? card.pair : String(card.value); cardEl.appendChild(bits);
        slot.appendChild(cardEl);
        if ((game.covers[index] || 0) > 1) { const stack = document.createElement('span'); stack.className = 'stack'; stack.textContent = `×${game.covers[index]}`; slot.appendChild(stack); }
      }
      conveyor.appendChild(slot);
    });

    const patternsBox = $('#patterns');
    patternsBox.innerHTML = '';
    for (const pattern of patternList()) {
      const item = document.createElement('span');
      item.className = `pattern${pattern.locked ? ' locked' : ''}`;
      item.textContent = `${pattern.indices.map((index) => index + 1).join('–')}: ${pattern.cards.map(cardCode).join(' → ')}${pattern.locked ? ' • BLOQUEADO' : ''}`;
      patternsBox.appendChild(item);
    }
    if (!patternsBox.children.length) { const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = 'Ainda não há três posições consecutivas preenchidas no <fluxo>.'; patternsBox.appendChild(sub); }

    const log = $('#log');
    log.innerHTML = '';
    for (const entry of game.logs || []) { const line = document.createElement('div'); line.className = 'log-entry'; line.textContent = entry.text; log.appendChild(line); }
    renderControls();
    renderSortButtons();

    if (game.winnerId && state.shownWinnerMatch !== game.matchId) {
      state.shownWinnerMatch = game.matchId;
      UI001.showWinner(winner?.name || 'Jogador', game.winnerId === room.viewerId);
    }
    if (room.restart) renderRestartVote();
    // Mobile keeps one stable scale for the whole match. Re-rendering cards or
    // bot actions must never temporarily expose the unscaled layout.
    if (DEVICE === 'mobile') UI001.updateMobileStageScale?.();
    else requestAnimationFrame(() => UI001.updateFitScale?.());
  }

  function renderSortButtons() {
    const map = { number: '#sortNumberBtn', color: '#sortColorBtn', free: '#sortFreeBtn' };
    Object.entries(map).forEach(([mode, selector]) => $(selector)?.classList.toggle('active', state.sortMode === mode));
    const hint = $('#sortHint');
    if (!hint) return;
    if (viewerIsSpectator()) { hint.textContent = 'Modo espectador: acompanhando a partida em tempo real.'; return; }
    hint.textContent = state.sortMode === 'number'
      ? 'Ordenado por números: 0 e depois 1; dentro de cada grupo, vermelho → azul → verde → amarelo.'
      : state.sortMode === 'color'
        ? 'Ordenado por cores: vermelho → azul → verde → amarelo; 0 antes de 1.'
        : '↔ Modo Livre: arraste as cartas como quiser.';
  }

  function renderControls() {
    const game = state.room?.game;
    const player = me();
    const draw = $('#drawBtn');
    const refresh = $('#refreshBtn');
    const capture = $('#meldBtn');
    const discard = $('#discardBtn');
    const msg = $('#humanMsg');
    const hint = $('#deckHint');
    const turnPrompt = $('#turnPrompt');
    const setTurnPrompt = (text, tone = '') => {
      if (!turnPrompt) return;
      turnPrompt.className = `turn-prompt${tone ? ` ${tone}` : ''}`;
      turnPrompt.textContent = text;
    };
    draw.disabled = true; refresh.disabled = true; capture.disabled = true; discard.disabled = true;
    capture.classList.remove('meld-ready', 'meld-invalid');
    hint.textContent = '';
    if (!game) { setTurnPrompt('Aguarde o início da partida.'); return; }
    if (viewerIsSpectator()) {
      setTurnPrompt('Você entrou como espectador. Acompanhe a partida em tempo real.', 'wait');
      msg.className = 'msg';
      const current = gamePlayer(game.currentPlayerId);
      msg.textContent = current ? `Observando: turno de ${current.name}.` : 'Observando a partida.';
      return;
    }
    if (!player) { setTurnPrompt('Aguarde o início da partida.'); return; }
    if (game.phase === 'gameover') {
      const winner = gamePlayer(game.winnerId);
      setTurnPrompt(winner ? `${winner.id === state.room.viewerId ? 'Você venceu!' : `${winner.name} venceu!`} Partida encerrada.` : 'Partida encerrada.', 'done');
      msg.className = 'msg good';
      msg.textContent = winner ? `${winner.id === state.room.viewerId ? 'Você venceu!' : `${winner.name} venceu!`} 4 fragmentos capturados • 12 bits completos.` : 'Partida encerrada.';
      return;
    }
    if (!isMyTurn()) {
      const current = gamePlayer(game.currentPlayerId);
      const latest = Array.isArray(game.logs) && game.logs.length ? game.logs[game.logs.length - 1]?.text : '';
      const botAction = current?.type === 'bot' && latest ? latest : '';
      setTurnPrompt(botAction || `Aguarde: é o turno de ${current?.name || 'outro jogador'}.`, 'wait');
      msg.className = 'msg';
      msg.textContent = current?.type === 'bot' ? `${current.name} está jogando...` : `Turno de ${current?.name || 'outro jogador'}.`;
      return;
    }
    if (game.phase === 'draw') {
      draw.disabled = !game.deckTop;
      refresh.disabled = player.refresh <= 0 || !game.deckTop || game.refreshesThisTurn >= 3;
      hint.textContent = game.deckTop ? `Topo: ${cardLabel(game.deckTop)} • Atualizações: ${player.refresh}/3 • usadas neste turno: ${game.refreshesThisTurn}/3` : '<entrada> vazia';
      setTurnPrompt('É o seu turno: <atualizar> o deck ou comprar carta da <entrada>.', 'active');
      msg.className = 'msg warn';
      msg.textContent = game.refreshesThisTurn === 0
        ? '1. FILTRAR / COMPRAR — compre o topo visível da <entrada> ou use <atualização>.'
        : '1. FILTRAR / COMPRAR — compre o novo topo ou use sua próxima <atualização>.';
      return;
    }
    if (game.phase === 'play') {
      setTurnPrompt(game.capturedThisTurn ? 'É o seu turno: descarte 1 carta no <fluxo>.' : 'É o seu turno: <capturar> 1 fragmento ou descartar carta no <fluxo>.', 'active');
      const cards = selectedCards();
      discard.disabled = !(cards.length === 1 && canDiscardClient(cards[0]));
      if (game.capturedThisTurn) {
        msg.className = 'msg';
        msg.textContent = cards.length === 1
          ? (canDiscardClient(cards[0]) ? 'Fragmento já capturado neste turno. Clique em DESCARTAR.' : 'Essa carta está OFFLINE ou não pode ser descartada agora.')
          : 'Você já capturou 1 fragmento neste turno. Agora selecione 1 carta para descartar no <fluxo>.';
        return;
      }
      const match = [2, 3].includes(cards.length) ? matchForClient(cards) : null;
      const fullInvalid = (cards.length === 3 && !match) || (cards.length === 2 && cards.filter(isSpecial).length === 1 && !match);
      if (match) { capture.disabled = false; capture.classList.add('meld-ready'); }
      else if (fullInvalid) { capture.disabled = false; capture.classList.add('meld-invalid'); }
      if (match) {
        msg.className = 'msg good';
        msg.textContent = `Fragmento válido: ${match.indices.map((index) => index + 1).join('–')}. Clique em CAPTURAR.`;
      } else if (fullInvalid) {
        msg.className = 'msg warn';
        msg.textContent = 'Essas cartas não correspondem a nenhum fragmento disponível do <fluxo>.';
      } else if (cards.length === 1) {
        msg.className = 'msg';
        msg.textContent = canDiscardClient(cards[0]) ? '1 carta selecionada: continue selecionando para capturar ou clique em DESCARTAR.' : 'Essa carta está OFFLINE ou não pode ser descartada agora.';
      } else {
        msg.className = 'msg';
        msg.textContent = 'Você pode capturar no máximo 1 fragmento neste turno. Use 3 cartas normais ou 1 especial + 1 normal; ou selecione 1 carta para descartar.';
      }
    }
  }

  function enterRoomState(room) {
    state.room = room;
    if (room.status === 'game' && room.game) {
      showScreen('#lobbyScreen');
      renderGame();
    } else {
      document.body.classList.remove('in-game', 'viewer-spectator');
      const banner = $('#viewerBanner');
      if (banner) { banner.textContent = ''; banner.classList.remove('show'); }
      showScreen('#lobbyScreen');
      renderLobby();
    }
  }

  function emitAck(event, payload, callback) {
    if (!state.socket?.connected) return callback?.({ ok: false, error: 'Sem conexão com o servidor.' });
    state.socket.emit(event, payload || {}, (response) => callback?.(response || { ok: false, error: 'Sem resposta do servidor.' }));
  }

  function connect() {
    if (typeof io !== 'function') { setEntryStatus('Não foi possível carregar a conexão com o servidor.'); return; }
    const socket = io({ transports: ['websocket', 'polling'] });
    state.socket = socket;
    socket.on('connect', () => {
      const pill = $('#connectionPill');
      if (pill) { pill.textContent = 'online'; pill.classList.add('online'); }
      if (state.token) {
        emitAck('room:resume', { token: state.token, device: DEVICE }, (res) => {
          if (!res.ok) { saveToken(''); document.body.classList.remove('in-game'); showScreen('#entryScreen'); return; }
          saveToken(res.token || state.token);
          enterRoomState(res.room);
        });
      }
    });
    socket.on('disconnect', () => {
      const pill = $('#connectionPill');
      if (pill) { pill.textContent = 'reconectando...'; pill.classList.remove('online'); }
    });
    socket.on('room:state', (room) => enterRoomState(room));
    socket.on('game:start', (room) => { enterRoomState(room); UI001.note('Partida iniciada.'); });
    socket.on('restart:requested', () => renderRestartVote());
    socket.on('restart:rejected', ({ by }) => { $('#restartVoteModal')?.classList.remove('open'); UI001.note(`${playerName(by)} recusou o reinício.`); });
    socket.on('game:restart', () => { $('#restartVoteModal')?.classList.remove('open'); state.selected.clear(); state.handOrder = []; state.shownWinnerMatch = null; UI001.note('Todos aceitaram. Nova partida iniciada.'); });
  }

  $('#roomCodeInput')?.setAttribute('maxlength', '4');
  if ($('#roomCodeInput')) $('#roomCodeInput').placeholder = 'A2B3';
  $('#roomCodeInput')?.addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4); });
  const savedName = localStorage.getItem('001_nickname');
  if (savedName && $('#nicknameInput')) $('#nicknameInput').value = savedName;

  $('#createRoomBtn')?.addEventListener('click', () => {
    const nickname = ($('#nicknameInput')?.value || '').trim();
    localStorage.setItem('001_nickname', nickname);
    setEntryStatus('');
    emitAck('room:create', { nickname, device: DEVICE }, (res) => {
      if (!res.ok) return setEntryStatus(res.error || 'Não foi possível criar a sala.');
      saveToken(res.token); enterRoomState(res.room);
    });
  });
  $('#joinRoomBtn')?.addEventListener('click', () => {
    const nickname = ($('#nicknameInput')?.value || '').trim();
    const code = ($('#roomCodeInput')?.value || '').trim().toUpperCase();
    localStorage.setItem('001_nickname', nickname);
    setEntryStatus('');
    emitAck('room:join', { nickname, code, device: DEVICE }, (res) => {
      if (!res.ok) return setEntryStatus(res.error || 'Não foi possível entrar na sala.');
      saveToken(res.token); enterRoomState(res.room);
      if (res.room?.viewerIsSpectator) UI001.note('Você entrou como espectador.');
    });
  });
  $('#copyRoomCode')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.room?.code || ''); UI001.note('Código copiado!'); }
    catch { UI001.note('Não foi possível copiar automaticamente.'); }
  });
  $('#addBotBtn')?.addEventListener('click', () => emitAck('room:addBot', {}, (res) => { if (!res.ok) setLobbyStatus(res.error); }));
  $('#startRoomBtn')?.addEventListener('click', () => emitAck('room:start', {}, (res) => { if (!res.ok) setLobbyStatus(res.error); }));
  function leaveCurrentRoom() { emitAck('room:leave', {}, () => { saveToken(''); state.room = null; document.body.classList.remove('in-game', 'viewer-spectator'); showScreen('#entryScreen'); }); }
  $('#leaveRoomBtn')?.addEventListener('click', leaveCurrentRoom);
  $('#exitRoomBtn')?.addEventListener('click', leaveCurrentRoom);

  $('#drawBtn')?.addEventListener('click', () => emitAck('game:draw', {}, (res) => { if (!res.ok) UI001.note(res.error); }));
  $('#refreshBtn')?.addEventListener('click', () => emitAck('game:refresh', {}, (res) => { if (!res.ok) UI001.note(res.error); }));
  $('#meldBtn')?.addEventListener('click', () => {
    const cards = selectedCards();
    if (!matchForClient(cards)) return UI001.showInvalid();
    emitAck('game:capture', { cardIds: cards.map((card) => card.id) }, (res) => {
      if (!res.ok) { UI001.note(res.error); UI001.showInvalid(); }
      else state.selected.clear();
    });
  });
  $('#discardBtn')?.addEventListener('click', () => {
    const cards = selectedCards();
    if (cards.length !== 1) return;
    emitAck('game:discard', { cardId: cards[0].id }, (res) => { if (!res.ok) UI001.note(res.error); else state.selected.clear(); });
  });

  function setSortMode(mode) {
    if (viewerIsSpectator() || !me()) return;
    const currentVisibleOrder = orderedHand(me(), true).map((card) => card.id);
    state.sortMode = mode;
    state.selected.clear();
    if (mode === 'free') state.handOrder = currentVisibleOrder;
    else state.handOrder = orderedHand(me(), true).map((card) => card.id);
    renderGame();
  }
  $('#sortNumberBtn')?.addEventListener('click', () => setSortMode('number'));
  $('#sortColorBtn')?.addEventListener('click', () => setSortMode('color'));
  $('#sortFreeBtn')?.addEventListener('click', () => setSortMode('free'));

  function clearDragMarks() { $$('#hand0 .card').forEach((card) => card.classList.remove('dragging', 'drag-over-left', 'drag-over-right')); }
  $('#hand0')?.addEventListener('pointerdown', (event) => {
    if (viewerIsSpectator() || DEVICE === 'mobile' || state.sortMode !== 'free' || event.button !== 0) return;
    const card = event.target.closest('#hand0 .card');
    if (!card) return;
    state.drag = { id: Number(card.dataset.cardId), startX: event.clientX, startY: event.clientY, dragging: false, targetId: null, after: false, pointerId: event.pointerId, suppressClick: false };
  });
  window.addEventListener('pointermove', (event) => {
    const drag = state.drag;
    if (drag.id === null || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
    drag.dragging = true; event.preventDefault(); clearDragMarks();
    document.querySelector(`#hand0 .card[data-card-id="${drag.id}"]`)?.classList.add('dragging');
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('#hand0 .card');
    if (!target || Number(target.dataset.cardId) === drag.id) { drag.targetId = null; return; }
    const rect = target.getBoundingClientRect(); drag.after = event.clientX > rect.left + rect.width / 2; drag.targetId = Number(target.dataset.cardId); target.classList.add(drag.after ? 'drag-over-right' : 'drag-over-left');
  }, { passive: false });
  window.addEventListener('pointerup', (event) => {
    const drag = state.drag;
    if (drag.id === null || drag.pointerId !== event.pointerId) return;
    if (drag.dragging) {
      event.preventDefault();
      const order = state.handOrder.filter((id) => id !== drag.id);
      let insert = order.length;
      if (drag.targetId !== null) { insert = order.indexOf(drag.targetId); if (insert < 0) insert = order.length; else if (drag.after) insert += 1; }
      order.splice(insert, 0, drag.id); state.handOrder = order; state.selected.clear(); state.drag.suppressClick = true; clearDragMarks(); renderGame();
      setTimeout(() => { state.drag.suppressClick = false; }, 180);
    }
    state.drag.id = null; state.drag.dragging = false; state.drag.pointerId = null;
  }, { passive: false });

  $('#restartVoteYes')?.addEventListener('click', () => emitAck('restart:vote', { accept: true }, (res) => { if (!res.ok) UI001.note(res.error); }));
  $('#restartVoteNo')?.addEventListener('click', () => emitAck('restart:vote', { accept: false }, (res) => { if (!res.ok) UI001.note(res.error); }));

  window.Online001 = {
    requestRestart() {
      emitAck('restart:request', {}, (res) => { if (!res.ok) UI001.note(res.error); else if (!res.result?.restarted) UI001.note('Pedido de reinício enviado.'); });
    },
    getRoom() { return state.room; }
  };

  connect();
})();
