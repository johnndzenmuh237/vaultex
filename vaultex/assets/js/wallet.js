/* =========================================================
   WALLET.JS — wallet page interactions
   ========================================================= */

(function () {
  'use strict';

  document.querySelectorAll('[data-network-select]').forEach(select => {
    select.addEventListener('change', () => {
      const out = document.querySelector('[data-network-warning]');
      if (out) {
        out.textContent = `Only send ${select.value} network assets to this address. Sending any other network's tokens may result in permanent loss.`;
      }
    });
  });

  /* QR placeholder generator (pure CSS/canvas pattern, no external lib) */
  document.querySelectorAll('[data-qr]').forEach(canvas => {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const cells = 18;
    const cellSize = size / cells;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink-soft') || '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper') || '#000';
    // deterministic pseudo-random pattern based on the data string, for a believable placeholder
    const seedStr = canvas.dataset.qr || 'wallet';
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed += seedStr.charCodeAt(i);
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        seed = (seed * 9301 + 49297) % 233280;
        if (seed / 233280 > 0.55) ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
      }
    }
  });

})();
