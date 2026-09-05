// 自绘 canvas 图表（K9 §二：图B ROM 折线 / 图C 质量分柱+均线）——零依赖，配色只读 tokens
const tokCache = {};
export function tok(name) {
  if (!(name in tokCache)) {
    tokCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  return tokCache[name];
}

export function fitCanvas(canvas, defH = 180) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 320;
  const h = canvas.clientHeight || defH;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function gridY(ctx, x0, x1, y0, h, top, bottom, steps, fmt) {
  ctx.strokeStyle = tok('--line');
  ctx.fillStyle = tok('--muted');
  ctx.font = '10px ' + tok('--font-mono');
  ctx.lineWidth = 1;
  for (let i = 0; i <= steps; i++) {
    const v = bottom + (top - bottom) * (i / steps);
    const y = Math.round(y0 + h - h * (i / steps)) + .5;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(fmt(v), x0 - 6, y + 3);
  }
}

// 图B · ROM 周趋势：Y 固定 0-150°（诚实缩放）；左膝 accent 实线●，右膝 warn 虚线■，峰值面积 veil
export function drawRomTrend(canvas, pts) {
  const { ctx, w, h } = fitCanvas(canvas, 180);
  ctx.clearRect(0, 0, w, h);
  const L = 34, R = 34, T = 12, B = 24;
  const x0 = L, x1 = w - R, ph = h - T - B;
  gridY(ctx, x0, x1, T, ph, 150, 0, 5, v => v + '°');

  const n = pts.length;
  if (!n) {
    ctx.fillStyle = tok('--muted'); ctx.textAlign = 'center';
    ctx.fillText('暂无记录', w / 2, h / 2);
    return;
  }
  const px = i => (n === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * (i / (n - 1)));
  const py = v => T + ph - ph * (v / 150);

  // 峰值面积（左右膝较大值，accent 12%）
  ctx.beginPath();
  pts.forEach((p, i) => { const y = py(Math.max(p.l, p.r)); i ? ctx.lineTo(px(i), y) : ctx.moveTo(px(i), y); });
  ctx.lineTo(px(n - 1), T + ph); ctx.lineTo(px(0), T + ph); ctx.closePath();
  ctx.fillStyle = tok('--accent-veil'); ctx.fill();

  // 右膝：琥珀虚线 + ■
  ctx.save();
  ctx.strokeStyle = tok('--warn'); ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(px(i), py(p.r)) : ctx.moveTo(px(i), py(p.r))); ctx.stroke();
  ctx.setLineDash([]);
  pts.forEach((p, i) => { ctx.fillStyle = tok('--warn'); ctx.fillRect(px(i) - 2.5, py(p.r) - 2.5, 5, 5); });
  ctx.restore();

  // 左膝：accent 实线 + ●
  ctx.strokeStyle = tok('--accent'); ctx.lineWidth = 2;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(px(i), py(p.l)) : ctx.moveTo(px(i), py(p.l))); ctx.stroke();
  pts.forEach((p, i) => { ctx.fillStyle = tok('--accent'); ctx.beginPath(); ctx.arc(px(i), py(p.l), 3, 0, 7); ctx.fill(); });

  // 线尾 L/R 文字（第四重编码）
  ctx.font = '10px ' + tok('--font-mono'); ctx.textAlign = 'left';
  ctx.fillStyle = tok('--accent'); ctx.fillText('L', Math.min(px(n - 1) + 6, w - 8), py(pts[n - 1].l));
  ctx.fillStyle = tok('--warn'); ctx.fillText('R', Math.min(px(n - 1) + 6, w - 8), py(pts[n - 1].r) + 10);

  // X 轴：每 3 天一个标签
  ctx.fillStyle = tok('--muted'); ctx.textAlign = 'center';
  pts.forEach((p, i) => { if (i % 3 === 0 || i === n - 1) ctx.fillText(p.label, px(i), h - 8); });

  const lastL = pts[n - 1].l, lastR = pts[n - 1].r;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `近${n}天活动度趋势（度）：左膝 ${Math.round(lastL)}°，右膝 ${Math.round(lastR)}°，纵轴固定 0 至 150 度`);
}

// 图C · 质量分柱 + 7 日均线；基线-15 弱化为 muted；caution▲warn / stop▲danger
export function drawQualityBars(canvas, sessions) {
  const chrono = sessions.slice(0, 20).reverse(); // 传入为新在前
  const { ctx, w, h } = fitCanvas(canvas, 180);
  ctx.clearRect(0, 0, w, h);
  const L = 30, R = 12, T = 16, B = 26;
  const x0 = L, x1 = w - R, ph = h - T - B;
  gridY(ctx, x0, x1, T, ph, 100, 0, 4, v => v);

  const n = chrono.length;
  if (!n) {
    ctx.fillStyle = tok('--muted'); ctx.textAlign = 'center';
    ctx.fillText('暂无记录', w / 2, h / 2);
    return;
  }
  const base = chrono.reduce((s, x) => s + x.metrics.qualityAvg, 0) / n;
  const slot = (x1 - x0) / n;
  const bw = Math.max(4, slot * 0.55);

  chrono.forEach((s, i) => {
    const v = s.metrics.qualityAvg;
    const x = x0 + slot * i + (slot - bw) / 2;
    const bh = ph * (v / 100);
    ctx.fillStyle = v < base - 15 ? tok('--muted') : tok('--accent');
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, T + ph - bh, bw, bh, 2) : ctx.rect(x, T + ph - bh, bw, bh);
    ctx.fill();
    if (s.safety && (s.safety.flag === 'caution' || s.safety.flag === 'stop')) {
      const mx = x + bw / 2, my = T + ph - bh - 8;
      ctx.fillStyle = s.safety.flag === 'stop' ? tok('--danger') : tok('--warn');
      ctx.beginPath(); ctx.moveTo(mx, my - 4); ctx.lineTo(mx + 4, my + 3); ctx.lineTo(mx - 4, my + 3); ctx.closePath(); ctx.fill();
    }
  });

  // 7 条移动均线（ink-dim 1.5px）
  ctx.strokeStyle = tok('--ink-dim'); ctx.lineWidth = 1.5;
  ctx.beginPath();
  chrono.forEach((_, i) => {
    const from = Math.max(0, i - 6);
    const seg = chrono.slice(from, i + 1);
    const m = seg.reduce((s, x) => s + x.metrics.qualityAvg, 0) / seg.length;
    const x = x0 + slot * i + slot / 2;
    const y = T + ph - ph * (m / 100);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();

  // X 标签每 5 条（M/D HH:mm）
  ctx.fillStyle = tok('--muted'); ctx.font = '9px ' + tok('--font-mono'); ctx.textAlign = 'center';
  chrono.forEach((s, i) => {
    if (i % 5 === 0) {
      const d = new Date(s.tsStart);
      ctx.fillText(`${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, x0 + slot * i + slot / 2, h - 8);
    }
  });

  const qs = chrono.map(s => s.metrics.qualityAvg);
  const warns = chrono.filter(s => s.safety && s.safety.flag !== 'none').length;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `近${n}次动作质量分：均值 ${Math.round(base)}，最低 ${Math.min(...qs)}，${warns} 次安全警示`);
  return { baseline: base, warns };
}
