/* =========================================================
   TRADING.JS — Vaultex Trading Center
   ---------------------------------------------------------
   Live market data: CoinGecko public API (no key required).
   Persistence: Firebase Firestore (compat SDK), matching the
   rest of the Vaultex dashboard.

   Firestore shape used:
     users/{uid}                          -> { balance: number, ... }
     users/{uid}/holdings/{coinId}        -> {
       coinId, symbol, name, image,
       quantity, avgEntryPrice, updatedAt
     }
     users/{uid}/trades/{tradeId}         -> {
       coinId, symbol, name, image,
       side: 'buy' | 'sell',
       quantity, price, amountUSD,
       pnl, pnlPercent,   // only present on 'sell' entries
       createdAt
     }

   This is a real spot-trading model: Buy increases your
   holding in an asset (and its cost-basis-weighted average
   entry price); Sell reduces it and realizes P/L against
   that average entry price. You can only sell what you hold
   — there's no margin or shorting here.

   IMPORTANT — production note:
   Balance/holdings writes happen client-side in a Firestore
   transaction, same pattern as the rest of this app.
   Firestore security rules MUST restrict writes to a user's
   own balance/holdings/trades. For a fully tamper-proof
   system, move buy/sell into a Cloud Function later — this
   client-side version is fine to ship now and easy to swap.
   ========================================================= */

(function () {
  'use strict';

  const COINGECKO_MARKETS =
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h&sparkline=false';

  const PRICE_REFRESH_MS = 15000;   // refresh market list / holdings valuation
  const MARKET_REFRESH_MS = 30000;  // refresh full market list
  const CHART_REFRESH_MS = 45000;   // refresh candles

  const state = {
    uid: null,
    db: null,
    balance: 0,
    markets: [],            // full market list from CoinGecko
    marketQuery: '',
    marketTab: 'All',
    selected: null,         // currently selected coin object
    side: 'buy',            // order ticket mode: 'buy' | 'sell'
    timeframe: '1',         // CoinGecko OHLC "days" param
    holdings: {},           // coinId -> { quantity, avgEntryPrice, ... }
    chart: null,
    series: null,
    linking: false,         // re-entrancy guard for qty<->USD field sync
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
    els.statHigh = document.querySelector('[data-stat-high]');
    els.statLow = document.querySelector('[data-stat-low]');
    els.statVolume = document.querySelector('[data-stat-volume]');
    els.statMcap = document.querySelector('[data-stat-mcap]');
    els.tfTabs = document.querySelector('[data-tf-tabs]');
    els.chartContainer = document.querySelector('[data-chart-container]');
    els.sideTabs = document.querySelector('[data-side-tabs]');
    els.tradeQty = document.querySelector('[data-trade-qty]');
    els.tradeAmount = document.querySelector('[data-trade-amount]');
    els.qtyLabel = document.querySelector('[data-qty-label]');
    els.usdLabel = document.querySelector('[data-usd-label]');
    els.submitBtn = document.querySelector('[data-submit-btn]');
    els.availLine = document.querySelector('[data-avail-line]');
    els.ticketMsg = document.querySelector('[data-ticket-msg]');
    els.holdingsTable = document.querySelector('[data-holdings-table]');
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
  function fmtCompact(n) {
    if (n == null) return '—';
    return '$' + Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
  }
  function fmtQty(n) {
    if (n == null || isNaN(n)) return '0';
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
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

  function currentPriceFor(coinId) {
    const c = state.markets.find(m => m.id === coinId);
    return c ? c.current_price : null;
  }

  // ---------- market list ----------
  async function loadMarkets() {
    try {
      const res = await fetch(COINGECKO_MARKETS);
      if (!res.ok) throw new Error('Market feed error: ' + res.status);
      state.markets = await res.json();
      renderMarketList();

      if (!state.selected && state.markets.length) {
        selectCoin(state.markets[0]);
      } else if (state.selected) {
        const fresh = state.markets.find(c => c.id === state.selected.id);
        if (fresh) {
          state.selected = fresh;
          updateSelectedHeader();
          updateAvailLine();
        }
      }
      if (Object.keys(state.holdings).length) renderHoldings();
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
    renderMarketList();
    clearTicketFields();
    updateAvailLine();
    loadChart(coin.id, state.timeframe);
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

    if (els.statHigh) els.statHigh.textContent = fmtPrice(c.high_24h);
    if (els.statLow) els.statLow.textContent = fmtPrice(c.low_24h);
    if (els.statVolume) els.statVolume.textContent = fmtCompact(c.total_volume);
    if (els.statMcap) els.statMcap.textContent = fmtCompact(c.market_cap);
  }

  async function loadChart(coinId, days) {
    if (!els.chartContainer || !window.LightweightCharts) return;

    if (!state.chart) {
      els.chartContainer.innerHTML = '';
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
    }

    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`);
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
  function clearTicketFields() {
    if (els.tradeQty) els.tradeQty.value = '';
    if (els.tradeAmount) els.tradeAmount.value = '';
    setTicketMsg('', '');
  }

  function setSide(side) {
    state.side = side;
    if (els.sideTabs) {
      els.sideTabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.side === side));
    }
    if (els.submitBtn) {
      els.submitBtn.classList.remove('buy', 'sell');
      els.submitBtn.classList.add(side);
      els.submitBtn.textContent = side === 'buy' ? 'Buy at market' : 'Sell at market';
    }
    if (els.qtyLabel) els.qtyLabel.textContent = side === 'buy' ? 'Lot size (units to buy)' : 'Lot size (units to sell)';
    if (els.usdLabel) els.usdLabel.textContent = side === 'buy' ? 'Amount (USD)' : 'Estimated proceeds (USD)';
    clearTicketFields();
    updateAvailLine();
  }

  function updateAvailLine() {
    if (!els.availLine || !state.selected) return;
    if (state.side === 'buy') {
      els.availLine.textContent = `Available balance: ${fmtUSD(state.balance)}`;
    } else {
      const held = state.holdings[state.selected.id];
      const qty = held ? held.quantity : 0;
      els.availLine.textContent = `Available to sell: ${fmtQty(qty)} ${state.selected.symbol.toUpperCase()}`;
    }
  }

  function syncFromQty() {
    if (state.linking || !state.selected) return;
    state.linking = true;
    const qty = parseFloat(els.tradeQty.value) || 0;
    const price = state.selected.current_price || 0;
    els.tradeAmount.value = qty && price ? (qty * price).toFixed(2) : '';
    state.linking = false;
  }

  function syncFromUsd() {
    if (state.linking || !state.selected) return;
    state.linking = true;
    const amount = parseFloat(els.tradeAmount.value) || 0;
    const price = state.selected.current_price || 0;
    els.tradeQty.value = amount && price ? (amount / price).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') : '';
    state.linking = false;
  }

  function setTicketMsg(text, kind) {
    if (!els.ticketMsg) return;
    els.ticketMsg.textContent = text || '';
    els.ticketMsg.className = 'ticket-msg' + (kind ? ' ' + kind : '');
  }

  async function submitOrder() {
    if (!state.uid || !state.selected) return;
    const qty = parseFloat(els.tradeQty.value);

    if (!qty || qty <= 0) {
      setTicketMsg('Enter a valid lot size.', 'err');
      return;
    }

    if (state.side === 'buy') {
      await placeBuy(qty);
    } else {
      await placeSell(qty);
    }
  }

  async function placeBuy(qty) {
    const coin = state.selected;
    const amountUSD = qty * coin.current_price;

    if (amountUSD > state.balance) {
      setTicketMsg('Amount exceeds your available balance.', 'err');
      return;
    }

    els.submitBtn.disabled = true;
    setTicketMsg('Placing order…', '');

    const userRef = state.db.collection('users').doc(state.uid);
    const holdingRef = userRef.collection('holdings').doc(coin.id);
    const tradeRef = userRef.collection('trades').doc();

    try {
      await state.db.runTransaction(async (tx) => {
        const [userSnap, holdingSnap] = await Promise.all([tx.get(userRef), tx.get(holdingRef)]);
        const currentBalance = (userSnap.exists && userSnap.data().balance) || 0;
        if (amountUSD > currentBalance) throw new Error('insufficient-balance');

        const prevQty = holdingSnap.exists ? holdingSnap.data().quantity : 0;
        const prevAvg = holdingSnap.exists ? holdingSnap.data().avgEntryPrice : 0;
        const newQty = prevQty + qty;
        const newAvg = newQty > 0 ? ((prevQty * prevAvg) + (qty * coin.current_price)) / newQty : coin.current_price;

        tx.update(userRef, { balance: firebase.firestore.FieldValue.increment(-amountUSD) });
        tx.set(holdingRef, {
          coinId: coin.id, symbol: coin.symbol, name: coin.name, image: coin.image,
          quantity: newQty, avgEntryPrice: newAvg,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(tradeRef, {
          coinId: coin.id, symbol: coin.symbol, name: coin.name, image: coin.image,
          side: 'buy', quantity: qty, price: coin.current_price, amountUSD,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      setTicketMsg(`Bought ${fmtQty(qty)} ${coin.symbol.toUpperCase()} at ${fmtPrice(coin.current_price)}.`, 'ok');
      clearTicketFields();
    } catch (err) {
      console.error('Trading Center: buy failed', err);
      setTicketMsg(err.message === 'insufficient-balance' ? 'Amount exceeds your available balance.' : 'Could not place order. Please try again.', 'err');
    } finally {
      els.submitBtn.disabled = false;
    }
  }

  async function placeSell(qty) {
    const coin = state.selected;
    const held = state.holdings[coin.id];
    const heldQty = held ? held.quantity : 0;

    if (qty > heldQty + 1e-9) {
      setTicketMsg(`You only hold ${fmtQty(heldQty)} ${coin.symbol.toUpperCase()}.`, 'err');
      return;
    }

    els.submitBtn.disabled = true;
    setTicketMsg('Placing order…', '');

    const userRef = state.db.collection('users').doc(state.uid);
    const holdingRef = userRef.collection('holdings').doc(coin.id);
    const tradeRef = userRef.collection('trades').doc();

    try {
      await state.db.runTransaction(async (tx) => {
        const holdingSnap = await tx.get(holdingRef);
        if (!holdingSnap.exists) throw new Error('no-holding');
        const data = holdingSnap.data();
        if (qty > data.quantity + 1e-9) throw new Error('insufficient-holding');

        const proceeds = qty * coin.current_price;
        const pnl = (coin.current_price - data.avgEntryPrice) * qty;
        const pnlPercent = data.avgEntryPrice > 0 ? ((coin.current_price - data.avgEntryPrice) / data.avgEntryPrice) * 100 : 0;
        const remainingQty = data.quantity - qty;

        tx.update(userRef, { balance: firebase.firestore.FieldValue.increment(proceeds) });
        if (remainingQty <= 1e-9) {
          tx.delete(holdingRef);
        } else {
          tx.update(holdingRef, { quantity: remainingQty, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        tx.set(tradeRef, {
          coinId: coin.id, symbol: coin.symbol, name: coin.name, image: coin.image,
          side: 'sell', quantity: qty, price: coin.current_price, amountUSD: proceeds,
          pnl, pnlPercent,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      setTicketMsg(`Sold ${fmtQty(qty)} ${coin.symbol.toUpperCase()} at ${fmtPrice(coin.current_price)}.`, 'ok');
      clearTicketFields();
    } catch (err) {
      console.error('Trading Center: sell failed', err);
      const msg = err.message === 'insufficient-holding' || err.message === 'no-holding'
        ? `You only hold ${fmtQty(heldQty)} ${coin.symbol.toUpperCase()}.`
        : 'Could not place order. Please try again.';
      setTicketMsg(msg, 'err');
    } finally {
      els.submitBtn.disabled = false;
    }
  }

  // ---------- holdings ----------
  function listenHoldings() {
    if (!state.uid) return;
    state.db.collection('users').doc(state.uid).collection('holdings')
      .onSnapshot(snap => {
        state.holdings = {};
        snap.forEach(d => { state.holdings[d.id] = d.data(); });
        renderHoldings();
        updateAvailLine();
      }, err => console.error('Trading Center: holdings listener error', err));
  }

  function renderHoldings() {
    if (!els.holdingsTable) return;
    const ids = Object.keys(state.holdings);
    if (!ids.length) {
      els.holdingsTable.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">You don't hold any assets yet — place a buy order to get started.</td></tr>`;
      return;
    }
    els.holdingsTable.innerHTML = ids.map(coinId => {
      const h = state.holdings[coinId];
      const price = currentPriceFor(coinId) ?? h.avgEntryPrice;
      const marketValue = price * h.quantity;
      const pnl = marketValue - (h.avgEntryPrice * h.quantity);
      const pnlClass = pnl >= 0 ? 'pnl-up' : 'pnl-down';
      return `
        <tr>
          <td>
            <div class="flex" style="gap:8px;align-items:center;">
              <img src="${h.image}" width="20" height="20" style="border-radius:50%;" alt="${h.symbol}">
              <span style="text-transform:uppercase;font-size:.85rem;">${h.symbol}</span>
            </div>
          </td>
          <td>${fmtQty(h.quantity)}</td>
          <td>${fmtPrice(h.avgEntryPrice)}</td>
          <td>${fmtPrice(price)}</td>
          <td>${fmtUSD(marketValue)}</td>
          <td class="${pnlClass}">${pnl >= 0 ? '+' : ''}${fmtUSD(pnl)}</td>
          <td><button class="btn btn-ghost btn-sm" data-sell-holding="${coinId}">Sell</button></td>
        </tr>`;
    }).join('');

    els.holdingsTable.querySelectorAll('[data-sell-holding]').forEach(btn => {
      btn.addEventListener('click', () => {
        const coinId = btn.dataset.sellHolding;
        const coin = state.markets.find(c => c.id === coinId);
        if (coin) selectCoin(coin);
        setSide('sell');
        const held = state.holdings[coinId];
        if (held && els.tradeQty) {
          els.tradeQty.value = held.quantity;
          syncFromQty();
        }
      });
    });
  }

  // ---------- trade history ----------
  function listenTradeHistory() {
    if (!state.uid) return;
    state.db.collection('users').doc(state.uid).collection('trades')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .onSnapshot(snap => {
        renderTradeHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, err => console.error('Trading Center: history listener error', err));
  }

  function renderTradeHistory(trades) {
    if (!els.historyTable) return;
    if (!trades.length) {
      els.historyTable.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">No trades yet.</td></tr>`;
      return;
    }
    els.historyTable.innerHTML = trades.map(t => {
      const pnlCell = t.side === 'sell'
        ? `<span class="${(t.pnl ?? 0) >= 0 ? 'pnl-up' : 'pnl-down'}">${(t.pnl ?? 0) >= 0 ? '+' : ''}${fmtUSD(t.pnl)} (${fmtPct(t.pnlPercent)})</span>`
        : '—';
      return `
        <tr>
          <td>${fmtDate(t.createdAt)}</td>
          <td style="text-transform:uppercase;">${t.symbol}</td>
          <td><span class="side-badge ${t.side}">${t.side}</span></td>
          <td>${fmtQty(t.quantity)}</td>
          <td>${fmtPrice(t.price)}</td>
          <td>${fmtUSD(t.amountUSD)}</td>
          <td>${pnlCell}</td>
        </tr>`;
    }).join('');
  }

  // ---------- balance ----------
  function listenBalance() {
    if (!state.uid) return;
    state.db.collection('users').doc(state.uid).onSnapshot(doc => {
      state.balance = (doc.exists && doc.data().balance) || 0;
      if (els.balanceChip) els.balanceChip.textContent = fmtUSD(state.balance);
      updateAvailLine();
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
    if (els.tfTabs) {
      els.tfTabs.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          els.tfTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.timeframe = btn.dataset.tf;
          if (state.selected) loadChart(state.selected.id, state.timeframe);
        });
      });
    }
    if (els.sideTabs) {
      els.sideTabs.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => setSide(btn.dataset.side));
      });
    }
    if (els.tradeQty) els.tradeQty.addEventListener('input', () => { syncFromQty(); setTicketMsg('', ''); });
    if (els.tradeAmount) els.tradeAmount.addEventListener('input', () => { syncFromUsd(); setTicketMsg('', ''); });
    if (els.submitBtn) els.submitBtn.addEventListener('click', submitOrder);
    wireBotWaitlist();
  }

  function init() {
    cacheEls();
    wireStaticControls();
    setSide('buy');

    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
      console.error('Trading Center: Firebase is not initialized (check firebase-init.js load order).');
      return;
    }

    state.db = firebase.firestore();

    firebase.auth().onAuthStateChanged(user => {
      if (!user) return; // auth-guard.js handles the redirect
      state.uid = user.uid;
      listenBalance();
      listenHoldings();
      listenTradeHistory();
    });

    loadMarkets();
    setInterval(loadMarkets, MARKET_REFRESH_MS);
    setInterval(() => { if (Object.keys(state.holdings).length) renderHoldings(); }, PRICE_REFRESH_MS);
    setInterval(() => { if (state.selected) loadChart(state.selected.id, state.timeframe); }, CHART_REFRESH_MS);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
