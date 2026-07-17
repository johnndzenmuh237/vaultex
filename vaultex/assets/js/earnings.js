(function () {
  'use strict';

  /* ---------------------------------------------------------
     EARNINGS PAGE
     ---------------------------------------------------------
     Two independent data sources, never merged into a single
     total:

     1. REAL — users/{uid}/trades (side == 'sell', field `pnl`)
        Same collection trading.html writes to and dashboard.js's
        weekly P&L pill reads from. This is real, withdrawal-
        eligible performance.

     2. DEMO — users/{uid}/botDemo/state (VaultexBotTrade)
        Simulated AutoTrading earnings. Entirely separate from
        real balance/withdrawals — see dashboard.js for the same
        isolation boundary. Every value here is labeled "Demo".

     The history table interleaves both for a single chronological
     view, but each row is tagged with its source and the summary
     cards never combine real + demo figures.
  --------------------------------------------------------- */

  function getDb() {
    if (window.db) return window.db;
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      return firebase.firestore();
    }
    return null;
  }

  const fmtMoney = n => '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtSigned = n => (Number(n) >= 0 ? '+' : '−') + fmtMoney(n);

  function setStat(key, value) {
    const el = document.querySelector(`[data-earn-stat="${key}"] [data-val]`);
    if (!el) return;
    el.textContent = fmtSigned(value);
    el.style.color = value > 0 ? 'var(--mint)' : (value < 0 ? 'var(--coral)' : '');
  }

  let _tradingHistory = []; // [{ts, dateLabel, pair, pnl}]
  let _botHistory = [];     // [{ts, dateLabel, label, amount}]

  function renderHistoryMerged() {
    const body = document.querySelector('[data-earn-table]');
    if (!body) return;

    const rows = [
      ..._tradingHistory.map(t => ({
        ts: t.ts,
        dateLabel: t.dateLabel,
        source: 'real',
        detail: t.pair,
        amount: t.pnl,
      })),
      ..._botHistory.map(b => ({
        ts: b.ts,
        dateLabel: b.dateLabel,
        source: 'demo',
        detail: b.label,
        amount: b.amount,
      })),
    ].sort((a, b) => b.ts - a.ts).slice(0, 100);

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">No earnings yet.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map(r => `
      <tr>
        <td>${r.dateLabel}</td>
        <td><span class="earn-source-tag ${r.source}">${r.source === 'real' ? 'Real' : 'Demo'}</span></td>
        <td>${r.detail}</td>
        <td class="mono" style="color:${r.amount >= 0 ? 'var(--mint)' : 'var(--coral)'}">${fmtSigned(r.amount)}</td>
      </tr>`).join('');
  }

  /* ---- REAL trading P&L ---- */
  let _unsubTrades = null;

  function listenTradingEarnings(uid) {
    const db = getDb();
    if (!db || !uid) return;

    if (_unsubTrades) { _unsubTrades(); _unsubTrades = null; }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    _unsubTrades = db.collection('users').doc(uid).collection('trades')
      .where('side', '==', 'sell')
      .onSnapshot(snap => {
        let allTime = 0;
        let week = 0;
        const history = [];
        const points = [];

        snap.forEach(doc => {
          const t = doc.data();
          if (typeof t.pnl !== 'number') return;
          const createdAt = t.createdAt && t.createdAt.toDate ? t.createdAt.toDate() : null;
          allTime += t.pnl;
          if (createdAt && createdAt >= sevenDaysAgo) week += t.pnl;
          history.push({
            ts: createdAt ? createdAt.getTime() : 0,
            dateLabel: createdAt ? createdAt.toLocaleString() : '—',
            pair: t.pair || t.symbol || 'Trade',
            pnl: t.pnl,
          });
        });

        history.sort((a, b) => a.ts - b.ts);
        let running = 0;
        history.forEach(h => { running += h.pnl; points.push(running); });

        setStat('all-time', allTime);
        setStat('week', week);

        const canvas = document.querySelector('[data-chart="trading-pnl"]');
        const emptyMsg = document.querySelector('[data-trading-empty]');
        if (canvas && window.CEPChart) {
          if (points.length) {
            const color = allTime >= 0 ? (getComputedStyle(document.documentElement).getPropertyValue('--mint').trim() || '#3CDC96') : (getComputedStyle(document.documentElement).getPropertyValue('--coral').trim() || '#E5484D');
            CEPChart.line(canvas, points, { color });
            canvas.style.display = '';
          } else {
            canvas.style.display = 'none';
          }
        }
        if (emptyMsg) emptyMsg.style.display = points.length ? 'none' : '';

        _tradingHistory = history.slice().reverse();
        renderHistoryMerged();
      }, err => {
        console.error('Failed to load trading earnings', err);
        setStat('all-time', 0);
        setStat('week', 0);
        _tradingHistory = [];
        renderHistoryMerged();
      });
  }

  function stopTradingEarnings() {
    if (_unsubTrades) { _unsubTrades(); _unsubTrades = null; }
    setStat('all-time', 0);
    setStat('week', 0);
    _tradingHistory = [];
    renderHistoryMerged();
  }

  /* ---- DEMO bot earnings ---- */
  let _unsubBot = null;

  function listenBotEarnings(uid) {
    const db = getDb();
    if (!db || !uid) return;

    if (_unsubBot) { _unsubBot(); _unsubBot = null; }

    _unsubBot = db.collection('users').doc(uid).collection('botDemo').doc('state')
      .onSnapshot(doc => {
        const state = doc.exists ? doc.data() : null;
        const totalEarnings = (state && typeof state.totalEarnings === 'number') ? state.totalEarnings : 0;
        setStat('bot', totalEarnings);

        const activity = (state && Array.isArray(state.recentEarnings)) ? state.recentEarnings : [];
        const points = [];
        let running = 0;
        activity.slice().reverse().forEach(a => { running += (a.amount || 0); points.push(running); });

        const canvas = document.querySelector('[data-chart="bot-earnings"]');
        const emptyMsg = document.querySelector('[data-bot-empty]');
        if (canvas && window.CEPChart) {
          if (points.length) {
            const gold = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#F0B43C';
            CEPChart.line(canvas, points, { color: gold });
            canvas.style.display = '';
          } else {
            canvas.style.display = 'none';
          }
        }
        if (emptyMsg) emptyMsg.style.display = (state && state.active) ? 'none' : '';

        _botHistory = activity.map(a => ({
          ts: a.ts || 0,
          dateLabel: a.ts ? new Date(a.ts).toLocaleString() : '—',
          label: `${a.pair || a.label || 'AutoTrading'}${a.side ? ' · ' + a.side : ''}`,
          amount: a.amount || 0,
        }));
        renderHistoryMerged();
      }, err => {
        console.error('Failed to load VaultexBotTrade demo earnings', err);
        setStat('bot', 0);
        _botHistory = [];
        renderHistoryMerged();
      });
  }

  function stopBotEarnings() {
    if (_unsubBot) { _unsubBot(); _unsubBot = null; }
    setStat('bot', 0);
    _botHistory = [];
    renderHistoryMerged();
  }

  /* ---- Wire up on auth state, same pattern as dashboard.js ---- */
  if (window.auth) {
    auth.onAuthStateChanged((user) => {
      if (user) {
        listenTradingEarnings(user.uid);
        listenBotEarnings(user.uid);
      } else {
        stopTradingEarnings();
        stopBotEarnings();
      }
    });
  }

})();
