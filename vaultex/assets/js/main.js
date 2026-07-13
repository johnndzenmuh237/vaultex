/* =========================================================
   MAIN.JS — global site behaviour
   ========================================================= */

(function () {
  'use strict';

  /* ---- Mobile menu ---- */
  const burger = document.querySelector('.nav-burger');
  const mobileMenu = document.querySelector('.mobile-menu');
  if (burger && mobileMenu) {
    burger.addEventListener('click', () => mobileMenu.classList.toggle('open'));
    mobileMenu.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => mobileMenu.classList.remove('open'))
    );
  }

  /* ---- Theme toggle (dark / light), persisted ---- */
  const root = document.documentElement;
  const themeBtn = document.querySelector('.theme-toggle');
  const savedTheme = localStorage.getItem('cep-theme');
  if (savedTheme) root.setAttribute('data-theme', savedTheme);

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = current === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      localStorage.setItem('cep-theme', next);
      themeBtn.textContent = next === 'light' ? '☀' : '☾';
    });
    themeBtn.textContent = root.getAttribute('data-theme') === 'light' ? '☀' : '☾';
  }

  /* ---- Animated stat counters (IntersectionObserver) ---- */
  const counters = document.querySelectorAll('[data-counter]');
  if (counters.length && 'IntersectionObserver' in window) {
    const animateCounter = (el) => {
      const target = parseFloat(el.dataset.counter);
      const suffix = el.dataset.suffix || '';
      const duration = 1200;
      const start = performance.now();
      function tick(now) {
        const progress = Math.min((now - start) / duration, 1);
        const value = target * (1 - Math.pow(1 - progress, 3)); // ease-out
        el.textContent = (target % 1 === 0 ? Math.floor(value) : value.toFixed(1)) + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    };
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(c => obs.observe(c));
  }

  /* ---- Live market ticker strip (top of page) ----
     Pulls real prices from /api/prices (server-side proxy to
     CoinGecko). Falls back to the mock list below only if the
     request fails, so the page never breaks on a network hiccup. */
  const tickerTrack = document.querySelector('.ticker-track');
  const FALLBACK_PAIRS = [
    ['BTC/USDT', 67230.12, 2.31], ['ETH/USDT', 3489.55, 1.12], ['SOL/USDT', 178.40, -0.84],
    ['BNB/USDT', 612.30, 0.45], ['XRP/USDT', 0.612, -1.20], ['ADA/USDT', 0.452, 3.02],
    ['DOGE/USDT', 0.158, 4.55], ['AVAX/USDT', 39.21, -2.10], ['DOT/USDT', 6.88, 0.92],
    ['LINK/USDT', 14.62, 1.78]
  ];
  const COINGECKO_ID_TO_SYMBOL = {
    bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB',
    ripple: 'XRP', cardano: 'ADA', dogecoin: 'DOGE', 'avalanche-2': 'AVAX',
    polkadot: 'DOT', chainlink: 'LINK'
  };

  function renderTickerRows(pairs) {
    if (!tickerTrack) return;
    const rowsHtml = pairs.map(([sym, price, chg]) => {
      const cls = chg >= 0 ? 'up' : 'down';
      const arrow = chg >= 0 ? '▲' : '▼';
      const priceStr = price < 1 ? price.toFixed(3) : price.toLocaleString(undefined, { maximumFractionDigits: 2 });
      return `<span class="item">${sym} <strong>$${priceStr}</strong> <span class="${cls}">${arrow} ${Math.abs(chg).toFixed(2)}%</span></span>`;
    }).join('');
    tickerTrack.innerHTML = rowsHtml + rowsHtml; // duplicate for seamless scroll

    const heroTickerRows = document.querySelector('.ticker-rows');
    if (heroTickerRows) {
      heroTickerRows.innerHTML = pairs.slice(0, 4).map(([sym, price, chg]) => {
        const cls = chg >= 0 ? 'up' : 'down';
        const arrow = chg >= 0 ? '▲' : '▼';
        const priceStr = price < 1 ? price.toFixed(3) : price.toLocaleString(undefined, { maximumFractionDigits: 2 });
        return `<div class="ticker-row"><span>${sym}</span><span>$${priceStr}</span><span class="${cls}">${arrow} ${Math.abs(chg).toFixed(2)}%</span></div>`;
      }).join('');
    }
  }

  async function loadLivePrices() {
    try {
      const res = await fetch('/api/prices');
      if (!res.ok) throw new Error('Price feed unavailable');
      const { prices } = await res.json();
      const pairs = Object.entries(prices).map(([id, info]) => [
        `${COINGECKO_ID_TO_SYMBOL[id] || id.toUpperCase()}/USDT`,
        info.usd,
        info.usd_24h_change || 0
      ]);
      if (pairs.length) renderTickerRows(pairs);
      else renderTickerRows(FALLBACK_PAIRS);
    } catch (err) {
      renderTickerRows(FALLBACK_PAIRS); // no backend reachable (e.g. static file preview) — use mock data
    }
  }
  loadLivePrices();

  /* ---- FAQ accordion ---- */
  document.querySelectorAll('.faq-item .faq-q').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });

  /* ---- Generic dropdown for notifications/profile menus ---- */
  document.querySelectorAll('[data-dropdown-trigger]').forEach(trigger => {
    const panel = document.getElementById(trigger.dataset.dropdownTrigger);
    if (!panel) return;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
    });
    document.addEventListener('click', () => panel.classList.remove('open'));
  });

  /* ---- Markets table (markets.html) — real data via /api/markets ---- */
  const marketsTableBody = document.querySelector('[data-markets-table]');
  if (marketsTableBody) {
    (async function loadMarketsTable() {
      try {
        const res = await fetch('/api/markets');
        if (!res.ok) throw new Error('Markets unavailable');
        const { markets } = await res.json();
        marketsTableBody.innerHTML = markets.map((m, i) => {
          const chg = m.price_change_percentage_24h || 0;
          const cls = chg >= 0 ? 'delta-up' : 'delta-down';
          const sign = chg >= 0 ? '+' : '';
          return `<tr>
            <td class="mono">${i + 1}</td>
            <td><div class="coin-cell"><div class="coin-icon">${(m.symbol || '').toUpperCase().slice(0, 4)}</div><div><strong>${m.name}</strong><div style="font-size:.78rem;color:var(--muted);">${(m.symbol || '').toUpperCase()}</div></div></div></td>
            <td class="mono">$${m.current_price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
            <td class="mono ${cls}">${sign}${chg.toFixed(2)}%</td>
            <td class="mono">$${(m.market_cap || 0).toLocaleString()}</td>
            <td class="mono">$${(m.total_volume || 0).toLocaleString()}</td>
            <td><a href="exchange.html" class="btn btn-sm btn-ghost">Trade</a></td>
          </tr>`;
        }).join('');
      } catch (err) {
        marketsTableBody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--muted);padding:32px;">Live market data is temporarily unavailable. Please try again shortly.</td></tr>`;
      }
    })();
  }

})();
/**
 * VAULTEX — MOBILE NAV FIX
 * Paste at the bottom of assets/js/main.js
 *
 * Differences from NOVA:
 *  - menu class  → .mobile-menu
 *  - toggle class → .nav-burger
 *  - dropdown    → "Earn" (Staking, Investment Plans, Savings & Yield, Launchpad)
 */

(function () {
  "use strict";

  /* ── 1. Grab elements ──────────────────────────────────────── */
  const navBurger = document.querySelector(".nav-burger");
  const menu      = document.querySelector(".mobile-menu");

  if (!navBurger || !menu) return;

  /* ── 2. Backdrop ───────────────────────────────────────────── */
  let backdrop = document.querySelector(".mobile-menu-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "mobile-menu-backdrop";
    document.body.appendChild(backdrop);
  }

  /* ── 3. Close (×) button ───────────────────────────────────── */
  if (!menu.querySelector(".mobile-menu-close")) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "mobile-menu-close";
    closeBtn.setAttribute("aria-label", "Close menu");
    closeBtn.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
         <path d="M18 6 6 18M6 6l12 12"/>
       </svg>`;
    menu.prepend(closeBtn);
    closeBtn.addEventListener("click", closeMenu);
  }

  /* ── 4. Build "Earn" accordion ─────────────────────────────── */
  const earnSubLinks = [
    { href: "staking.html",      label: "Staking"            },
    { href: "investments.html",  label: "Investment Plans"   },
    { href: "earn.html",         label: "Savings & Yield"    },
    { href: "launchpad.html",    label: "Launchpad"          },
  ];

  const earnHrefs = earnSubLinks.map(d => d.href);

  // Remove the flat sub-links that are already in the HTML
  menu.querySelectorAll("a").forEach(a => {
    if (earnHrefs.includes(a.getAttribute("href"))) a.remove();
  });

  // Find the NFT Market link — insert accordion before it
  const nftLink = [...menu.querySelectorAll("a")].find(
    a => a.getAttribute("href") === "nft-marketplace.html"
  );

  if (nftLink && !menu.querySelector(".mobile-parent-btn")) {
    // Toggle button
    const parentBtn = document.createElement("button");
    parentBtn.className = "mobile-parent-btn";
    parentBtn.setAttribute("aria-expanded", "false");
    parentBtn.innerHTML =
      `Earn
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
         <path d="M6 9l6 6 6-6"/>
       </svg>`;

    // Sub-link list
    const subList = document.createElement("div");
    subList.className = "mobile-sub-links";
    earnSubLinks.forEach(({ href, label }) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      subList.appendChild(a);
    });

    // Toggle on click
    parentBtn.addEventListener("click", () => {
      const open = subList.classList.toggle("is-open");
      parentBtn.classList.toggle("is-open", open);
      parentBtn.setAttribute("aria-expanded", String(open));
    });

    menu.insertBefore(parentBtn, nftLink);
    menu.insertBefore(subList, nftLink);
  }

  /* ── 5. Open / close ───────────────────────────────────────── */
  function openMenu() {
    menu.classList.add("is-open");
    backdrop.classList.add("is-open");
    navBurger.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }

  function closeMenu() {
    menu.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    navBurger.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  /* ── 6. Wire up events ─────────────────────────────────────── */
  navBurger.addEventListener("click", () => {
    menu.classList.contains("is-open") ? closeMenu() : openMenu();
  });

  backdrop.addEventListener("click", closeMenu);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && menu.classList.contains("is-open")) closeMenu();
  });

  // Close when any final destination link is tapped
  menu.addEventListener("click", e => {
    if (e.target.tagName === "A") closeMenu();
  });

})();
/**
 * VAULTEX — MOBILE NAV STABILITY FIX
 * Paste at the very bottom of assets/js/main.js
 * (after the previous mobile nav fix you already pasted)
 *
 * Fixes:
 *  1. Measures the scrollbar width so the page doesn't jump when
 *     overflow:hidden is applied on open
 *  2. Switches body class instead of inline style so CSS handles locking
 */

(function () {
  "use strict";

  /* ── Measure scrollbar width once and store as CSS variable ── */
  function setScrollbarWidth() {
    const width = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty(
      "--scrollbar-width",
      width + "px"
    );
  }
  setScrollbarWidth();
  window.addEventListener("resize", setScrollbarWidth);

  /* ── Override the open/close from the previous fix to use
        body class instead of inline overflow style ────────────── */
  const navBurger = document.querySelector(".nav-burger");
  const menu      = document.querySelector(".mobile-menu");
  const backdrop  = document.querySelector(".mobile-menu-backdrop");

  if (!navBurger || !menu) return;

  function openMenu() {
    setScrollbarWidth(); // measure fresh before locking
    menu.classList.add("is-open");
    if (backdrop) backdrop.classList.add("is-open");
    document.body.classList.add("menu-open");
    navBurger.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    menu.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    document.body.classList.remove("menu-open");
    navBurger.setAttribute("aria-expanded", "false");
  }

  /* Replace the burger listener cleanly */
  const newBurger = navBurger.cloneNode(true); // clone removes old listeners
  navBurger.parentNode.replaceChild(newBurger, navBurger);

  newBurger.addEventListener("click", () => {
    menu.classList.contains("is-open") ? closeMenu() : openMenu();
  });

  if (backdrop) backdrop.addEventListener("click", closeMenu);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && menu.classList.contains("is-open")) closeMenu();
  });

  /* Close button inside drawer */
  const closeBtn = menu.querySelector(".mobile-menu-close");
  if (closeBtn) {
    const newClose = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newClose, closeBtn);
    newClose.addEventListener("click", closeMenu);
  }

  /* Close on any destination link tap */
  menu.addEventListener("click", e => {
    if (e.target.tagName === "A") closeMenu();
  });

})();