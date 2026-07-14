/* =========================================================
   DASHBOARD.JS — dashboard widgets & interactions
   ========================================================= */

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

  async function initAccountData() {
    const summary = await fetchAccountSummary();

    if (!summary) {
      renderBalanceZero();
      renderAllocationZero();
      renderTransactionsEmpty();
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

    const txBody = document.querySelector('[data-tx-table]');
    if (txBody && Array.isArray(summary.transactions)) {
      txBody.innerHTML = summary.transactions.length
        ? summary.transactions.map(tx => `
          <tr>
            <td>${tx.date}</td>
            <td>${tx.type}</td>
            <td class="mono">${tx.amount} ${tx.asset}</td>
            <td><span class="pill ${tx.status === 'Completed' ? 'pill-up' : 'pill-down'}">${tx.status}</span></td>
          </tr>`).join('')
        : `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">No transactions yet.</td></tr>`;

      renderQuickStats(summary.transactions);
    }
  }

  // Wait for the auth session before fetching anything — matches
  // the pattern used in withdrawal.js / admin-withdrawal.js.
  if (window.auth) {
    auth.onAuthStateChanged((user) => {
      if (user) initAccountData();
      else {
        renderBalanceZero();
        renderAllocationZero();
        renderTransactionsEmpty();
        renderQuickStatsZero();
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
