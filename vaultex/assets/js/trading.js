/* =========================================================
   TRADING.JS — Vaultex Trading Center
   ---------------------------------------------------------
   Live market data: CoinGecko public API (no key required).
   Persistence: Firebase Firestore (compat SDK), matching the
   rest of the Vaultex dashboard.

   Firestore shape used:
     users/{uid}                       -> { balance: number, ... }
     users/{uid}/trades/{tradeId}      -> {
       coinId, symbol, name, image,
       side: 'buy',
       amountUSD, entryPrice, quantity,
       status: 'open' | 'closed',
       openedAt, closedAt, closePrice, pnl, pnlPercent
     }

   IMPORTANT — production note:
   Balance debits/credits happen client-side via a Firestore
   transaction here, same pattern as the rest of this app.
   Firestore security rules MUST restrict writes to a user's
   own balance/trades. For a fully tamper-proof system, move
   the buy/close logic into a Cloud Function later — this
   client-side version is fine to ship now and easy to swap.
   ========================================================= */

(function () {
  'use strict';

  const COINGECKO_MARKETS =
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h&sparkline=false';

  const PRICE_REFRESH_MS = 15000;   // refresh selected price / open positions
  const MARKET_REFRESH_MS = 30000;  // refresh full market list
  const CHART_REFRESH_MS = 45000;   // refresh candles

  const state = {
    uid: null,
    db: null,
    balance: 0,
    markets: [],           // full market list from CoinGecko
    marketQuery: '',
    marketTab: 'All',
    selected: null,        // currently selected coin object
    chart: null,
    series: null,
    unsubTrades: null,
  };

  // ---------- DOM refs ----------
  const els = {};
  function cacheEls() {
    els.balanceChip = document.querySelector('[data-available-balance]');
    els.marketSearch = document.querySelector('[data-market-search]');
    els.marketTabs = document.querySelector('[data-market-tabs]');
    els.marketRows = document.querySelector('[data-market-rows]');
    els.saImage = document.querySelector('[data-sa-image]');
    els.saName = document.querySelector('[data-sa-name]');
    els.saSym = document.querySelector('[data-sa-sym]');
    els.saPrice = document.querySelector('[data-sa-price]');
    els.saPct = document.querySelector('[data-sa-pct]');
    els.chartContainer = document.querySelector('[data-chart-container]');
    els.tradeAmount = document.querySelector('[data-trade-amount]');
    els.estQty = document.querySelector('[data-est-qty]');
    els.buyBtn = document.querySelector('[data-buy-btn]');
    els.ticketMsg = document.querySelector('[data-ticket-msg]');
    els.positionsTable = document.querySelector('[data-positions-table]');
    els.historyTable = document.querySelector('[data-history-table]');
    els.botWaitlistBtn = document.querySelector('[data-bot-waitlist-btn]');
    els.botWaitlistMsg = document.querySelector('[data-bot-waitlist-msg]');
  }

  // ---------- formatting helpers ----------
  function fmtUSD(n) {
    if (n == null || isNaN(n)) return '$0.00';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPrice(n) {
    if (n == null) return '—';
    if (n >= 1) return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 0.01) return '$' + n.toFixed(4);
    return '$' + n.toPrecision(3);
  }
  function fmtPct(n) {
    if (n == null || isNaN(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(2)}%`;
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- market list ----------
  async function loadMarkets() {
    try {
      const res = await fetch(COINGECKO_MARKETS);
      if (!res.ok) throw new Error('Market feed error: ' + res.status);
      state.markets = await res.json();
      renderMarketList();

      // default selection: first load only
      if (!state.selected && state.markets.length) {
        selectCoin(state.markets[0]);
      } else if (state.selected) {
        // keep selected asset's live price/pct in sync with refreshed list
        const fresh = state.markets.find(c => c.id === state.selected.id);
        if (fresh) {
          state.selected = fresh;
          updateSelectedHeader();
        }
      }
    } catch (err) {
      console.error('Trading Center: failed to load markets', err);
      if (!state.markets.length && els.marketRows) {
        els.marketRows.innerHTML = `<div class="market-empty">Live market feed temporarily unavailable. Retrying…</div>`;
      }
    }
  }

  function getFilteredMarkets() {
    let rows = state.markets;
    if (state.marketTab === 'Gainers') {
      rows = rows.filter(c => (c.price_change_percentage_24h ?? 0) > 0)
        .sort((a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0));
    } else if (state.marketTab === 'Losers') {
      rows = rows.filter(c => (c.price_change_percentage_24h ?? 0) < 0)
        .sort((a, b) => (a.price_change_percentage_24h ?? 0) - (b.price_change_percentage_24h ?? 0));
    }
    if (state.marketQuery) {
      const q = state.marketQuery.toLowerCase();
      rows = rows.filter(c => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
    }
    return rows;
  }

  function renderMarketList() {
    if (!els.marketRows) return;
    const rows = getFilteredMarkets();
    if (!rows.length) {
      els.marketRows.innerHTML = `<div class="market-empty">No assets match your search.</div>`;
      return;
    }
    els.marketRows.innerHTML = rows.map(c => {
      const pct = c.price_change_percentage_24h;
      const pctClass = pct == null ? '' : pct >= 0 ? 'text-up' : 'text-down';
      const isActive = state.selected && state.selected.id === c.id;
      return `
        <div class="market-row${isActive ? ' active' : ''}" data-coin-id="${c.id}">
          <img src="${c.image}" alt="${c.symbol}" width="26" height="26" loading="lazy">
          <div>
            <div class="m-name">${c.name}</div>
            <div class="m-sym">${c.symbol}</div>
          </div>
          <div class="m-right">
            <div class="m-price">${fmtPrice(c.current_price)}</div>
            <div class="m-pct ${pctClass}">${fmtPct(pct)}</div>
          </div>
        </div>`;
    }).join('');

    els.marketRows.querySelectorAll('.market-row').forEach(row => {
      row.addEventListener('click', () => {
        const coin = state.markets.find(c => c.id === row.dataset.coinId);
        if (coin) selectCoin(coin);
      });
    });
  }

  // ---------- selected asset / chart ----------
  function selectCoin(coin) {
    state.selected = coin;
    updateSelectedHeader();
    renderMarketList(); // re-render to move the "active" highlight
    updateEstQty();
    loadChart(coin.id);
  }

  function updateSelectedHeader() {
    const c = state.selected;
    if (!c || !els.saName) return;
    els.saImage.src = c.image;
    els.saImage.style.display = 'inline-block';
    els.saName.textContent = c.name;
    els.saSym.textContent = c.symbol;
    els.saPrice.textContent = fmtPrice(c.current_price);
    const pct = c.price_change_percentage_24h;
    els.saPct.textContent = fmtPct(pct);
    els.saPct.style.background = pct >= 0 ? 'rgba(22,199,132,.14)' : 'rgba(234,57,67,.14)';
    els.saPct.style.color = pct >= 0 ? '#16c784' : '#ea3943';
  }

  async function loadChart(coinId) {
    if (!els.chartContainer || !window.LightweightCharts) return;
    els.chartContainer.innerHTML = '';

    if (!state.chart) {
      const styles = getComputedStyle(document.documentElement);
      state.chart = LightweightCharts.createChart(els.chartContainer, {
        layout: {
          background: { color: 'transparent' },
          textColor: styles.getPropertyValue('--muted').trim() || '#8993AB',
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,.04)' },
          horzLines: { color: 'rgba(255,255,255,.04)' },
        },
        timeScale: { timeVisible: true, secondsVisible: false },
        width: els.chartContainer.clientWidth,
        height: 380,
      });
      state.series = state.chart.addCandlestickSeries({
        upColor: '#16c784', downColor: '#ea3943',
        borderVisible: false,
        wickUpColor: '#16c784', wickDownColor: '#ea3943',
      });
      window.addEventListener('resize', () => {
        if (state.chart && els.chartContainer) {
          state.chart.applyOptions({ width: els.chartContainer.clientWidth });
        }
      });
    } else {
      els.chartContainer.appendChild(state.chart.chartElement ? state.chart.chartElement() : els.chartContainer);
    }

    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=1`);
      if (!res.ok) throw new Error('OHLC feed error: ' + res.status);
      const raw = await res.json();
      const candles = raw
        .map(([t, o, h, l, c]) => ({ time: Math.floor(t / 1000), open: o, high: h, low: l, close: c }))
        .sort((a, b) => a.time - b.time);
      state.series.setData(candles);
      state.chart.timeScale().fitContent();
    } catch (err) {
      console.error('Trading Center: failed to load chart', err);
    }
  }

  // ---------- order ticket ----------
  function updateEstQty() {
    if (!els.estQty || !state.selected) return;
    const amount = parseFloat(els.tradeAmount.value) || 0;
    const price = state.selected.current_price || 0;
    const qty = price > 0 ? amount / price : 0;
    els.estQty.textContent = `≈ ${qty.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${state.selected.symbol.toUpperCase()} at ${fmtPrice(price)}`;
  }

  function setTicketMsg(text, kind) {
    if (!els.ticketMsg) return;
    els.ticketMsg.textContent = text || '';
    els.ticketMsg.className = 'ticket-msg' + (kind ? ' ' + kind : '');
  }

  async function placeBuy() {
    if (!state.uid || !state.selected) return;
    const amount = parseFloat(els.tradeAmount.value);

    if (!amount || amount <= 0) {
      setTicketMsg('Enter a valid amount to trade.', 'err');
      return;
    }
    if (amount > state.balance) {
      setTicketMsg('Amount exceeds your available balance.', 'err');
      return;
    }

    els.buyBtn.disabled = true;
    setTicketMsg('Placing trade…', '');

    const coin = state.selected;
    const userRef = state.db.collection('users').doc(state.uid);
    const tradeRef = userRef.collection('trades').doc();

    try {
      await state.db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const currentBalance = (userSnap.exists && userSnap.data().balance) || 0;
        if (amount > currentBalance) {
          throw new Error('insufficient-balance');
        }
        tx.update(userRef, { balance: firebase.firestore.FieldValue.increment(-amount) });
        tx.set(tradeRef, {
          coinId: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          image: coin.image,
          side: 'buy',
          amountUSD: amount,
          entryPrice: coin.current_price,
          quantity: amount / coin.current_price,
          status: 'open',
          openedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      setTicketMsg(`Trade placed — bought ${coin.symbol.toUpperCase()} at ${fmtPrice(coin.current_price)}.`, 'ok');
      els.tradeAmount.value = '';
      updateEstQty();
    } catch (err) {
      console.error('Trading Center: buy failed', err);
      setTicketMsg(
        err.message === 'insufficient-balance'
          ? 'Amount exceeds your available balance.'
          : 'Could not place trade. Please try again.',
        'err'
      );
    } finally {
      els.buyBtn.disabled = false;
    }
  }

  // ---------- open positions ----------
  function listenOpenPositions() {
    if (!state.uid) return;
    state.db.collection('users').doc(state.uid).collection('trades')
      .where('status', '==', 'open')
      .onSnapshot(snap => {
        state.openPositions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderOpenPositions();
      }, err => console.error('Trading Center: positions listener error', err));
  }

  function currentPriceFor(coinId) {
    const c = state.markets.find(m => m.id === coinId);
    return c ? c.current_price : null;
  }

  function renderOpenPositions() {
    if (!els.positionsTable) return;
    const positions = state.openPositions || [];
    if (!positions.length) {
      els.positionsTable.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">No open positions — place a trade to get started.</td></tr>`;
      return;
    }
    els.positionsTable.innerHTML = positions.map(p => {
      const price = currentPriceFor(p.coinId) ?? p.entryPrice;
      const currentValue = price * p.quantity;
      const pnl = currentValue - p.amountUSD;
      const pnlClass = pnl >= 0 ? 'pnl-up' : 'pnl-down';
      return `
        <tr>
          <td>
            <div class="flex" style="gap:8px;align-items:center;">
              <img src="${p.image}" width="20" height="20" style="border-radius:50%;" alt="${p.symbol}">
              <span style="text-transform:uppercase;font-size:.85rem;">${p.symbol}</span>
            </div>
          </td>
          <td>${fmtDate(p.openedAt)}</td>
          <td>${fmtUSD(p.amountUSD)}</td>
          <td>${fmtPrice(p.entryPrice)}</td>
          <td>${fmtPrice(price)}</td>
          <td class="${pnlClass}">${pnl >= 0 ? '+' : ''}${fmtUSD(pnl)}</td>
          <td><button class="btn btn-ghost btn-sm" data-close-trade="${p.id}">Close</button></td>
        </tr>`;
    }).join('');

    els.positionsTable.querySelectorAll('[data-close-trade]').forEach(btn => {
      btn.addEventListener('click', () => closePosition(btn.dataset.closeTrade));
    });
  }

  async function closePosition(tradeId) {
    if (!state.uid) return;
    const userRef = state.db.collection('users').doc(state.uid);
    const tradeRef = userRef.collection('trades').doc(tradeId);

    try {
      await state.db.runTransaction(async (tx) => {
        const tradeSnap = await tx.get(tradeRef);
        if (!tradeSnap.exists || tradeSnap.data().status !== 'open') {
          throw new Error('not-open');
        }
        const trade = tradeSnap.data();
        const price = currentPriceFor(trade.coinId) ?? trade.entryPrice;
        const closeValue = price * trade.quantity;
        const pnl = closeValue - trade.amountUSD;
        const pnlPercent = trade.amountUSD > 0 ? (pnl / trade.amountUSD) * 100 : 0;

        tx.update(userRef, { balance: firebase.firestore.FieldValue.increment(closeValue) });
        tx.update(tradeRef, {
          status: 'closed',
          closedAt: firebase.firestore.FieldValue.serverTimestamp(),
          closePrice: price,
          pnl,
          pnlPercent,
        });
      });
    } catch (err) {
      console.error('Trading Center: close position failed', err);
    }
  }

  // ---------- trade history ----------
  function listenTradeHistory() {
    if (!state.uid) return;
    state.db.collection('users').doc(state.uid).collection('trades')
      .where('status', '==', 'closed')
      .orderBy('closedAt', 'desc')
      .limit(50)
      .onSnapshot(snap => {
        renderTradeHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, err => console.error('Trading Center: history listener error', err));
  }

  function renderTradeHistory(trades) {
    if (!els.historyTable) return;
    if (!trades.length) {
      els.historyTable.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">No closed trades yet.</td></tr>`;
      return;
    }
    els.historyTable.innerHTML = trades.map(t => {
      const pnlClass = (t.pnl ?? 0) >= 0 ? 'pnl-up' : 'pnl-down';
      return `
        <tr>
          <td>${fmtDate(t.closedAt)}</td>
          <td style="text-transform:uppercase;">${t.symbol}</td>
          <td>Spot buy</td>
          <td>${fmtUSD(t.amountUSD)}</td>
          <td class="${pnlClass}">${(t.pnl ?? 0) >= 0 ? '+' : ''}${fmtUSD(t.pnl)} (${fmtPct(t.pnlPercent)})</td>
          <td><span class="pill pill-up">Completed</span></td>
        </tr>`;
    }).join('');
  }

  // ---------- balance ----------
  function listenBalance() {
    if (!state.uid) return;
    state.db.collection('users').doc(state.uid).onSnapshot(doc => {
      state.balance = (doc.exists && doc.data().balance) || 0;
      if (els.balanceChip) els.balanceChip.textContent = fmtUSD(state.balance);
    }, err => console.error('Trading Center: balance listener error', err));
  }

  // ---------- VaultexBot waitlist ----------
  function wireBotWaitlist() {
    if (!els.botWaitlistBtn) return;
    els.botWaitlistBtn.addEventListener('click', async () => {
      if (!state.uid) return;
      els.botWaitlistBtn.disabled = true;
      try {
        await state.db.collection('users').doc(state.uid).set({
          botInterested: true,
          botInterestedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        els.botWaitlistBtn.textContent = "You're on the list ✓";
        if (els.botWaitlistMsg) els.botWaitlistMsg.textContent = "We'll reach out as VaultexBot access opens up.";
      } catch (err) {
        console.error('Trading Center: bot waitlist failed', err);
        els.botWaitlistBtn.disabled = false;
        if (els.botWaitlistMsg) {
          els.botWaitlistMsg.className = 'ticket-msg err';
          els.botWaitlistMsg.textContent = 'Something went wrong — please try again.';
        }
      }
    });
  }

  // ---------- wiring ----------
  function wireStaticControls() {
    if (els.marketSearch) {
      els.marketSearch.addEventListener('input', e => {
        state.marketQuery = e.target.value.trim();
        renderMarketList();
      });
    }
    if (els.marketTabs) {
      els.marketTabs.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          els.marketTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.marketTab = btn.dataset.tab;
          renderMarketList();
        });
      });
    }
    if (els.tradeAmount) {
      els.tradeAmount.addEventListener('input', () => { updateEstQty(); setTicketMsg('', ''); });
    }
    if (els.buyBtn) {
      els.buyBtn.addEventListener('click', placeBuy);
    }
    wireBotWaitlist();
  }

  function init() {
    cacheEls();
    wireStaticControls();

    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
      console.error('Trading Center: Firebase is not initialized (check firebase-init.js load order).');
      return;
    }

    state.db = firebase.firestore();

    firebase.auth().onAuthStateChanged(user => {
      if (!user) return; // auth-guard.js handles the redirect
      state.uid = user.uid;
      listenBalance();
      listenOpenPositions();
      listenTradeHistory();
    });

    loadMarkets();
    setInterval(loadMarkets, MARKET_REFRESH_MS);
    setInterval(() => { if (state.openPositions && state.openPositions.length) renderOpenPositions(); }, PRICE_REFRESH_MS);
    setInterval(() => { if (state.selected) loadChart(state.selected.id); }, CHART_REFRESH_MS);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
