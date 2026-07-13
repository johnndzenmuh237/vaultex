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

  /* ---- Sidebar toggle on mobile ---- */
  const sidebarToggle = document.querySelector('[data-sidebar-toggle]');
  const sidebar = document.querySelector('.dash-sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('open') &&
          !sidebar.contains(e.target) && e.target !== sidebarToggle) {
        sidebar.classList.remove('open');
      }
    });
  }

  /* ---------------------------------------------------------
     ACCOUNT BALANCE / ALLOCATION / TRANSACTIONS
     ---------------------------------------------------------
     IMPORTANT: This data must come from your real backend
     once Coinbase Custody + exchange order routing are
     connected (e.g. a server endpoint or Cloud Function that
     holds Custody API credentials — never call Custody APIs
     directly from the browser). Until that endpoint exists,
     show an honest "not connected yet" state rather than
     fabricated numbers, since real users may be looking at
     this before custody is live.

     Wire it up by replacing fetchAccountSummary() below with
     a real call, e.g.:
       const res = await fetch('/api/account/summary', { credentials: 'same-origin' });
       return res.ok ? res.json() : null;
  --------------------------------------------------------- */

  async function fetchAccountSummary() {
    // Placeholder: no backend wired yet. Returns null to signal
    // "not available" rather than inventing a balance.
    return null;
  }

  function renderBalancePending() {
    const balanceEl = document.querySelector('.balance-amount');
    if (balanceEl) {
      balanceEl.innerHTML = `<span style="font-size:.55em;color:var(--muted);">Connecting to your account…</span>`;
    }
    document.querySelectorAll('.pill-up, .pill-down').forEach(el => {
      if (el.closest('.balance-card')) el.style.display = 'none';
    });
  }

  function renderAllocationPending() {
    const widget = document.querySelector('[data-chart="allocation"]')?.closest('.widget');
    if (widget) {
      const body = widget.querySelector('.flex');
      if (body) body.innerHTML = `<p style="color:var(--muted);font-size:.85rem;">Allocation data will appear once your account is linked to custody.</p>`;
    }
  }

  function renderTransactionsPending() {
    const txBody = document.querySelector('[data-tx-table]');
    if (!txBody) return;
    txBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">No transactions to show yet.</td></tr>`;
  }

  function renderQuickStatsPending() {
    document.querySelectorAll('.quick-stat strong').forEach(el => { el.textContent = '—'; });
  }

  (async function initAccountData() {
    const summary = await fetchAccountSummary();

    if (!summary) {
      renderBalancePending();
      renderAllocationPending();
      renderTransactionsPending();
      renderQuickStatsPending();
      return;
    }

    // Real-data rendering path — fill in once fetchAccountSummary()
    // returns actual figures from your backend.
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
    }
  })();

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
