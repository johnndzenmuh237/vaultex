/* =========================================================
   PORTFOLIO.JS — Assets page.
   Lists supported coins with LIVE prices + real logos from
   CoinGecko (same feed already used in market.html).
   No holding balances are fabricated — amount/value are 0
   until a real deposit exists on the backend. Wire this to a
   real per-user balances collection (written only by your
   backend, once custody is connected) to show real holdings.
   ========================================================= */

(function () {
  'use strict';

  const SUPPORTED_IDS = [
    'bitcoin', 'ethereum', 'tether', 'solana',
    'binancecoin', 'ripple', 'cardano', 'dogecoin'
  ];

  const body = document.querySelector('[data-holdings-table]');
  const totalEl = document.querySelector('[data-portfolio-total]');
  if (!body) return;

  function fmtPrice(n) {
    if (n == null) return '—';
    return n >= 1
      ? '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '$' + n.toFixed(4);
  }

  function fmtPct(n) {
    if (n == null) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(2)}%`;
  }

  function render(coins) {
    body.innerHTML = coins.map(c => {
      const pct = c.price_change_percentage_24h;
      const pctClass = pct == null ? '' : pct >= 0 ? 'delta-up' : 'delta-down';

      return `
        <tr>
          <td>
            <div class="coin-cell" style="gap:10px;align-items:center;">
              <img src="${c.image}" alt="${c.symbol}" width="28" height="28" style="border-radius:50%;" loading="lazy">
              <div><strong>${c.name}</strong><div style="font-size:.78rem;color:var(--muted);text-transform:uppercase;">${c.symbol}</div></div>
            </div>
          </td>
          <td class="mono">0.00 ${c.symbol.toUpperCase()}</td>
          <td class="mono">${fmtPrice(c.current_price)}</td>
          <td class="mono ${pctClass}">${fmtPct(pct)}</td>
          <td class="mono">$0.00</td>
        </tr>`;
    }).join('');

    if (totalEl) totalEl.textContent = '$0.00';
  }

  function renderFallback() {
    // Feed unavailable — show letter-badge placeholders instead of broken images.
    const NAMES = { bitcoin:'Bitcoin', ethereum:'Ethereum', tether:'Tether', solana:'Solana', binancecoin:'BNB', ripple:'XRP', cardano:'Cardano', dogecoin:'Dogecoin' };
    const SYMS  = { bitcoin:'BTC', ethereum:'ETH', tether:'USDT', solana:'SOL', binancecoin:'BNB', ripple:'XRP', cardano:'ADA', dogecoin:'DOGE' };
    body.innerHTML = SUPPORTED_IDS.map(id => `
      <tr>
        <td><div class="coin-cell"><div class="coin-icon">${SYMS[id]}</div><div><strong>${NAMES[id]}</strong></div></div></td>
        <td class="mono">0.00 ${SYMS[id]}</td>
        <td class="mono">—</td>
        <td class="mono">—</td>
        <td class="mono">$0.00</td>
      </tr>`).join('');
    if (totalEl) totalEl.textContent = '$0.00';
  }

  async function loadPrices() {
    try {
      const ids = SUPPORTED_IDS.join(',');
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`
      );
      if (!res.ok) throw new Error('price feed error');
      const data = await res.json();
      // Preserve our chosen display order regardless of API response order.
      const byId = Object.fromEntries(data.map(c => [c.id, c]));
      const ordered = SUPPORTED_IDS.map(id => byId[id]).filter(Boolean);
      render(ordered);
    } catch (err) {
      renderFallback();
    }
  }

  loadPrices();
  setInterval(loadPrices, 30000);

})();
