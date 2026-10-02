(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  let fitActive = false;

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
    });
  }

  function toggleFit() {
    fitActive = !fitActive;
    updateFitScale();
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
  window.addEventListener('resize', () => { if (fitActive) updateFitScale(); });
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
  window.UI001 = { note, showInvalid, hideInvalid, showWinner, escapeHtml, updateFitScale };
})();
