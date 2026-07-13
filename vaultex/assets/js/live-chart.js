/**
 * live-chart.js
 * Drives the hero BTC/USDT canvas + price ticker.
 *
 * IMPORTANT: There's no real exchange data feed wired into this template,
 * so this file SIMULATES live price movement with a random-walk model
 * seeded from the starting price already in the HTML. It looks and moves
 * like a live feed (ticks every second, smooth line, green/red delta),
 * but the numbers are not real market data.
 *
 * To go fully "live" for production, swap `tick()` below for a call to
 * a real feed (e.g. a WebSocket to Binance/Coinbase public market data,
 * or your own backend), and push the real prices into `history` instead
 * of generating them.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("hero-chart");
  if (!canvas) return;

  const priceEl = document.getElementById("hero-price");
  const changeEl = document.getElementById("hero-change");
  const ctx = canvas.getContext("2d");

  // ---- config ----
  const START_PRICE = 67230.12;
  const POINTS = 60;          // how many ticks visible on the chart
  const TICK_MS = 1000;       // update interval
  const VOLATILITY = 0.0009;  // per-tick max % move

  const openPrice = START_PRICE;
  const history = Array.from({ length: POINTS }, () => START_PRICE);

  function fmtPrice(p) {
    return "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtChange(p) {
    const pct = ((p - openPrice) / openPrice) * 100;
    const sign = pct >= 0 ? "+" : "";
    return { text: `${sign}${pct.toFixed(2)}%`, up: pct >= 0 };
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...history);
    const max = Math.max(...history);
    const pad = (max - min) * 0.15 || 1;
    const lo = min - pad;
    const hi = max + pad;

    const stepX = w / (history.length - 1);
    const yFor = (p) => h - ((p - lo) / (hi - lo)) * h;

    const up = history[history.length - 1] >= history[0];
    const lineColor = up ? "#22c55e" : "#ef4444";

    // filled area under the line
    ctx.beginPath();
    ctx.moveTo(0, yFor(history[0]));
    history.forEach((p, i) => ctx.lineTo(i * stepX, yFor(p)));
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, up ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.22)");
    grad.addColorStop(1, "rgba(34,197,94,0.0)");
    ctx.fillStyle = grad;
    ctx.fill();

    // the line itself
    ctx.beginPath();
    history.forEach((p, i) => {
      const x = i * stepX;
      const y = yFor(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineWidth = 2;
    ctx.strokeStyle = lineColor;
    ctx.lineJoin = "round";
    ctx.stroke();

    // glowing dot at the latest point
    const lastX = (history.length - 1) * stepX;
    const lastY = yFor(history[history.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.shadowColor = lineColor;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function tick() {
    const last = history[history.length - 1];
    const move = last * (Math.random() * 2 - 1) * VOLATILITY;
    const next = Math.max(0.01, last + move);
    history.push(next);
    history.shift();

    if (priceEl) priceEl.textContent = fmtPrice(next);
    if (changeEl) {
      const { text, up } = fmtChange(next);
      changeEl.textContent = text;
      changeEl.classList.toggle("delta-up", up);
      changeEl.classList.toggle("delta-down", !up);
    }
    draw();
  }

  window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
  });

  resizeCanvas();
  draw();
  setInterval(tick, TICK_MS);
})();
