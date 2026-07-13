/* =========================================================
   TRADING.JS — exchange terminal interactions
   ========================================================= */

(function () {
  'use strict';

  /* ---- Render main candlestick chart ---- */
  const mainChart = document.querySelector('[data-chart="candles"]');
  if (mainChart && window.CEPChart) {
    CEPChart.candles(mainChart, CEPChart.randomCandles(48, 67000, 900));
  }

  /* ---- Timeframe switcher re-renders chart with new mock data ---- */
  document.querySelectorAll('.timeframe-row button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.timeframe-row button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (mainChart && window.CEPChart) {
        CEPChart.candles(mainChart, CEPChart.randomCandles(48, 67000, 900));
      }
    });
  });

  /* ---- Buy / Sell side toggle ---- */
  document.querySelectorAll('.side-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      row.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const submit = row.closest('.order-form')?.querySelector('[data-submit-order]');
      if (submit) {
        const isBuy = btn.classList.contains('buy');
        submit.textContent = isBuy ? 'Buy BTC' : 'Sell BTC';
        submit.className = 'btn btn-block ' + (isBuy ? 'btn-primary' : '');
        submit.style.background = isBuy ? '' : 'var(--coral)';
        submit.style.color = isBuy ? '' : '#fff';
      }
    });
  });

  /* ---- Mock order book ---- */
  const book = document.querySelector('[data-order-book]');
  if (book) {
    const base = 67230;
    const asks = Array.from({ length: 8 }, (_, i) => ({
      price: (base + (8 - i) * 4.2).toFixed(2),
      amount: (Math.random() * 0.8).toFixed(4)
    }));
    const bids = Array.from({ length: 8 }, (_, i) => ({
      price: (base - (i + 1) * 4.2).toFixed(2),
      amount: (Math.random() * 0.8).toFixed(4)
    }));
    book.innerHTML =
      asks.map(r => `<div class="row ask"><span>${r.price}</span><span>${r.amount}</span><span>${(r.price * r.amount).toFixed(2)}</span></div>`).join('') +
      `<div class="row" style="border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:8px 0;color:var(--mint);font-weight:700;">
        <span>${base.toLocaleString()}</span><span></span><span></span></div>` +
      bids.map(r => `<div class="row bid"><span>${r.price}</span><span>${r.amount}</span><span>${(r.price * r.amount).toFixed(2)}</span></div>`).join('');
  }

  /* ---- Pair search filter ---- */
  const pairSearch = document.querySelector('[data-pair-search]');
  if (pairSearch) {
    pairSearch.addEventListener('input', () => {
      const q = pairSearch.value.toLowerCase();
      document.querySelectorAll('.pair-row').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  /* ---- Bottom panel tabs (Open Orders / History / Positions) ---- */
  document.querySelectorAll('.bottom-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bottom-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

})();
