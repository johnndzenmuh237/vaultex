(function () {
  'use strict';

  /* ---------------------------------------------------------
     EARNINGS PAGE — reads from the FOUR actual data sources
     in the codebase, not an idealized schema:

     1. REAL — Firestore users/{uid}/trades (side=='sell', `pnl`)
        Written by trading.js (Trading Center). Same collection
        dashboard.js's weekly P&L pill reads.

     2. BOTTRADE — localStorage, NOT Firestore, NOT uid-scoped:
        vaultex_balance_usdt / vaultex_bot_state /
        vaultex_bot_log / vaultex_bot_tx
        (written by the AutoTrading / bot-trading.html page)

     3. DEMO STAKING — localStorage, NOT uid-scoped:
        vaultex_demo_staking_balance_usdt /
        vaultex_demo_staking_positions (active) /
        vaultex_demo_staking_history (completed)

     4. DEMO NFT — localStorage, NOT uid-scoped:
        vaultex_demo_nft_owned / vaultex_demo_nft_history

     NOTE: dashboard.js's "VaultexBotTrade" widget listens to a
     Firestore doc (users/{uid}/botDemo/state) that nothing in
     this codebase currently writes — the real bot page uses
     localStorage instead. This page reads the localStorage keys
     the bot page actually writes, so bot figures here will show
     real data even though the dashboard widget won't until that
     mismatch is fixed.

     Real and demo numbers are rendered in clearly separate,
     tagged sections and are never summed into one figure.
  --------------------------------------------------------- */

  const fmtMoney = n => '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtSigned = n => (Number(n) >= 0 ? '+' : '−') + fmtMoney(n);

  function setVal(key, text, color) {
    const el = document.querySelector(`[data-earn-stat="${key}"] [data-val]`);
    if (!el) return;
    el.textContent = text;
    el.style.color = color || '';
  }

  /* ===================== REAL: Firestore trades ===================== */

  function getDb() {
    if (window.db) return window.db;
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      return firebase.firestore();
    }
    return null;
  }

  let _unsubTrades = null;
  let _tradingHistory = []; // [{ts, dateLabel, pair, pnl}]

  function listenTradingEarnings(uid) {
    const db = getDb();
    if (!db || !uid) return;
    if (_unsubTrades) { _unsubTrades(); _unsubTrades = null; }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    _unsubTrades = db.collection('users').doc(uid).collection('trades')
      .where('side', '==', 'sell')
      .onSnapshot(snap => {
        let allTime = 0, week = 0;
        const history = [];

        snap.forEach(doc => {
          const t = doc.data();
          if (typeof t.pnl !== 'number') return;
          const createdAt = t.createdAt && t.createdAt.toDate ? t.createdAt.toDate() : null;
          allTime += t.pnl;
          if (createdAt && createdAt >= sevenDaysAgo) week += t.pnl;
          history.push({
            ts: createdAt ? createdAt.getTime() : 0,
            dateLabel: createdAt ? createdAt.toLocaleString() : '—',
            pair: (t.symbol || t.name || 'Trade').toString().toUpperCase(),
            pnl: t.pnl,
          });
        });

        history.sort((a, b) => a.ts - b.ts);
        const points = [];
        let running = 0;
        history.forEach(h => { running += h.pnl; points.push(running); });

        setVal('all-time', fmtSigned(allTime), allTime >= 0 ? 'var(--mint)' : 'var(--coral)');
        setVal('week', fmtSigned(week), week >= 0 ? 'var(--mint)' : 'var(--coral)');

        const canvas = document.querySelector('[data-chart="trading-pnl"]');
        const emptyMsg = document.querySelector('[data-trading-empty]');
        if (canvas && window.CEPChart) {
          if (points.length) {
            const color = allTime >= 0
              ? (getComputedStyle(document.documentElement).getPropertyValue('--mint').trim() || '#00D9A3')
              : (getComputedStyle(document.documentElement).getPropertyValue('--coral').trim() || '#FF5C72');
            CEPChart.line(canvas, points, { color });
            canvas.style.display = '';
          } else {
            canvas.style.display = 'none';
          }
        }
        if (emptyMsg) emptyMsg.style.display = points.length ? 'none' : '';

        _tradingHistory = history.slice().reverse();
        renderCombinedTable();
      }, err => {
        console.error('Failed to load trading earnings', err);
        setVal('all-time', '$0.00');
        setVal('week', '$0.00');
        _tradingHistory = [];
        renderCombinedTable();
      });
  }

  function stopTradingEarnings() {
    if (_unsubTrades) { _unsubTrades(); _unsubTrades = null; }
    setVal('all-time', '$0.00');
    setVal('week', '$0.00');
    _tradingHistory = [];
    renderCombinedTable();
  }

  /* ===================== REAL: account balance banner ===================== */

  async function fetchAndRenderBalance() {
    const user = window.auth && auth.currentUser;
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/account/summary', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;
      const balanceEl = document.querySelector('.balance-amount');
      if (balanceEl && typeof data.totalBalance === 'number') {
        const [whole, cents] = data.totalBalance.toFixed(2).split('.');
        balanceEl.innerHTML = `$${Number(whole).toLocaleString()}<span class="cents">.${cents}</span>`;
      }
    } catch (e) {
      console.error('Failed to load account balance', e);
    }
  }

  /* ===================== BOTTRADE (localStorage) ===================== */

  const LS_BOT_STATE = 'vaultex_bot_state';
  const LS_BOT_TX = 'vaultex_bot_tx';

  function getBotState() { try { return JSON.parse(localStorage.getItem(LS_BOT_STATE) || 'null'); } catch (e) { return null; } }
  function getBotTx() { try { return JSON.parse(localStorage.getItem(LS_BOT_TX) || '[]'); } catch (e) { return []; } }

  let _botHistory = [];

  function renderBot() {
    const st = getBotState();
    const active = !!(st && st.active);

    setVal('bot-session', fmtSigned(st ? (st.totalEarnings || 0) : 0), (st && st.totalEarnings >= 0) ? 'var(--mint)' : 'var(--coral)');
    setVal('bot-rate', st ? st.dailyRate.toFixed(2) + '%' : '—');
    setVal('bot-status', active ? `Active · ${st.packageName}` : 'Idle');

    const tx = getBotTx();
    _botHistory = tx.map(t => ({
      ts: t.ts,
      dateLabel: t.ts ? new Date(t.ts).toLocaleString() : '—',
      label: `${t.label || 'AutoTrading'}${t.packageName ? ' · ' + t.packageName : ''}`,
      amount: t.amount || 0,
    }));
    renderCombinedTable();
  }

  /* ===================== DEMO: staking (localStorage) ===================== */

  const LS_STAKES = 'vaultex_demo_staking_positions';
  const LS_STAKE_HIST = 'vaultex_demo_staking_history';

  function getStakes() { try { return JSON.parse(localStorage.getItem(LS_STAKES) || '[]'); } catch (e) { return []; } }
  function getStakeHistory() { try { return JSON.parse(localStorage.getItem(LS_STAKE_HIST) || '[]'); } catch (e) { return []; } }

  function computeStakeReward(stake) {
    const elapsedMs = Date.now() - stake.startedAt;
    const years = elapsedMs / (365 * 86400000);
    return stake.amount * (stake.apy / 100) * years; // in units of the staked asset, not USD
  }

  let _stakingHistory = [];

  function renderStaking() {
    const stakes = getStakes();
    const hist = getStakeHistory();

    // NOTE: rewards here are denominated in the staked asset (BTC, ETH,
    // etc.), not USD — this page doesn't have live asset prices loaded
    // (unlike staking.html), so we show counts/asset-denominated rewards
    // rather than fabricate a USD conversion without a live price feed.
    let activeRewardCount = stakes.length;
    let activeRewardLabel = stakes.length
      ? stakes.map(s => `${computeStakeReward(s).toFixed(4)} ${s.symbol.toUpperCase()}`).join(', ')
      : '$0.00';

    setVal('staking-active', stakes.length ? activeRewardLabel : '$0.00', stakes.length ? 'var(--mint)' : '');
    setVal('staking-count', String(stakes.length));

    const totalPaid = hist.reduce((sum, h) => sum + (h.reward || 0), 0);
    const paidLabel = hist.length
      ? hist.map(h => `${h.reward.toFixed(4)} ${h.symbol.toUpperCase()}`).slice(0, 3).join(', ') + (hist.length > 3 ? '…' : '')
      : '$0.00';
    setVal('staking-paid', hist.length ? paidLabel : '$0.00', hist.length ? 'var(--mint)' : '');

    _stakingHistory = hist.map(h => ({
      ts: h.endedAt || 0,
      dateLabel: h.endedAt ? new Date(h.endedAt).toLocaleString() : '—',
      label: `Unstaked ${h.symbol ? h.symbol.toUpperCase() : ''} · ${h.planLabel || ''}`,
      amount: h.reward || 0,
      unit: h.symbol ? h.symbol.toUpperCase() : '',
    }));
    renderCombinedTable();
  }

  /* ===================== DEMO: NFT (localStorage) ===================== */

  const LS_NFT_OWNED = 'vaultex_demo_nft_owned';
  const LS_NFT_HIST = 'vaultex_demo_nft_history';

  function getNftOwned() { try { return JSON.parse(localStorage.getItem(LS_NFT_OWNED) || '[]'); } catch (e) { return []; } }
  function getNftHistory() { try { return JSON.parse(localStorage.getItem(LS_NFT_HIST) || '[]'); } catch (e) { return []; } }

  let _nftHistory = [];

  function renderNft() {
    const owned = getNftOwned();
    const hist = getNftHistory();
    const totalSpend = hist.reduce((sum, h) => sum + (h.priceUsd || 0), 0);

    setVal('nft-owned', String(owned.length));
    setVal('nft-spend', fmtMoney(totalSpend));

    _nftHistory = hist.map(h => ({
      ts: h.ts || 0,
      dateLabel: h.ts ? new Date(h.ts).toLocaleString() : '—',
      label: `Minted ${h.name || 'NFT'} (${h.collection || ''})`,
      amount: -(h.priceUsd || 0), // a purchase, shown as a negative/cost entry
    }));
    renderCombinedTable();
  }

  /* ===================== combined activity table ===================== */

  function renderCombinedTable() {
    const body = document.querySelector('[data-earn-table]');
    if (!body) return;

    const rows = [
      ..._tradingHistory.map(t => ({ ts: t.ts, dateLabel: t.dateLabel, source: 'real', sourceLabel: 'Trading', detail: t.pair, amountLabel: fmtSigned(t.pnl), positive: t.pnl >= 0 })),
      ..._botHistory.map(b => ({ ts: b.ts, dateLabel: b.dateLabel, source: 'bot', sourceLabel: 'BotTrade', detail: b.label, amountLabel: fmtSigned(b.amount), positive: b.amount >= 0 })),
      ..._stakingHistory.map(s => ({ ts: s.ts, dateLabel: s.dateLabel, source: 'demo', sourceLabel: 'Staking', detail: s.label, amountLabel: `+${s.amount.toFixed(4)} ${s.unit}`, positive: true })),
      ..._nftHistory.map(n => ({ ts: n.ts, dateLabel: n.dateLabel, source: 'demo', sourceLabel: 'NFT', detail: n.label, amountLabel: fmtSigned(n.amount), positive: n.amount >= 0 })),
    ].sort((a, b) => b.ts - a.ts).slice(0, 150);

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">No activity yet.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map(r => `
      <tr>
        <td>${r.dateLabel}</td>
        <td><span class="earn-source-tag ${r.source}">${r.source === 'real' ? 'Real · ' + r.sourceLabel : (r.source === 'bot' ? 'BotTrade' : 'Demo · ' + r.sourceLabel)}</span></td>
        <td>${r.detail}</td>
        <td class="mono" style="color:${r.positive ? 'var(--mint)' : 'var(--coral)'}">${r.amountLabel}</td>
      </tr>`).join('');
  }

  /* ===================== local (non-Firestore) refresh loop ===================== */

  function refreshLocalSources() {
    renderBot();
    renderStaking();
    renderNft();
  }

  /* ===================== init ===================== */

  refreshLocalSources();
  setInterval(refreshLocalSources, 3000);
  window.addEventListener('storage', refreshLocalSources);

  if (window.auth) {
    auth.onAuthStateChanged((user) => {
      if (user) {
        listenTradingEarnings(user.uid);
        fetchAndRenderBalance();
      } else {
        stopTradingEarnings();
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshLocalSources();
      if (window.auth && auth.currentUser) fetchAndRenderBalance();
    }
  });

})();
