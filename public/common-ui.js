(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  let fitActive = false;
  let mobileFitKey = '';

  function note(text, ms = 2200) {
    const el = $('#onlineNote');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(note.timer);
    note.timer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function openRules() { $('#rules')?.classList.add('open'); }
  function closeRules() { $('#rules')?.classList.remove('open'); }
  function showInvalid() { $('#invalidMeldModal')?.classList.add('open'); }
  function hideInvalid() { $('#invalidMeldModal')?.classList.remove('open'); }


  function syncMobileOrientationClass() {
    const mobile = document.body.classList.contains('device-mobile');
    const landscape = mobile && window.matchMedia('(orientation: landscape)').matches;
    document.body.classList.toggle('mobile-landscape', Boolean(landscape));
  }

  function updateFitScale() {
    const app = $('.app');
    const button = $('#fitBtn');
    if (!app || !button) return;
    if (!fitActive) {
      app.style.zoom = '';
      app.classList.remove('fit-active');
      document.body.classList.remove('fit-view');
      button.classList.remove('active');
      button.textContent = '□';
      updateMobileStageScale();
      return;
    }
    app.style.zoom = '1';
    app.classList.add('fit-active');
    document.body.classList.add('fit-view');
    requestAnimationFrame(() => {
      const scaleX = (window.innerWidth - 8) / Math.max(1, app.scrollWidth);
      const scaleY = (window.innerHeight - 8) / Math.max(1, app.scrollHeight);
      app.style.zoom = Math.max(0.55, Math.min(1, scaleX, scaleY)).toFixed(3);
      button.classList.add('active');
      button.textContent = '↙';
      updateMobileStageScale();
    });
  }

  function toggleFit() {
    fitActive = !fitActive;
    updateFitScale();
  }

  function updateMobileStageScale(force = false) {
    const app = $('.app');
    if (!app) return;
    syncMobileOrientationClass();
    const mobileGame = document.body.classList.contains('device-mobile') && document.body.classList.contains('in-game');
    if (!mobileGame) {
      mobileFitKey = '';
      app.style.width = '';
      app.style.maxWidth = '';
      app.style.left = '';
      app.style.position = '';
      if (!fitActive) app.style.transform = '';
      app.style.transformOrigin = '';
      return;
    }

    const footer = $('.legal-footer');
    const footerH = footer?.offsetHeight || 0;
    const availableH = Math.max(320, window.innerHeight - footerH - 8);
    const availableW = Math.max(280, window.innerWidth - 8);
    const landscape = document.body.classList.contains('mobile-landscape');
    const key = `${Math.round(availableW)}x${Math.round(availableH)}:${landscape ? 'L' : 'P'}`;

    // During the match, card/action state updates should not reset the whole
    // stage to scale(1). Recalculate only on first entry or viewport resize.
    if (!force && mobileFitKey === key && app.dataset.mobileFitReady === '1') return;

    app.style.position = 'relative';
    app.style.left = '50%';
    app.style.maxWidth = 'none';
    app.style.transformOrigin = 'top center';

    const currentScaleMatch = app.style.transform.match(/scale\(([^)]+)\)/);
    const currentScale = currentScaleMatch ? Number(currentScaleMatch[1]) || 1 : 1;

    if (landscape) {
      // Landscape uses a desktop-like responsive layout at the viewport width.
      // Do not shrink the entire stage to fit height, which made the game tiny.
      app.style.width = `${Math.round(availableW)}px`;
      app.style.maxWidth = `${Math.round(availableW)}px`;
      app.style.position = 'relative';
      app.style.left = '50%';
      app.style.transformOrigin = 'top center';
      app.style.transform = 'translateX(-50%) scale(1)';
      app.dataset.mobileFitReady = '1';
      mobileFitKey = key;
      return;
    }

    const baseWidth = Number.parseFloat(app.style.width) || availableW;
    const currentNaturalH = Math.max(1, app.scrollHeight);
    let scale = Math.min(1, availableH / currentNaturalH);

    const compensation = 0.72;
    let layoutW = Math.min(availableW / Math.max(scale, 0.01), availableW * (1 + (1 - scale) * compensation));
    if (!Number.isFinite(layoutW) || layoutW <= 0) layoutW = baseWidth;
    app.style.width = `${Math.round(layoutW)}px`;

    // A single frame is enough for width reflow; keep the previous transform
    // while measuring so the user never sees a full-size/black flash.
    requestAnimationFrame(() => {
      const naturalH = Math.max(1, app.scrollHeight);
      const finalScale = Math.min(1, availableH / naturalH, availableW / Math.max(1, layoutW));
      const safeScale = Number.isFinite(finalScale) ? finalScale : currentScale;
      app.style.transform = `translateX(-50%) scale(${safeScale.toFixed(3)})`;
      app.dataset.mobileFitReady = '1';
      mobileFitKey = key;
    });
  }

  function showWinner(name, isMe) {
    const modal = $('#winnerModal');
    if (!modal) return;
    $('#winnerBig').textContent = isMe ? 'VOCÊ VENCEU' : `${name.toUpperCase()} VENCEU`;
    $('#winnerTitle').textContent = 'Partida encerrada';
    $('#winnerText').innerHTML = isMe
      ? 'Você capturou <b>4 fragmentos</b>, completou o pacote de <b>12 bits</b> e venceu.'
      : `<b>${escapeHtml(name)}</b> capturou <b>4 fragmentos</b>, completou o pacote de <b>12 bits</b> e venceu.`;
    modal.classList.add('open');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  const sequence = ['101', '000', '001', '110', '100', '111', '010'];
  function pulseGlitch() {
    const targets = [...$$('.brand-hero'), ...$$('.titleWrap')];
    targets.forEach((el) => {
      el.classList.remove('glitch-pulse');
      void el.offsetWidth;
      el.classList.add('glitch-pulse');
      setTimeout(() => el.classList.remove('glitch-pulse'), 520);
    });
  }

  function pulseBits() {
    pulseGlitch();
    const targets = [...$$('.preBits'), ...($$('#titleBits'))];
    targets.forEach((el) => {
      let index = 0;
      const timer = setInterval(() => {
        if (index < sequence.length) el.textContent = sequence[index++];
        else { clearInterval(timer); el.textContent = '001'; }
      }, 250);
    });
  }

  $$('.openRules').forEach((button) => button.addEventListener('click', openRules));
  $('#rulesBtn')?.addEventListener('click', openRules);
  $('#closeRules')?.addEventListener('click', closeRules);
  $('#rules')?.addEventListener('click', (event) => { if (event.target.id === 'rules') closeRules(); });
  $('#invalidMeldOk')?.addEventListener('click', hideInvalid);
  $('#invalidMeldModal')?.addEventListener('click', (event) => { if (event.target.id === 'invalidMeldModal') hideInvalid(); });
  $('#fitBtn')?.addEventListener('click', toggleFit);
  window.addEventListener('resize', () => { syncMobileOrientationClass(); if (fitActive) updateFitScale(); else { mobileFitKey = ''; updateMobileStageScale(true); } });
  $('#changeDeviceBtn')?.addEventListener('click', () => { location.href = '/device.html'; });
  $('#changeDeviceTopBtn')?.addEventListener('click', () => { location.href = '/device.html'; });

  $('#newBtn')?.addEventListener('click', () => $('#restartModal')?.classList.add('open'));
  $('#restartCancel')?.addEventListener('click', () => $('#restartModal')?.classList.remove('open'));
  $('#restartConfirm')?.addEventListener('click', () => {
    $('#restartModal')?.classList.remove('open');
    window.Online001?.requestRestart?.();
  });
  $('#restartModal')?.addEventListener('click', (event) => { if (event.target.id === 'restartModal') event.currentTarget.classList.remove('open'); });
  $('#winnerClose')?.addEventListener('click', () => $('#winnerModal')?.classList.remove('open'));
  $('#winnerNewGame')?.addEventListener('click', () => {
    $('#winnerModal')?.classList.remove('open');
    window.Online001?.requestRestart?.();
  });
  $('#winnerModal')?.addEventListener('click', (event) => { if (event.target.id === 'winnerModal') event.currentTarget.classList.remove('open'); });

  function defaultHelp() {
    const el = $('#helpText');
    if (el) el.innerHTML = 'Passe o mouse sobre <b>cartas</b>, <b>botões</b>, <b>marcadores</b> e <b>áreas</b> do jogo para ver o que cada item faz.';
  }
  document.addEventListener('mouseover', (event) => {
    const target = event.target.closest?.('[data-help]');
    if (target && $('#helpText')) $('#helpText').innerHTML = target.dataset.help;
  });
  document.addEventListener('mouseout', (event) => {
    const target = event.target.closest?.('[data-help]');
    if (!target) return;
    const related = event.relatedTarget?.closest?.('[data-help]');
    if (related !== target) defaultHelp();
  });
  defaultHelp();

  setInterval(pulseBits, 10000);
  syncMobileOrientationClass();
  window.UI001 = { note, showInvalid, hideInvalid, showWinner, escapeHtml, updateFitScale, updateMobileStageScale, syncMobileOrientationClass };
})();
