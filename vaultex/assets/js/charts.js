/* =========================================================
   CHARTS.JS — minimal dependency-free canvas chart engine
   Provides: CEPChart.line(canvas, data, opts)
             CEPChart.candles(canvas, data, opts)
             CEPChart.donut(canvas, data, opts)
   data for line: array of numbers
   data for candles: array of {o,h,l,c}
   data for donut: array of {label, value, color}
   ========================================================= */

window.CEPChart = (function () {
  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w: rect.width, h: rect.height };
  }

  function line(canvas, data, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const color = opts.color || getCssVar('--mint') || '#00D9A3';
    const padding = 10;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = (max - min) || 1;

    ctx.clearRect(0, 0, w, h);

    // gradient fill under line
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '33');
    grad.addColorStop(1, color + '00');

    const points = data.map((v, i) => ({
      x: padding + (i / (data.length - 1)) * (w - padding * 2),
      y: h - padding - ((v - min) / range) * (h - padding * 2)
    }));

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, h);
    ctx.lineTo(points[0].x, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function candles(canvas, data, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const up = opts.up || getCssVar('--mint') || '#00D9A3';
    const down = opts.down || getCssVar('--coral') || '#FF5C72';
    const padding = 10;
    const all = data.flatMap(d => [d.h, d.l]);
    const max = Math.max(...all);
    const min = Math.min(...all);
    const range = (max - min) || 1;
    const slotW = (w - padding * 2) / data.length;
    const bodyW = Math.max(slotW * 0.55, 2);

    ctx.clearRect(0, 0, w, h);

    const scaleY = (v) => h - padding - ((v - min) / range) * (h - padding * 2);

    data.forEach((d, i) => {
      const x = padding + i * slotW + slotW / 2;
      const isUp = d.c >= d.o;
      ctx.strokeStyle = isUp ? up : down;
      ctx.fillStyle = isUp ? up : down;
      // wick
      ctx.beginPath();
      ctx.moveTo(x, scaleY(d.h));
      ctx.lineTo(x, scaleY(d.l));
      ctx.lineWidth = 1;
      ctx.stroke();
      // body
      const yO = scaleY(d.o);
      const yC = scaleY(d.c);
      const top = Math.min(yO, yC);
      const bodyH = Math.max(Math.abs(yC - yO), 1.5);
      ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH);
    });
  }

  function donut(canvas, data, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(w, h) / 2 - 6;
    const thickness = opts.thickness || radius * 0.35;
    const total = data.reduce((s, d) => s + d.value, 0);
    let angle = -Math.PI / 2;

    ctx.clearRect(0, 0, w, h);
    data.forEach(d => {
      const slice = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, angle, angle + slice);
      ctx.arc(cx, cy, radius - thickness, angle + slice, angle, true);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();
      angle += slice;
    });
  }

  function randomWalk(n, start = 100, vol = 2) {
    const arr = [start];
    for (let i = 1; i < n; i++) {
      arr.push(Math.max(1, arr[i - 1] + (Math.random() - 0.5) * vol));
    }
    return arr;
  }

  function randomCandles(n, start = 100, vol = 2) {
    const arr = [];
    let prev = start;
    for (let i = 0; i < n; i++) {
      const o = prev;
      const c = Math.max(1, o + (Math.random() - 0.5) * vol);
      const h = Math.max(o, c) + Math.random() * (vol / 2);
      const l = Math.min(o, c) - Math.random() * (vol / 2);
      arr.push({ o, h, l, c });
      prev = c;
    }
    return arr;
  }

  return { line, candles, donut, randomWalk, randomCandles };
})();
