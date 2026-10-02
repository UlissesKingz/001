(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  let fitActive = false;
  let mobileFitKey = '';
  let mobileViewport = null;
  let mobileResizeTimer = null;

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
    const mobileGame = document.body.classList.contains('device-mobile') && document.body.classList.contains('in-game');
    if (!mobileGame) {
      mobileFitKey = '';
      mobileViewport = null;
      document.body.classList.remove('mobile-landscape');
      app.dataset.mobileFitReady = '';
      app.style.width = '';
      app.style.maxWidth = '';
      app.style.left = '';
      app.style.top = '';
      app.style.position = '';
      if (!fitActive) app.style.transform = '';
      app.style.transformOrigin = '';
      return;
    }

    const footer = $('.legal-footer');
    const footerH = footer?.offsetHeight || 0;
    const measuredW = Math.max(280, window.innerWidth - 8);
    const measuredH = Math.max(320, window.innerHeight - footerH - 8);

    // Keep the viewport reference stable while the browser's address/navigation
    // bars appear or disappear. Height-only changes from browser chrome must not
    // rescale the board between game actions.
    if (!mobileViewport || force) mobileViewport = { w: measuredW, h: measuredH };
    const widthChanged = Math.abs(measuredW - mobileViewport.w) > 36;
    if (widthChanged) mobileViewport = { w: measuredW, h: measuredH };

    const availableW = mobileViewport.w;
    const availableH = mobileViewport.h;
    const landscape = availableW > availableH;
    document.body.classList.toggle('mobile-landscape', landscape);
    const key = `${landscape ? 'L' : 'P'}:${Math.round(availableW)}x${Math.round(availableH)}`;
    if (!force && !widthChanged && mobileFitKey === key && app.dataset.mobileFitReady === '1') return;

    app.style.position = 'fixed';
    app.style.top = '2px';
    app.style.left = '50%';
    app.style.maxWidth = 'none';
    app.style.transformOrigin = 'top center';

    const currentScaleMatch = app.style.transform.match(/scale\(([^)]+)\)/);
    const currentScale = currentScaleMatch ? Number(currentScaleMatch[1]) || 1 : 1;

    let layoutW;
    if (landscape) {
      // Use a desktop-like canvas in phone landscape, then scale the complete
      // composition to the available screen. This keeps the desktop hierarchy
      // instead of stretching the portrait layout.
      layoutW = 1180;
    } else {
      const naturalBefore = Math.max(1, app.scrollHeight);
      const initialScale = Math.min(1, availableH / naturalBefore);
      const compensation = 0.72;
      layoutW = Math.min(
        availableW / Math.max(initialScale, 0.01),
        availableW * (1 + (1 - initialScale) * compensation)
      );
      if (!Number.isFinite(layoutW) || layoutW <= 0) layoutW = availableW;
    }

    // Width, measurement and transform are applied synchronously in the same
    // task so there is no unscaled intermediate frame between game actions.
    app.style.width = `${Math.round(layoutW)}px`;
    const naturalH = Math.max(1, app.scrollHeight);
    const finalScale = Math.min(1, availableH / naturalH, availableW / Math.max(1, layoutW));
    const safeScale = Number.isFinite(finalScale) ? finalScale : currentScale;
    app.style.transform = `translateX(-50%) scale(${safeScale.toFixed(3)})`;
    app.dataset.mobileFitReady = '1';
    mobileFitKey = key;
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
  function pulseBits() {
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
  window.addEventListener('resize', () => {
    clearTimeout(mobileResizeTimer);
    mobileResizeTimer = setTimeout(() => {
      if (fitActive) updateFitScale();
      else updateMobileStageScale(false);
    }, 180);
  });
  $('#changeDeviceBtn')?.addEventListener('click', () => { location.href = '/device.html'; });

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
  window.UI001 = { note, showInvalid, hideInvalid, showWinner, escapeHtml, updateFitScale, updateMobileStageScale };
})();
