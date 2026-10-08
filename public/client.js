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
    shownModeMatch: null,
    shownIntroMatch: null,
    introTimers: [],
    introInterval: null,
    flowMatchId: null,
    flowCardIds: null,
    sfxMatchId: null,
    sfxSeq: 0,
    soundMuted: localStorage.getItem('001_sound_muted') === '1',
    drag: { id: null, startX: 0, startY: 0, dragging: false, targetId: null, after: false, pointerId: null, suppressClick: false }
  };

  localStorage.setItem('001_device', DEVICE);


  // v73 — Em celular vertical, iniciar a partida no mesmo enquadramento do
  // botão de ajustar a tela. Respeita qualquer escolha manual posterior.
  const portraitAutoFit = { pending: false, internalClick: false, userOverride: false };

  function syncPortraitAutoFit() {
    if (DEVICE !== 'mobile' || portraitAutoFit.userOverride || portraitAutoFit.pending) return;
    if (!document.body.classList.contains('in-game')) return;
    const button = $('#fitBtn');
    if (!button) return;
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    if (button.classList.contains('active') === portrait) {
      if (portrait) requestAnimationFrame(() => requestAnimationFrame(() => ensurePortraitAllPlayersVisible()));
      return;
    }

    portraitAutoFit.pending = true;
    // Aguarda a montagem completa do tabuleiro e o primeiro recálculo de escala.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      portraitAutoFit.pending = false;
      if (!document.body.classList.contains('in-game') || portraitAutoFit.userOverride) return;
      const fit = $('#fitBtn');
      if (!fit) return;
      const vertical = window.matchMedia('(orientation: portrait)').matches;
      if (fit.classList.contains('active') === vertical) return;
      portraitAutoFit.internalClick = true;
      try { fit.click(); } finally { portraitAutoFit.internalClick = false; }
      if (vertical) requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => ensurePortraitAllPlayersVisible())));
    }));
  }

  function ensurePortraitAllPlayersVisible(step = 0) {
    if (DEVICE !== 'mobile' || !document.body.classList.contains('in-game')) return;
    if (!window.matchMedia('(orientation: portrait)').matches) return;
    if (portraitAutoFit.userOverride || !$('#fitBtn')?.classList.contains('active')) return;
    const app = $('#gameApp');
    if (!app) return;
    const bottomLimit = Math.min(window.innerHeight - 4, ($('.legal-footer')?.getBoundingClientRect().top ?? window.innerHeight) - 4);
    const bounds = app.getBoundingClientRect();
    if (bounds.bottom <= bottomLimit + 1 || bounds.height <= 0) return;
    // O zoom padrão pode subestimar o rodapé e a altura extra das mensagens.
    // Corrige somente a área que transbordou, sem reposicionar componentes.
    const available = bottomLimit - Math.max(0, bounds.top);
    if (available <= 0) return;
    const shrink = Math.max(0.65, Math.min(0.98, (available / bounds.height) * 0.98));
    const zoom = Number.parseFloat(app.style.zoom) || 1;
    app.style.zoom = Math.max(0.30, zoom * shrink).toFixed(3);
    if (step < 4) requestAnimationFrame(() => ensurePortraitAllPlayersVisible(step + 1));
  }

  function releaseDefaultPortraitFit() {
    if (DEVICE !== 'mobile' || portraitAutoFit.userOverride) return;
    const button = $('#fitBtn');
    if (!button?.classList.contains('active')) return;
    // Não deixa o zoom automático aplicado no lobby ou na tela de entrada.
    portraitAutoFit.internalClick = true;
    try { button.click(); } finally { portraitAutoFit.internalClick = false; }
  }

  function installMobilePhysicalManual() {
    if (DEVICE !== 'mobile' || $('.physical-manual-link')) return;
    const footer = $('.legal-footer');
    if (!footer) return;
    // Link já existente no desktop: restaura-o na versão móvel com o mesmo destino.
    const link = document.createElement('a');
    link.className = 'btn physical-manual-link';
    link.href = 'https://drive.google.com/file/d/12i0FPjL79dPumXRwTyfql8Pu1JBw0dxc/view?usp=sharing';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Manual Jogo Físico';
    link.setAttribute('aria-label', 'Abrir manual do jogo físico');
    link.title = 'Abrir manual do jogo físico';
    footer.appendChild(link);
  }

  // v72 — A mesma animação visual para qualquer carta recebida da <entrada>:
  // compra normal, compra após a 3ª <atualização> e reposição por <captura>.
  // Funciona na mão de todos os participantes (humanos e robôs).
  // Cada carta leva 700 ms (350 ms saindo da entrada + 350 ms surgindo na mão).
  // A compra/reposição real continua sendo decidida pelo servidor; esta camada é apenas visual.
  const refillFX = {
    matchId: null, queue: [], pending: new Map(), running: false,
    timers: new Set(), ghosts: new Set()
  };

  function clearRefillFX() {
    for (const timer of refillFX.timers) clearTimeout(timer);
    for (const ghost of refillFX.ghosts) ghost.remove();
    refillFX.timers.clear();
    refillFX.ghosts.clear();
    refillFX.queue.length = 0;
    refillFX.pending.clear();
    refillFX.running = false;
  }

  function refillTimeout(fn, delay) {
    const timer = setTimeout(() => {
      refillFX.timers.delete(timer);
      fn();
    }, delay);
    refillFX.timers.add(timer);
  }

  function prepareRefillFX(previousRoom, nextRoom) {
    const previousGame = previousRoom?.game;
    const game = nextRoom?.game;
    if (!game || refillFX.matchId !== game.matchId) {
      clearRefillFX();
      refillFX.matchId = game?.matchId || null;
    }
    // Não anima carregamento inicial, F5 nem troca de sala ou partida.
    if (!game || !previousGame || previousRoom.code !== nextRoom.code || previousGame.matchId !== game.matchId) return;
    for (const player of game.players || []) {
      const before = previousGame.players?.find((other) => other.id === player.id);
      if (!before) continue;
      // Só anima IDs que acabaram de entrar na mão: compras comuns, compras
      // obrigatórias e todas as reposições após <captura>, inclusive pós-descarte.
      const previousIds = new Set((before.hand || []).map((card) => card.id));
      const received = (player.hand || []).filter((card) => !previousIds.has(card.id));
      for (const card of received) {
        const key = `${player.id}:${card.id}`;
        if (refillFX.pending.has(key)) continue;
        refillFX.pending.set(key, 'waiting');
        refillFX.queue.push({ key, playerId: player.id, card });
      }
    }
  }

  function refillCardElement(playerId, cardId) {
    const room = state.room;
    if (!room?.game) return null;
    const participants = [...room.game.players].sort((a, b) => a.seat - b.seat);
    const display = viewerIsSpectator()
      ? participants
      : [me(), ...participants.filter((player) => player.id !== room.viewerId)].filter(Boolean);
    const index = display.findIndex((player) => player.id === playerId);
    if (index < 0) return null;
    return document.querySelector(`#hand${index} [data-card-id="${cardId}"]`);
  }

  function advanceRefillFX() {
    const job = refillFX.queue.shift();
    if (!job) { refillFX.running = false; return; }
    refillFX.running = true;
    const target = refillCardElement(job.playerId, job.card.id);
    const deck = $('#deckPile');
    const anchor = deck?.querySelector('.card') || deck;
    const rect = anchor?.getBoundingClientRect();
    // Se a carta já saiu da mão (por exemplo, um robô descartou), não a anima.
    if (!target || !rect?.width || !rect?.height) {
      refillFX.pending.delete(job.key);
      if (target) target.classList.remove('refill-fx-waiting', 'refill-fx-arriving');
      advanceRefillFX();
      return;
    }
    const ghost = makeCard(job.card, null, false);
    ghost.classList.add('refill-fx-departing');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.cssText += `;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
    document.body.appendChild(ghost);
    refillFX.ghosts.add(ghost);

    refillTimeout(() => {
      ghost.remove();
      refillFX.ghosts.delete(ghost);
      if (refillFX.pending.has(job.key)) {
        refillFX.pending.set(job.key, 'arriving');
        const card = refillCardElement(job.playerId, job.card.id);
        if (card) {
          card.classList.remove('refill-fx-waiting');
          card.classList.add('refill-fx-arriving');
        }
      }
    }, 350);
    refillTimeout(() => {
      refillFX.pending.delete(job.key);
      const card = refillCardElement(job.playerId, job.card.id);
      if (card) card.classList.remove('refill-fx-waiting', 'refill-fx-arriving');
      advanceRefillFX();
    }, 700);
  }

  function installRefillFX() {
    if (document.getElementById('refillFxStyles')) return;
    const style = document.createElement('style');
    style.id = 'refillFxStyles';
    style.textContent = `
      @keyframes refill-fx-depart {
        from { transform:translateY(0); clip-path:inset(0 0 0 0); opacity:1; }
        to { transform:translateY(60%); clip-path:inset(0 0 100% 0); opacity:0; }
      }
      @keyframes refill-fx-rise {
        from { transform:translateY(23px); clip-path:inset(100% 0 0 0); opacity:1; }
        to { transform:translateY(0); clip-path:inset(0 0 0 0); opacity:1; }
      }
      .refill-fx-departing {
        position:fixed!important; margin:0!important; z-index:1100!important;
        pointer-events:none!important; user-select:none!important;
        animation:refill-fx-depart 350ms ease-in both!important;
      }
      .refill-fx-waiting { visibility:hidden!important; pointer-events:none!important; }
      .refill-fx-arriving {
        pointer-events:none!important;
        animation:refill-fx-rise 350ms ease-out both!important;
      }
    `;
    document.head.appendChild(style);
  }


  // v74 — dez posições reservadas, estáveis, para a mão de todos os jogadores.
  // Espaços vazios não são cartas e nunca recebem eventos de clique ou drag.
  const HAND_CAPACITY = 10;

  function installFixedHandSlots() {
    if (document.getElementById('fixedHandSlotsStyles')) return;
    const style = document.createElement('style');
    style.id = 'fixedHandSlotsStyles';
    style.textContent = `
      /* O ID evita que as regras antigas de 9 colunas sobreponham estas 10. */
      #hand0.fixed-card-slots, #hand1.fixed-card-slots,
      #hand2.fixed-card-slots, #hand3.fixed-card-slots {
        display:grid!important;
        grid-template-columns:repeat(10,minmax(0,1fr))!important;
        grid-template-rows:auto!important;
        grid-auto-flow:row!important;
        align-content:start!important;
        align-items:stretch!important;
        flex-wrap:nowrap!important;
        width:100%!important;
        min-width:0!important;
        max-width:560px!important;
        gap:4px!important;
        padding:3px 0!important;
        overflow:visible!important;
      }
      #hand1.fixed-card-slots, #hand2.fixed-card-slots,
      #hand3.fixed-card-slots {
        max-width:390px!important;
        gap:2px!important;
        padding:2px 0!important;
      }
      #hand0.fixed-card-slots > .card, #hand1.fixed-card-slots > .card,
      #hand2.fixed-card-slots > .card, #hand3.fixed-card-slots > .card {
        box-sizing:border-box!important;
        width:100%!important;
        min-width:0!important;
        max-width:none!important;
        justify-self:stretch!important;
      }
      #hand0.fixed-card-slots > .hand-empty-slot,
      #hand1.fixed-card-slots > .hand-empty-slot,
      #hand2.fixed-card-slots > .hand-empty-slot,
      #hand3.fixed-card-slots > .hand-empty-slot {
        box-sizing:border-box;
        display:block;
        width:100%;
        min-width:0;
        min-height:72px;
        height:72px;
        border:1px dashed rgba(103,126,152,.30);
        background:rgba(15,25,38,.22);
        border-radius:4px;
        pointer-events:none;
        user-select:none;
        opacity:.60;
      }
      #hand1.fixed-card-slots > .hand-empty-slot,
      #hand2.fixed-card-slots > .hand-empty-slot,
      #hand3.fixed-card-slots > .hand-empty-slot {
        min-height:54px;
        height:54px;
        border-radius:3px;
      }
      body.device-mobile #hand0.fixed-card-slots,
      body.device-mobile #hand1.fixed-card-slots,
      body.device-mobile #hand2.fixed-card-slots,
      body.device-mobile #hand3.fixed-card-slots {
        max-width:none!important;
        gap:2px!important;
        overflow:visible!important;
      }
      body.device-mobile #hand0.fixed-card-slots > .hand-empty-slot {
        height:auto; min-height:54px; aspect-ratio:.56;
      }
      body.device-mobile #hand1.fixed-card-slots > .hand-empty-slot,
      body.device-mobile #hand2.fixed-card-slots > .hand-empty-slot,
      body.device-mobile #hand3.fixed-card-slots > .hand-empty-slot {
        height:auto; min-height:38px; aspect-ratio:.70;
      }
      body.device-mobile.mobile-landscape #hand0.fixed-card-slots,
      body.device-mobile.mobile-landscape #hand1.fixed-card-slots,
      body.device-mobile.mobile-landscape #hand2.fixed-card-slots,
      body.device-mobile.mobile-landscape #hand3.fixed-card-slots {
        gap:3px!important;
        padding:2px 0!important;
        overflow:hidden!important;
      }
      body.device-mobile.mobile-landscape #hand0.fixed-card-slots > .hand-empty-slot,
      body.device-mobile.mobile-landscape #hand1.fixed-card-slots > .hand-empty-slot,
      body.device-mobile.mobile-landscape #hand2.fixed-card-slots > .hand-empty-slot,
      body.device-mobile.mobile-landscape #hand3.fixed-card-slots > .hand-empty-slot {
        height:48px; min-height:48px; aspect-ratio:auto;
      }
    `;
    document.head.appendChild(style);
  }

  function reserveEmptyHandSlots(handBox, count) {
    handBox.classList.add('fixed-card-slots');
    for (let index = count; index < HAND_CAPACITY; index++) {
      const empty = document.createElement('span');
      empty.className = 'hand-empty-slot';
      empty.setAttribute('aria-hidden', 'true');
      handBox.appendChild(empty);
    }
  }

  // v70: painel lateral de ações; fora de #gameApp, sem afetar a grade ou os controles.
  const historyUI = { root: null, toggle: null, panel: null, list: null, counter: null, matchId: null, signature: null };

  function closeHistory() {
    if (!historyUI.panel) return;
    historyUI.panel.hidden = true;
    historyUI.toggle.setAttribute('aria-expanded', 'false');
    historyUI.toggle.setAttribute('aria-label', 'Abrir log da partida');
  }

  function renderHistory(game) {
    if (!game || !historyUI.list) return;
    if (historyUI.matchId !== game.matchId) {
      historyUI.matchId = game.matchId;
      historyUI.signature = null;
    }
    // Não gera DOM novo durante os turnos se o painel estiver fechado.
    if (historyUI.panel.hidden) return;
    const logs = Array.isArray(game.logs) ? game.logs : [];
    const newest = logs[0];
    const signature = `${game.matchId}|${logs.length}|${newest?.at ?? ''}|${newest?.text ?? ''}`;
    if (signature === historyUI.signature) return;
    historyUI.signature = signature;
    const oldHeight = historyUI.list.scrollHeight;
    const oldScroll = historyUI.list.scrollTop;
    const browsingOlder = oldScroll > 24;
    const fragment = document.createDocumentFragment();
    if (!logs.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'As ações da partida aparecerão aqui.';
      fragment.appendChild(empty);
    }
    // O servidor fornece até 80 eventos em ordem reversa de criação (novos primeiro).
    for (const entry of logs) {
      const item = document.createElement('div');
      item.className = 'history-item';
      const description = String(entry?.text || '');
      if (/venceu|capturou/i.test(description)) item.classList.add('history-positive');
      else if (/invasão|desconectar|bloqueio/i.test(description)) item.classList.add('history-alert');
      const timestamp = new Date(Number(entry?.at));
      if (Number.isFinite(Number(entry?.at)) && !Number.isNaN(timestamp.getTime())) {
        const time = document.createElement('time');
        time.className = 'history-time';
        time.dateTime = timestamp.toISOString();
        time.textContent = timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        item.appendChild(time);
      }
      const content = document.createElement('div');
      content.className = 'history-description';
      // Termos <fluxo>, <entrada> etc. devem permanecer visíveis, nunca ser interpretados como HTML.
      content.textContent = description;
      item.appendChild(content);
      fragment.appendChild(item);
    }
    historyUI.list.replaceChildren(fragment);
    historyUI.counter.textContent = `${logs.length} evento${logs.length === 1 ? '' : 's'} • recentes primeiro`;
    // Preserva a leitura dos itens anteriores quando outro jogador realiza uma ação.
    historyUI.list.scrollTop = browsingOlder ? oldScroll + historyUI.list.scrollHeight - oldHeight : 0;
  }

  function installHistory() {
    if (historyUI.root) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '/activity-log.css?v=70';
    document.head.appendChild(style);

    const root = document.createElement('aside');
    root.id = 'historyWidget';
    root.className = 'history-widget';
    root.setAttribute('aria-label', 'Registro de ações');
    const panel = document.createElement('section');
    panel.id = 'historyPanel';
    panel.className = 'history-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Histórico de ações da partida');
    const heading = document.createElement('header');
    heading.className = 'history-heading';
    const title = document.createElement('strong');
    title.textContent = 'LOG DA PARTIDA';
    const counter = document.createElement('small');
    counter.className = 'history-counter';
    counter.textContent = 'Ações e consequências';
    heading.append(title, counter);
    const list = document.createElement('div');
    list.className = 'history-list';
    list.setAttribute('role', 'log');
    list.setAttribute('aria-live', 'off');
    list.setAttribute('aria-label', 'Ações da mais recente à mais antiga');
    panel.append(heading, list);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'history-toggle';
    toggle.textContent = 'LOG';
    toggle.title = 'Abrir ou fechar o histórico da partida';
    toggle.setAttribute('aria-controls', 'historyPanel');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir log da partida');
    root.append(panel, toggle);
    document.body.appendChild(root);
    Object.assign(historyUI, { root, toggle, panel, list, counter });
    toggle.addEventListener('click', () => {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.setAttribute('aria-label', `${opening ? 'Fechar' : 'Abrir'} log da partida`);
      if (opening) renderHistory(state.room?.game);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) closeHistory();
    });
  }

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

  const SOUND_VOLUMES = {
    flow: 0.35,
    refresh: 0.50,
    capture: 0.50,
    ui: 0.45,
    select: 0.34
  };
  const sounds = {
    flow: new Audio('/assets/sounds/flow.wav'),
    refresh: new Audio('/assets/sounds/refresh.wav'),
    capture: new Audio('/assets/sounds/capture.wav'),
    ui: new Audio('/assets/sounds/ui-confirm.wav'),
    select: new Audio('/assets/sounds/card-select.wav')
  };
  Object.entries(sounds).forEach(([name, audio]) => {
    audio.preload = 'auto';
    audio.volume = SOUND_VOLUMES[name] ?? 0.5;
  });

  function renderSoundToggle() {
    const button = $('#soundToggle');
    if (!button) return;
    button.textContent = state.soundMuted ? '🔇' : '🔊';
    button.classList.toggle('muted', state.soundMuted);
    button.setAttribute('aria-pressed', state.soundMuted ? 'true' : 'false');
    button.title = state.soundMuted ? 'Ativar sons do jogo' : 'Desativar sons do jogo';
  }

  function setSoundMuted(muted) {
    state.soundMuted = Boolean(muted);
    localStorage.setItem('001_sound_muted', state.soundMuted ? '1' : '0');
    renderSoundToggle();
  }

  function playSound(name) {
    if (state.soundMuted) return;
    const source = sounds[name];
    if (!source) return;
    try {
      source.pause();
      source.currentTime = 0;
      source.volume = SOUND_VOLUMES[name] ?? 0.5;
      const promise = source.play();
      promise?.catch?.(() => {});
    } catch {}
  }

  function handleSfx(game) {
    if (!game?.matchId) return;
    const event = game.sfxEvent;
    if (state.sfxMatchId !== game.matchId) {
      state.sfxMatchId = game.matchId;
      state.sfxSeq = event?.seq || 0;
      return;
    }
    if (!event || event.seq <= state.sfxSeq) return;
    state.sfxSeq = event.seq;
    if (event.type === 'capture') {
      playSound('capture');
      return;
    }
    // Toda carta que entra no <fluxo> é audível para a sala em volume menor.
    if (event.type === 'flow' || event.type === 'refresh') playSound('flow');
    // O detalhe de <atualização> continua local para quem usou o marcador.
    if (!viewerIsSpectator() && event.actorId === state.room?.viewerId && event.type === 'refresh') {
      setTimeout(() => playSound('refresh'), 45);
    }
  }

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
    else if (state.selected.size < 3) {
      state.selected.add(cardId);
      playSound('select');
    }
    syncSelectionUI();
  }

  function renderMarkers(container, player) {
    container.innerHTML = '';
    const capturedLabel = document.createElement('span');
    capturedLabel.className = 'caplabel';
    capturedLabel.textContent = '<capturados>';
    capturedLabel.dataset.help = `<b>&lt;capturados&gt; de ${player.name}</b>: ${player.captures}/4 fragmentos. Cada disquete aceso representa um fragmento capturado; ao completar os 4, o jogador conclui 12 bits e vence.`;
    container.appendChild(capturedLabel);
    for (let i = 0; i < 4; i += 1) {
      const active = i < player.captures;
      const marker = document.createElement('span');
      marker.className = `meldmark${active ? ' on' : ''}`;
      marker.dataset.help = `<b>Disquete ${i + 1} de ${player.name}</b>: ${active ? 'fragmento já capturado.' : 'ainda vazio.'} Progresso atual: ${player.captures}/4 <b>&lt;capturados&gt;</b>.`;
      container.appendChild(marker);
    }
    const updateLabel = document.createElement('span');
    updateLabel.className = 'updlabel';
    updateLabel.textContent = '<atualização>';
    updateLabel.dataset.help = `<b>&lt;atualização&gt; de ${player.name}</b>: restam ${player.refresh}/3 marcadores. Antes da compra, cada marcador pode enviar o topo da &lt;entrada&gt; diretamente ao próximo espaço do &lt;fluxo&gt;.`;
    container.appendChild(updateLabel);
    for (let i = 0; i < 3; i += 1) {
      const available = i < player.refresh;
      const marker = document.createElement('span');
      marker.className = `refreshmark${available ? ' on' : ''}`;
      marker.dataset.help = `<b>Marcador de &lt;atualização&gt; ${i + 1} de ${player.name}</b>: ${available ? 'disponível.' : 'já utilizado.'} Restam ${player.refresh}/3 nesta partida.`;
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
        pill.dataset.help = `<b>&lt;desconectar&gt;</b>: ${player.name} está com a cor <b>${colorInfo(player.offlineColor).name}</b> offline neste turno. Cartas dessa cor não podem ser usadas nem descartadas até o fim do turno.`;
      } else {
        pill.append(' online');
        pill.dataset.help = `<b>${player.name}</b> não possui nenhuma cor &lt;desconectada&gt; neste turno.`;
      }
      box.appendChild(pill);
    }
  }

  function binary12() {
    let value = '';
    for (let i = 0; i < 12; i += 1) value += Math.random() < 0.5 ? '0' : '1';
    return value;
  }

  function clearStartupSequence(close = true) {
    for (const timer of state.introTimers) clearTimeout(timer);
    state.introTimers = [];
    if (state.introInterval) clearInterval(state.introInterval);
    state.introInterval = null;
    if (close) $('#startupModal')?.classList.remove('open');
  }

  function maybeShowStartupSequence(game) {
    if (!game?.matchId || !game?.introEndsAt) return false;
    const remaining = Number(game.introEndsAt) - Date.now();
    const modal = $('#startupModal');
    const list = $('#startupPlayers');
    const progress = $('#startupProgress');
    if (remaining <= 0) {
      if (state.shownIntroMatch === game.matchId) clearStartupSequence(true);
      return false;
    }
    if (!modal || !list) return false;
    if (state.shownIntroMatch === game.matchId) return modal.classList.contains('open');

    clearStartupSequence(true);
    state.shownIntroMatch = game.matchId;
    modal.classList.add('open');
    list.innerHTML = '';
    const orderedPlayers = (game.turnOrder || []).map((id) => gamePlayer(id)).filter(Boolean);
    const rows = [];
    for (let index = 0; index < orderedPlayers.length; index += 1) {
      const row = document.createElement('div');
      row.className = `startup-player${index === 0 ? ' first' : ''}`;
      const bits = document.createElement('span');
      bits.className = 'startup-bits';
      bits.textContent = binary12();
      row.appendChild(bits);
      list.appendChild(row);
      rows.push({ row, bits, player: orderedPlayers[index], resolved: false, index });
    }

    const revealStep = 700;
    const total = (orderedPlayers.length + 1) * revealStep;
    const elapsed = Math.max(0, total - remaining);
    // Cada participante é revelado em intervalos exatos de 0,7 s.
    // Depois do último nome, o quadro permanece mais 0,7 s e fecha.
    const resolveAt = (index) => revealStep * (index + 1);
    const resolveRow = (item) => {
      if (!item || item.resolved) return;
      item.resolved = true;
      item.row.classList.add('resolved');
      item.bits.textContent = item.index === 0 ? `${item.player.name} — 1º jogador` : item.player.name;
    };

    rows.forEach((item) => {
      const wait = resolveAt(item.index) - elapsed;
      if (wait <= 0) resolveRow(item);
      else state.introTimers.push(setTimeout(() => resolveRow(item), wait));
    });

    state.introInterval = setInterval(() => {
      rows.forEach((item) => { if (!item.resolved) item.bits.textContent = binary12(); });
      if (progress) {
        const pct = Math.min(100, Math.max(0, ((Date.now() - (Number(game.introEndsAt) - total)) / total) * 100));
        progress.style.width = `${pct}%`;
      }
    }, 72);

    if (progress) progress.style.width = `${Math.min(100, Math.max(0, (elapsed / total) * 100))}%`;
    state.introTimers.push(setTimeout(() => {
      rows.forEach(resolveRow);
      clearStartupSequence(true);
      if (state.room?.game?.matchId === game.matchId) {
        maybeShowPlayerModeNotice(state.room.game);
        renderControls();
      }
    }, Math.max(0, remaining)));
    return true;
  }

  function maybeShowPlayerModeNotice(game) {
    const count = Number(game?.playerCount || game?.turnOrder?.length || 0);
    if (![2, 3].includes(count) || !game?.matchId || state.shownModeMatch === game.matchId) return;
    state.shownModeMatch = game.matchId;
    const modal = $('#playerModeModal');
    const title = $('#playerModeTitle');
    const text = $('#playerModeText');
    if (!modal || !title || !text) return;

    if (count === 2) {
      title.textContent = '2 jogadores — O Duelo';
      text.innerHTML = 'Quando uma carta for descartada e tiver a <b>mesma cor OU o mesmo valor (0 ou 1)</b> da carta do espaço imediatamente anterior, a carta do topo da &lt;entrada&gt; invade o espaço atual e o seu descarte entra no espaço seguinte. O espaço que recebeu a carta da &lt;entrada&gt; fica marcado com <b>cor/val</b>. Esse marcador permanece ali até uma nova carta cobrir aquele espaço.';
    } else {
      title.textContent = '3 jogadores — O Triângulo';
      text.innerHTML = 'Quando uma carta for descartada e tiver a <b>mesma cor</b> da carta do espaço imediatamente anterior, a carta do topo da &lt;entrada&gt; invade o espaço atual e o seu descarte entra no espaço seguinte. O espaço que recebeu a carta da &lt;entrada&gt; fica marcado com <b>cor</b>. Esse marcador permanece ali até uma nova carta cobrir aquele espaço.';
    }
    modal.classList.add('open');
  }

  function renderGame() {
    const room = state.room;
    const game = room?.game;
    if (!room || !game) return;
    handleSfx(game);
    updateHandOrder();
    document.body.classList.add('in-game');
    $('#restartVoteModal')?.classList.toggle('open', Boolean(room.restart));
    const startupOpen = maybeShowStartupSequence(game);
    if (!startupOpen) maybeShowPlayerModeNotice(game);

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
      for (const card of cards) {
        const element = makeCard(card, player, allowInteract);
        const status = refillFX.pending.get(`${player.id}:${card.id}`);
        if (status === 'waiting') element.classList.add('refill-fx-waiting');
        else if (status === 'arriving') element.classList.add('refill-fx-arriving');
        handBox.appendChild(element);
      }
      reserveEmptyHandSlots(handBox, cards.length);
      handBox.classList.toggle('selecting', allowInteract && isMyTurn() && game.phase === 'play');
      $(`#meta${slot}`).textContent = `${player.hand.length} cartas • ${player.captures}/4 capturas • ${player.refresh} atualizações`;
      seat.dataset.help = `<b>Área de ${(!spectator && player.id === room.viewerId) ? 'você' : player.name}</b>: ${player.hand.length} cartas abertas, ${player.captures}/4 &lt;capturados&gt; e ${player.refresh}/3 &lt;atualizações&gt; disponíveis.${game.currentPlayerId === player.id && !game.winnerId ? ' <b>É o turno deste jogador.</b>' : ''}`;
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
      top.dataset.help = `<b>Topo da &lt;entrada&gt;</b>: ${cardLabel(game.deckTop)}. Esta é a carta que será comprada ou enviada ao &lt;fluxo&gt; por uma &lt;atualização&gt;.`;
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
      chip.dataset.help = `<b>Ordem de turno</b>: ${player?.name || 'Jogador'} ocupa a posição ${index + 1} da sequência.${id === game.currentPlayerId && !game.winnerId ? ' <b>Está jogando agora.</b>' : ''}`;
      order.appendChild(chip);
      if (index < game.turnOrder.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'turn-arrow';
        arrow.textContent = '→';
        arrow.dataset.help = 'A seta mostra quem joga em seguida na ordem da partida.';
        order.appendChild(arrow);
      }
    });
    const loop = document.createElement('span');
    loop.className = 'turn-arrow';
    loop.textContent = '↺';
    loop.dataset.help = 'A ordem de turno é circular: depois do último jogador, a sequência volta ao primeiro.';
    order.appendChild(loop);
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
    const invasionSlots = new Set(game.invasionSlots || []);
    const playerCount = Number(game.playerCount || game.turnOrder?.length || 0);
    const conveyorWrap = conveyor.closest('.conveyor-wrap');
    conveyorWrap?.classList.toggle('has-invasion-history', invasionSlots.size > 0);
    game.conveyor.forEach((card, index) => {
      const slot = document.createElement('div');
      const isMemory = index === nextPos;
      const isLatest = index === game.lastDiscardPos;
      const isBlocked = used.has(index);
      const isInvaded = invasionSlots.has(index);
      slot.className = `slot${isMemory ? ' current-discard' : ''}${isLatest ? ' latest-discard' : ''}${isBlocked ? ' used-space' : ''}${isInvaded ? ' has-invasion-marker' : ''}`;

      const slotHelp = [`<b>Espaço ${index + 1} do &lt;fluxo&gt;</b>.`];
      if (card) slotHelp.push(`Topo visível: <b>${cardLabel(card)}</b>.`);
      else slotHelp.push('Este espaço está vazio.');
      if (isMemory) slotHelp.push('O triângulo amarelo indica a <b>&lt;memória&gt;</b>: este é o próximo espaço que receberá uma carta.');
      if (isLatest) slotHelp.push('O marcador azul indica a carta que entrou mais recentemente por descarte.');
      if (isBlocked) slotHelp.push('O símbolo vermelho indica <b>&lt;bloqueio&gt;</b>: este espaço não pode participar de uma captura até receber uma nova carta.');
      if (isInvaded) slotHelp.push(`O marcador vermelho <b>${playerCount === 2 ? 'cor/val' : 'cor'}</b> indica que este espaço recebeu uma carta da &lt;entrada&gt; por invasão; ele some quando outra carta cobrir o espaço.`);
      slot.dataset.help = slotHelp.join(' ');

      const num = document.createElement('span');
      num.className = 'slotnum';
      num.textContent = index + 1;
      num.dataset.help = `Posição <b>${index + 1}</b> do &lt;fluxo&gt;. O &lt;fluxo&gt; é circular: depois da posição 9, retorna à posição 1.`;
      slot.appendChild(num);

      if (isInvaded && (playerCount === 2 || playerCount === 3)) {
        const invasion = document.createElement('span');
        invasion.className = `invasion-marker invasion-${playerCount}`;
        invasion.textContent = playerCount === 2 ? 'cor/val' : 'cor';
        invasion.dataset.help = playerCount === 2
          ? '<b>&lt;invasão 2&gt; — cor/val</b>: este espaço recebeu a carta da &lt;entrada&gt; porque o descarte correspondia à mesma cor OU ao mesmo valor da carta anterior. O marcador desaparece quando este espaço recebe outra carta.'
          : '<b>&lt;invasão 3&gt; — cor</b>: este espaço recebeu a carta da &lt;entrada&gt; porque o descarte correspondia à mesma cor da carta anterior. O marcador desaparece quando este espaço recebe outra carta.';
        invasion.title = invasion.textContent;
        slot.appendChild(invasion);
      }

      if (card) {
        const cardEl = makeCard(card, null, false);
        cardEl.classList.add('flowcard');
        cardEl.dataset.help = `<b>Carta no espaço ${index + 1} do &lt;fluxo&gt;</b>: ${cardLabel(card)}.${isBlocked ? ' Este espaço está com &lt;bloqueio&gt; e não pode ser capturado agora.' : ' Está disponível para formar fragmentos, desde que os outros espaços da sequência também estejam disponíveis.'}`;
        if (enteredFlowSlots.has(index)) cardEl.classList.add('flow-enter');
        cardEl.innerHTML = '';
        const bits = document.createElement('span');
        bits.className = `bitpair${isSpecial(card) ? ' small' : ''}`;
        bits.textContent = isSpecial(card) ? card.pair : String(card.value);
        bits.dataset.help = cardEl.dataset.help;
        cardEl.appendChild(bits);
        slot.appendChild(cardEl);
        if ((game.covers[index] || 0) > 1) {
          const stack = document.createElement('span');
          stack.className = 'stack';
          stack.textContent = `×${game.covers[index]}`;
          stack.dataset.help = `<b>${game.covers[index]} cartas neste espaço</b>. Apenas a carta do topo está ativa no &lt;fluxo&gt;; as cartas cobertas permanecem sob ela e podem voltar à &lt;entrada&gt; quando o deck precisar ser refeito.`;
          slot.appendChild(stack);
        }
      }
      conveyor.appendChild(slot);
    });

    const patternsBox = $('#patterns');
    patternsBox.innerHTML = '';
    for (const pattern of patternList()) {
      const item = document.createElement('span');
      item.className = `pattern${pattern.locked ? ' locked' : ''}`;
      const positions = pattern.indices.map((index) => index + 1).join('–');
      item.textContent = `${positions}: ${pattern.cards.map(cardCode).join(' → ')}${pattern.locked ? ' • BLOQUEADO' : ''}`;
      item.dataset.help = pattern.locked
        ? `<b>Fragmento ${positions}</b>: esta sequência existe no &lt;fluxo&gt;, mas pelo menos um dos três espaços está com &lt;bloqueio&gt; e não pode ser capturada agora.`
        : `<b>Fragmento ${positions}</b>: sequência de três posições consecutivas e disponíveis do &lt;fluxo&gt;. Suas cartas podem ser selecionadas em qualquer ordem visual, desde que correspondam a esta sequência.`;
      patternsBox.appendChild(item);
    }
    if (!patternsBox.children.length) { const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = 'Ainda não há três posições consecutivas preenchidas no <fluxo>.'; patternsBox.appendChild(sub); }

    const log = $('#log');
    log.innerHTML = '';
    for (const entry of game.logs || []) { const line = document.createElement('div'); line.className = 'log-entry'; line.textContent = entry.text; log.appendChild(line); }
    renderHistory(game);
    renderControls();
    renderSortButtons();

    if (game.winnerId && state.shownWinnerMatch !== game.matchId) {
      state.shownWinnerMatch = game.matchId;
      UI001.showWinner(winner?.name || 'Jogador', game.winnerId === room.viewerId);
    }
    if (room.restart) renderRestartVote();
    // Mobile keeps one stable scale for the whole match. Re-rendering cards or
    // bot actions must never temporarily expose the unscaled layout.
    if (DEVICE === 'mobile') {
      UI001.updateMobileStageScale?.();
      syncPortraitAutoFit();
    } else requestAnimationFrame(() => UI001.updateFitScale?.());
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
      const playerCount = game?.players?.length || 0;
      const invasion = tone === 'active' && playerCount === 2
        ? 'Partida em 2 jogadores: Se uma carta for descartada ao lado de outra de mesmo valor ou cor, a carta do deck <entrada> é colocada entre elas.'
        : tone === 'active' && playerCount === 3
          ? 'Partida em 3 jogadores: Se uma carta for descartada ao lado de outra da mesma cor, a carta do deck <entrada> é colocada entre elas.'
          : '';
      // Texto puro: evita reconstruir nós DOM, preserva o aviso e os cliques do jogo.
      turnPrompt.textContent = invasion ? `${text}\n\n${invasion}` : text;
      turnPrompt.style.display = invasion ? 'block' : '';
      turnPrompt.style.whiteSpace = invasion ? 'pre-line' : '';
      turnPrompt.style.lineHeight = invasion ? '1.35' : '';
      turnPrompt.style.flexDirection = '';
    };
    draw.disabled = true; refresh.disabled = true; capture.disabled = true; discard.disabled = true;
    capture.classList.remove('meld-ready', 'meld-invalid');
    hint.textContent = '';
    if (!game) { setTurnPrompt('Aguarde o início da partida.'); return; }
    if (game.introEndsAt && Date.now() < Number(game.introEndsAt)) {
      const starter = gamePlayer(game.starterId || game.turnOrder?.[0]);
      setTurnPrompt('Conectando usuários do sistema... Definindo o 1º jogador...', 'wait');
      msg.className = 'msg';
      msg.textContent = starter ? `Primeiro acesso: ${starter.name}. A partida começa após a sincronização.` : 'Sincronizando jogadores...';
      return;
    }
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
    prepareRefillFX(state.room, room);
    state.room = room;
    if (room.status === 'game' && room.game) {
      showScreen('#lobbyScreen');
      renderGame();
      if (refillFX.queue.length && !refillFX.running) advanceRefillFX();
    } else {
      releaseDefaultPortraitFit();
      document.body.classList.remove('in-game', 'viewer-spectator');
      closeHistory();
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
    socket.on('game:start', (room) => { playSound('ui'); enterRoomState(room); UI001.note('Partida iniciada.'); });
    socket.on('restart:requested', () => renderRestartVote());
    socket.on('restart:rejected', ({ by }) => { $('#restartVoteModal')?.classList.remove('open'); UI001.note(`${playerName(by)} recusou o reinício.`); });
    socket.on('game:restart', () => { $('#restartVoteModal')?.classList.remove('open'); clearStartupSequence(true); state.selected.clear(); state.handOrder = []; state.shownWinnerMatch = null; state.shownModeMatch = null; state.shownIntroMatch = null; UI001.note('Todos aceitaram. Nova partida iniciada.'); });
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
      playSound('ui');
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
  function returnToRoomCreation() {
    // Send the leave request, but never make the UI wait for the server ack.
    if (state.socket?.connected && state.room) state.socket.emit('room:leave', {}, () => {});
    clearStartupSequence(true);
    state.shownIntroMatch = null;
    saveToken('');
    state.room = null;
    closeHistory();
    state.selected.clear();
    state.handOrder = [];
    state.shownWinnerMatch = null;
    state.shownModeMatch = null;
    state.flowMatchId = null;
    state.flowCardIds = null;
    releaseDefaultPortraitFit();
    document.body.classList.remove('in-game', 'viewer-spectator', 'mobile-landscape');
    $('#restartVoteModal')?.classList.remove('open');
    $('#leaveGameModal')?.classList.remove('open');
    $('#restartModal')?.classList.remove('open');
    $('#winnerModal')?.classList.remove('open');
    showScreen('#entryScreen');
    setEntryStatus('');
    UI001.updateMobileStageScale?.(true);
  }
  $('#leaveRoomBtn')?.addEventListener('click', returnToRoomCreation);
  $('#lobbyBackBtn')?.addEventListener('click', returnToRoomCreation);
  $('#playerModeOk')?.addEventListener('click', () => $('#playerModeModal')?.classList.remove('open'));

  function openLeaveGameConfirm() {
    $('#leaveGameModal')?.classList.add('open');
  }
  function closeLeaveGameConfirm() {
    $('#leaveGameModal')?.classList.remove('open');
  }
  $('#exitRoomBtn')?.addEventListener('click', openLeaveGameConfirm);
  $('#leaveGameCancel')?.addEventListener('click', closeLeaveGameConfirm);
  $('#leaveGameConfirm')?.addEventListener('click', () => {
    closeLeaveGameConfirm();
    returnToRoomCreation();
  });
  $('#leaveGameModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'leaveGameModal') closeLeaveGameConfirm();
  });

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

  // v75: atualiza apenas os textos de REGRAS com a reposição validada no servidor.
  function updateOnlineCaptureRules() {
    for (const item of document.querySelectorAll('#rules li')) {
      const rule = item.textContent || '';
      if (rule.includes('Após a captura, sua área é reposta')) {
        item.innerHTML = 'O jogador pode capturar <b>apenas 1 fragmento por turno</b>. Após a captura, compre cartas da &lt;entrada&gt; até voltar a ter <b>10 cartas</b> na sua área, mesmo que tenha usado 2 ou 3 cartas. Depois, descarte 1 carta.';
      } else if (rule.includes('depois do descarte reponha novamente')) {
        item.innerHTML = 'Após uma captura, <b>reponha até 10 cartas antes do descarte</b>. Descarte 1 carta e termine o turno com <b>9 cartas</b>. Não há nova reposição depois de descartar.';
      }
    }
  }
  updateOnlineCaptureRules();
  installHistory();
  installRefillFX();
  installFixedHandSlots();
  installMobilePhysicalManual();
  if (DEVICE === 'mobile') {
    $('#fitBtn')?.addEventListener('click', () => {
      if (!portraitAutoFit.internalClick) portraitAutoFit.userOverride = true;
    });
    window.addEventListener('resize', syncPortraitAutoFit);
    window.addEventListener('orientationchange', syncPortraitAutoFit);
  }
  connect();
})();
