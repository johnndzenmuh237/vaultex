(function () {
  'use strict';

  /* ---- Render sidebar nav (single source of truth) ---- */
  const NAV_ITEMS = [
    { href: 'dashboard.html',       icon: '⌂', label: 'Overview' },
    { href: 'assets.html',          icon: '◇', label: 'Assets' },
    { href: 'markets.html',          icon: '☰', label: 'Markets' },
    { href: 'trading.html',         icon: '⇄', label: 'Trading' },
    { href: 'staking.html',         icon: '◎', label: 'Staking' },
    { href: 'nft-marketplace.html', icon: '◆', label: 'NFT Marketplace' },
    { href: 'transactions.html',    icon: '⇵', label: 'Transactions' },
    { href: 'deposits.html',        icon: '⬇', label: 'Deposits' },
    { href: 'withdrawals.html',     icon: '⬆', label: 'Withdrawals' },
    { href: 'trading-history.html', icon: '⌗', label: 'Trading history' },
    { href: 'earnings.html',        icon: '⚡', label: 'Earnings' },
  ];

  const ACCOUNT_ITEMS = [
    { href: 'profile.html',        icon: '◉', label: 'Profile' },
    { href: 'security.html',       icon: '⛉', label: 'Security' },
    { href: 'notifications.html',  icon: '⚑', label: 'Notifications' },
    { href: 'api-management.html', icon: '⌬', label: 'API keys' },
    { href: 'settings.html',       icon: '⚙', label: 'Settings' },
  ];

  function renderSidebar() {
    const navEl = document.querySelector('.dash-nav');
    if (!navEl) return;

    const currentPage = location.pathname.split('/').pop() || 'dashboard.html';

    const renderLink = (item) => `
      <a href="${item.href}" class="${item.href === currentPage ? 'active' : ''}">
        ${item.icon} <span class="label">${item.label}</span>
      </a>`;

    navEl.innerHTML =
      NAV_ITEMS.map(renderLink).join('') +
      `<div class="group-label">Account</div>` +
      ACCOUNT_ITEMS.map(renderLink).join('');
  }

  renderSidebar();

  /* ---------------------------------------------------------
     SIDEBAR / MOBILE DRAWER
  --------------------------------------------------------- */
  const sidebarToggle = document.querySelector('[data-sidebar-toggle]');
  const sidebar = document.querySelector('.dash-sidebar');

  if (sidebarToggle && sidebar) {
    let backdrop = document.querySelector('.dash-sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'dash-sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    function openSidebar() {
      sidebar.classList.add('open');
      backdrop.classList.add('open');
      document.body.classList.add('sidebar-open');
      sidebarToggle.setAttribute('aria-expanded', 'true');
    }

    function closeSidebar() {
      sidebar.classList.remove('open');
      backdrop.classList.remove('open');
      document.body.classList.remove('sidebar-open');
      sidebarToggle.setAttribute('aria-expanded', 'false');
    }

    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });

    backdrop.addEventListener('click', closeSidebar);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
    });

    sidebar.addEventListener('click', (e) => {
      if (e.target.closest('a')) closeSidebar();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768 && sidebar.classList.contains('open')) {
        closeSidebar();
      }
    });
  }

  /* ---------------------------------------------------------
     ACCOUNT BALANCE / ALLOCATION / TRANSACTIONS
     ---------------------------------------------------------
     Pulls real data from the backend (functions/withdrawals.js
     -> GET /api/account/summary), so an admin-approved
     withdrawal is reflected here as soon as the page loads or
     initAccountData() re-runs. Falls back to the honest
     zero-state below only if there's no session yet or the
     request fails — never invents numbers.
  --------------------------------------------------------- */

  async function fetchAccountSummary() {
    const user = auth.currentUser;
    if (!user) return null;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/account/summary", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.success ? data : null;
    } catch (e) {
      console.error("Failed to load account summary", e);
      return null;
    }
  }

  function renderBalanceZero() {
    const balanceEl = document.querySelector('.balance-amount');
    if (balanceEl) {
      balanceEl.innerHTML = `$0<span class="cents">.00</span>`;
    }
    document.querySelectorAll('.balance-card .pill').forEach(el => {
      el.textContent = '— 0.0% this week';
      el.classList.remove('pill-up', 'pill-down');
      el.classList.add('pill-neutral');
      el.style.display = '';
    });
    if (window.CEPChart) {
      const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#8993AB';
      document.querySelectorAll('[data-chart="balance"]').forEach(canvas => {
        CEPChart.line(canvas, [0, 0, 0, 0, 0, 0, 0], { color: muted });
      });
    }
  }

  function renderAllocationZero() {
    const widget = document.querySelector('[data-chart="allocation"]')?.closest('.widget');
    if (!widget) return;
    const canvas = widget.querySelector('[data-chart="allocation"]');
    const list = widget.querySelector('ul');
    const line = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#262E45';
    if (canvas && window.CEPChart) {
      CEPChart.donut(canvas, [{ label: 'No assets', value: 1, color: line }]);
    }
    if (list) {
      list.innerHTML = `<li style="color:var(--muted);">No assets yet — make a deposit to get started.</li>`;
    }
  }

  function renderTransactionsEmpty() {
    const txBody = document.querySelector('[data-tx-table]');
    if (!txBody) return;
    txBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">No transactions yet — your activity will show up here.</td></tr>`;
  }

  function renderQuickStatsZero() {
    document.querySelectorAll('.quick-stat strong').forEach(el => { el.textContent = '$0'; });
  }

  function renderQuickStats(transactions) {
    const withdrawn30d = transactions
      .filter(tx => tx.type === 'Withdrawal' && tx.status === 'Completed')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

    const stats = document.querySelectorAll('.quick-stat strong');
    // Third quick-stat card is "Withdrawn (30d)" per dashboard.html markup.
    if (stats[2]) stats[2].textContent = `$${withdrawn30d.toLocaleString()}`;
  }

  /* ---------------------------------------------------------
     RECENT TRANSACTIONS — merges real backend transactions with
     VaultexBotTrade  earnings (see below) into one table,
     each row clearly tagged so it's never mistaken for a
     real, withdrawal-eligible transaction.
  --------------------------------------------------------- */
  let _lastRealTx = [];   // from fetchAccountSummary()
  let _lastBotTx = [];    // from the isolated botTrade Firestore doc

  function renderTransactionsMerged() {
    const txBody = document.querySelector('[data-tx-table]');
    if (!txBody) return;

    const rows = [
      ..._lastRealTx.map(tx => ({
        dateLabel: tx.date,
        type: tx.type,
        amount: `${tx.amount} ${tx.asset}`,
        status: tx.status,
        statusPill: tx.status === 'Completed' ? 'pill-up' : 'pill-down',
        ts: tx._ts || 0,
      })),
      ..._lastBotTx.map(tx => ({
        dateLabel: new Date(tx.ts).toLocaleString(),
        type: `${tx.label} · Demo`,
        amount: `${tx.amount >= 0 ? '+' : '−'}$${Math.abs(tx.amount).toFixed(2)} USDT`,
        status: 'Simulated',
        statusPill: 'pill-neutral',
        ts: tx.ts,
      })),
    ].sort((a, b) => b.ts - a.ts).slice(0, 15);

    txBody.innerHTML = rows.length
      ? rows.map(r => `
          <tr>
            <td>${r.dateLabel}</td>
            <td>${r.type}</td>
            <td class="mono">${r.amount}</td>
            <td><span class="pill ${r.statusPill}">${r.status}</span></td>
          </tr>`).join('')
      : `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">No transactions yet — your activity will show up here.</td></tr>`;
  }

  /* ---------------------------------------------------------
     WEEKLY TRADING P&L PILL
     ---------------------------------------------------------
     The balance-card pill above only ever showed the hardcoded
     "— 0.0% this week" zero-state — it was never wired to real
     data. Trading Center (trading.html) writes closed trades to
     users/{uid}/trades in Firestore with a `pnl` field, so we
     listen to that directly here (same data source trading.html
     reads/writes) and turn it into a live "this week" figure.

     This runs independently of fetchAccountSummary()/the
     /api/account/summary backend call above — it only touches
     the pill, never the balance figure itself, so it can't get
     out of sync with whatever the backend reports as totalBalance.
  --------------------------------------------------------- */

  let _unsubWeeklyPnl = null;

  function getDb() {
    if (window.db) return window.db;
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      return firebase.firestore();
    }
    return null;
  }

  function renderPillNeutral() {
    document.querySelectorAll('.balance-card .pill').forEach(el => {
      el.textContent = '— $0.00 this week';
      el.classList.remove('pill-up', 'pill-down');
      el.classList.add('pill-neutral');
    });
  }

  function renderPillPnl(weeklyPnl) {
    document.querySelectorAll('.balance-card .pill').forEach(el => {
      if (!weeklyPnl) {
        el.textContent = '— $0.00 this week';
        el.classList.remove('pill-up', 'pill-down');
        el.classList.add('pill-neutral');
        return;
      }
      const up = weeklyPnl > 0;
      el.textContent = `${up ? '+' : '-'}$${Math.abs(weeklyPnl).toFixed(2)} this week`;
      el.classList.remove('pill-neutral', up ? 'pill-down' : 'pill-up');
      el.classList.add(up ? 'pill-up' : 'pill-down');
    });
  }

  function listenWeeklyTradingPnl(uid) {
    const db = getDb();
    if (!db || !uid) return;

    if (_unsubWeeklyPnl) {
      _unsubWeeklyPnl();
      _unsubWeeklyPnl = null;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    _unsubWeeklyPnl = db.collection('users').doc(uid).collection('trades')
      .where('side', '==', 'sell')
      .onSnapshot(snap => {
        let weeklyPnl = 0;
        snap.forEach(doc => {
          const t = doc.data();
          const createdAt = t.createdAt && t.createdAt.toDate ? t.createdAt.toDate() : null;
          if (createdAt && createdAt >= sevenDaysAgo && typeof t.pnl === 'number') {
            weeklyPnl += t.pnl;
          }
        });
        renderPillPnl(weeklyPnl);
      }, err => {
        console.error('Failed to load weekly trading P&L', err);
        renderPillNeutral();
      });
  }

  function stopWeeklyTradingPnl() {
    if (_unsubWeeklyPnl) {
      _unsubWeeklyPnl();
      _unsubWeeklyPnl = null;
    }
    renderPillNeutral();
  }

  /* ---------------------------------------------------------
     VAULTEXBOTTRADE (DEMO AUTOTRADING BOT) — OVERVIEW WIDGET
     ---------------------------------------------------------
     Read-only here by design: activation, deactivation and the
     live trade-tick engine live on trading.html (where the
     packages/UI are). This file only listens to
     users/{uid}/botDemo/state and renders it.

     IMPORTANT — isolation boundary: this path is entirely
     separate from users/{uid}/trades (real Trading Center data,
     feeds the weekly P&L pill above) and from
     /api/account/summary (real totalBalance / withdrawals). The
     bot never reads or writes either of those. Every value shown
     here is explicitly labeled "Demo" / "Simulated" so it can
     never be mistaken for real, withdrawal-eligible funds — this
     boundary should stay in place even if Vaultex later goes
     live with real custody.
  --------------------------------------------------------- */

  let _unsubBotDemo = null;

  function renderBotWidgetEmpty() {
    const el = document.querySelector('[data-bot-widget]');
    if (!el) return;
    el.innerHTML = `
      <div class="widget-head"><h3>VaultexBotTrade <span class="demo-chip">Demo</span></h3><span class="pill pill-neutral">Inactive</span></div>
      <p style="color:var(--muted);font-size:.85rem;margin:6px 0 14px;">No AutoTrading package active yet. Add demo balance and activate a package on the Trading page to start.</p>
      <a href="trading.html" class="btn btn-primary btn-sm">Go to AutoTrading</a>
    `;
  }

  function renderBotWidgetState(state) {
    const el = document.querySelector('[data-bot-widget]');
    if (!el) return;

    if (!state || !state.active) {
      renderBotWidgetEmpty();
      return;
    }

    const fmtMoney = n => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtSigned = n => (n >= 0 ? '+' : '−') + fmtMoney(n);
    const startedAt = state.startedAt && state.startedAt.toDate ? state.startedAt.toDate() : new Date(state.startedAt || Date.now());
    const runningMs = Date.now() - startedAt.getTime();
    const hrs = Math.floor(runningMs / 3600000);
    const mins = Math.floor((runningMs % 3600000) / 60000);
    const activity = Array.isArray(state.recentActivity) ? state.recentActivity.slice(0, 3) : [];

    el.innerHTML = `
      <div class="widget-head"><h3>VaultexBotTrade <span class="demo-chip">Demo</span></h3><span class="pill pill-up">Active · ${state.packageName}</span></div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;margin:6px 0 14px;">
        <div><div style="font-family:var(--font-mono);font-size:1.3rem;color:var(--mint);font-weight:700;">${fmtSigned(state.totalEarnings || 0)}</div><div style="font-size:.68rem;color:var(--muted);">Simulated session earnings</div></div>
        <div><div style="font-family:var(--font-mono);font-size:1.3rem;">${(state.dailyRate || 0).toFixed(2)}%</div><div style="font-size:.68rem;color:var(--muted);">Target daily rate</div></div>
        <div><div style="font-family:var(--font-mono);font-size:1.3rem;">${hrs}h ${mins}m</div><div style="font-size:.68rem;color:var(--muted);">Running for</div></div>
      </div>
      ${activity.length ? `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">${activity.map(a => `
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:.72rem;color:var(--muted);">
          <span>${a.pair}${a.side ? ' · ' + a.side : ''}</span><span style="color:${a.pnl >= 0 ? 'var(--mint)' : 'var(--coral)'}">${fmtSigned(a.pnl)}</span>
        </div>`).join('')}</div>` : ''}
      <p style="color:var(--muted);font-size:.68rem;margin-bottom:10px;">Simulated demo balance only — separate from your real account balance above, no real funds involved.</p>
      <a href="trading.html" class="btn btn-ghost btn-sm">Manage bot</a>
    `;
  }

  function listenBotDemo(uid) {
    const db = getDb();
    if (!db || !uid) { renderBotWidgetEmpty(); return; }

    if (_unsubBotDemo) {
      _unsubBotDemo();
      _unsubBotDemo = null;
    }

    _unsubBotDemo = db.collection('users').doc(uid).collection('botDemo').doc('state')
      .onSnapshot(doc => {
        const state = doc.exists ? doc.data() : null;
        renderBotWidgetState(state);
        _lastBotTx = (state && Array.isArray(state.recentEarnings)) ? state.recentEarnings : [];
        renderTransactionsMerged();
      }, err => {
        console.error('Failed to load VaultexBotTrade demo state', err);
        renderBotWidgetEmpty();
        _lastBotTx = [];
        renderTransactionsMerged();
      });
  }

  function stopBotDemo() {
    if (_unsubBotDemo) {
      _unsubBotDemo();
      _unsubBotDemo = null;
    }
    _lastBotTx = [];
    renderBotWidgetEmpty();
  }

  async function initAccountData() {
    const summary = await fetchAccountSummary();

    if (!summary) {
      renderBalanceZero();
      renderAllocationZero();
      _lastRealTx = [];
      renderTransactionsMerged();
      renderQuickStatsZero();
      return;
    }

    const balanceEl = document.querySelector('.balance-amount');
    if (balanceEl && typeof summary.totalBalance === 'number') {
      const [whole, cents] = summary.totalBalance.toFixed(2).split('.');
      balanceEl.innerHTML = `$${Number(whole).toLocaleString()}<span class="cents">.${cents}</span>`;
    }

    if (window.CEPChart && summary.balanceHistory) {
      document.querySelectorAll('[data-chart="balance"]').forEach(canvas => {
        CEPChart.line(canvas, summary.balanceHistory);
      });
    }

    if (window.CEPChart && summary.allocation) {
      document.querySelectorAll('[data-chart="allocation"]').forEach(canvas => {
        CEPChart.donut(canvas, summary.allocation);
      });
    }

    if (Array.isArray(summary.transactions)) {
      _lastRealTx = summary.transactions.map(tx => ({ ...tx, _ts: tx.ts || Date.parse(tx.date) || 0 }));
      renderTransactionsMerged();
      renderQuickStats(summary.transactions);
    }
  }

  // Wait for the auth session before fetching anything — matches
  // the pattern used in withdrawal.js / admin-withdrawal.js.
  if (window.auth) {
    auth.onAuthStateChanged((user) => {
      if (user) {
        initAccountData();
        listenWeeklyTradingPnl(user.uid);
        listenBotDemo(user.uid);
      } else {
        renderBalanceZero();
        renderAllocationZero();
        _lastRealTx = [];
        renderTransactionsMerged();
        renderQuickStatsZero();
        stopWeeklyTradingPnl();
        stopBotDemo();
      }
    });
  }

  /* ---- Tab switching (generic, used across widgets) ---- */
  document.querySelectorAll('.tab-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      row.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  /* ---- Security toggles ---- */
  document.querySelectorAll('.toggle').forEach(t => {
    t.addEventListener('click', () => t.classList.toggle('on'));
  });

  /* ---- Copy-to-clipboard for wallet addresses / API keys ---- */
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy;
      navigator.clipboard?.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = original), 1500);
      });
    });
  });

})();
