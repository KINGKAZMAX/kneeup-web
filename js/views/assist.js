// Assist Level 助力等级决策面板（#/assist）——纯自绘:gauge 仪表 + 输入因子 + 30s 曲线 + 修正原因流
// 引擎 js/ai/assist-engine.js(纯函数);数据源 js/ai/assist-sim.js(SIMULATED);蓝本:21-Web平台设计方案 §4.2
import { tok } from '../viz/charts.js';
import { AssistEngine, ACTIVITY_LABELS, HARD_CAP, MAX_RATE_PER_SEC, SI_THRESHOLD, FATIGUE_THRESHOLD } from '../ai/assist-engine.js';
import { createAssistSim, ASSIST_SCENARIOS } from '../ai/assist-sim.js';
import { getFatigueBoost, writeAssistSnapshot } from '../ai/assist-runtime.js';
import { createBleSource, bleSupported } from '../ai/ble-source.js';

const WINDOW_S = 30;          // 曲线窗口 30s
const PUSH_HZ = 10;           // 曲线采样
const WARN_AT = 35, DANGER_AT = 45;   // 阈值带(安全语义:高助力/接近上限)
const SCN_ORDER = ['flat', 'standup', 'uphill', 'stairs', 'downhill'];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtT = ts => { const d = new Date(ts); return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };

/* ---------------- gauge 手绘 ---------------- */
function drawGauge(cv, d) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 320, h = cv.clientHeight || 300;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h * 0.66, r = Math.min(w * 0.42, h * 0.52);
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;          // 135° → 405°(270° 量程)
  const va = v => a0 + (clamp(v, 0, HARD_CAP) / HARD_CAP) * sweep;
  const band = (v0, v1, color, width) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, va(v0), va(v1));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'butt'; ctx.stroke();
  };

  // 阈值带:0-35 碳黑轨道 / 35-45 warn / 45-50 danger(仅安全语义)
  band(0, WARN_AT, tok('--carbon-700'), 12);
  band(WARN_AT, DANGER_AT, tok('--warn'), 12);
  band(DANGER_AT, HARD_CAP, tok('--danger'), 12);
  // 刻度 + 数字
  ctx.font = '10px ' + tok('--font-mono'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let v = 0; v <= HARD_CAP; v += 10) {
    const a = va(v);
    ctx.strokeStyle = tok('--line-strong'); ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
    ctx.lineTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8));
    ctx.stroke();
    ctx.fillStyle = tok('--muted');
    ctx.fillText(String(v), clamp(cx + Math.cos(a) * (r + 20), 12, w - 12), clamp(cy + Math.sin(a) * (r + 20), 8, h - 8));
  }
  // 当前值钴蓝弧
  const lv = clamp(d.level, 0, HARD_CAP);
  if (lv > 0.05) {
    ctx.beginPath(); ctx.arc(cx, cy, r, va(0), va(lv));
    ctx.strokeStyle = tok('--accent'); ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
  }
  // 目标值刻点(限速过渡中可见目标)
  if (d.rateLimited) {
    const a = va(d.target);
    ctx.fillStyle = tok('--accent-2');
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.5, 0, 7); ctx.fill();
  }
  // 中央大数字(JetBrains Mono)
  ctx.fillStyle = tok('--ink');
  ctx.font = '700 ' + Math.round(r * 0.52) + 'px ' + tok('--font-mono');
  ctx.fillText(String(Math.round(lv)), cx, cy - r * 0.28);
  ctx.font = '600 ' + Math.round(r * 0.16) + 'px ' + tok('--font-mono');
  ctx.fillStyle = tok('--accent');
  ctx.fillText('%', cx + r * 0.42, cy - r * 0.28);
  ctx.font = '10px ' + tok('--font-mono');
  ctx.fillStyle = tok('--muted');
  ctx.fillText('ASSIST LEVEL · 助力等级', cx, cy + r * 0.02);
  ctx.fillText(`${ACTIVITY_LABELS[d.activity] || d.activity} · ${d.activity}`, cx, cy + r * 0.2);
  if (d.capped) {
    ctx.fillStyle = tok('--danger');
    ctx.fillText(`已达硬上限 ${HARD_CAP}%`, cx, cy + r * 0.38);
  } else if (d.rateLimited) {
    ctx.fillStyle = tok('--accent-2');
    ctx.fillText(`限速过渡 → 目标 ${Math.round(d.target)}%`, cx, cy + r * 0.38);
  }
  cv.setAttribute('aria-label', `助力等级仪表:当前 ${Math.round(lv)}%,目标 ${Math.round(d.target)}%${d.capped ? ',已触发硬上限 50%' : ''}`);
}

/* ---------------- 30s 曲线(charts.js 风格) ---------------- */
function drawTrend(cv, buf, tNow) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 640, h = cv.clientHeight || 180;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const mL = 34, mR = 12, mT = 12, mB = 20;
  const x0 = mL, x1 = w - mR, ph = h - mT - mB;
  const px = t => x1 - (tNow - t) * ((x1 - x0) / WINDOW_S);
  const py = v => mT + ph - ph * (v / HARD_CAP);

  ctx.font = '10px ' + tok('--font-mono'); ctx.lineWidth = 1;
  for (let v = 0; v <= HARD_CAP; v += 10) {
    const y = Math.round(py(v)) + .5;
    ctx.strokeStyle = tok('--line'); ctx.fillStyle = tok('--muted');
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(v + '%', x0 - 6, y + 3);
  }
  // warn/danger 阈值虚线
  for (const [v, c] of [[WARN_AT, tok('--warn')], [DANGER_AT, tok('--danger')]]) {
    ctx.save();
    ctx.strokeStyle = c; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, py(v)); ctx.lineTo(x1, py(v)); ctx.stroke();
    ctx.restore();
  }
  const vis = buf.filter(p => p.t >= tNow - WINDOW_S - 0.2);
  if (vis.length > 1) {
    // 面积 veil + accent 主线
    ctx.beginPath();
    vis.forEach((p, i) => i ? ctx.lineTo(px(p.t), py(p.v)) : ctx.moveTo(px(p.t), py(p.v)));
    ctx.lineTo(px(vis[vis.length - 1].t), mT + ph); ctx.lineTo(px(vis[0].t), mT + ph); ctx.closePath();
    ctx.fillStyle = tok('--accent-veil'); ctx.fill();
    ctx.beginPath();
    vis.forEach((p, i) => i ? ctx.lineTo(px(p.t), py(p.v)) : ctx.moveTo(px(p.t), py(p.v)));
    ctx.strokeStyle = tok('--accent'); ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.fillStyle = tok('--muted'); ctx.textAlign = 'center';
  for (let s = 0; s <= WINDOW_S; s += 10) ctx.fillText(`-${s}s`, px(tNow - s), h - 6);
}

/* ---------------- 视图 ---------------- */
export function render(root) {
  root.innerHTML = `
  <div class="view-head">
    <span class="eyebrow">Assist Level · 助力等级</span>
    <h1>助力等级决策面板</h1>
    <p class="view-sub">可解释规则:动作基准(平地 10 / 起身 25 / 上坡 35 / 上楼 30 / 下楼 20)+ 左右差 SI&gt;${SI_THRESHOLD}% 每超 5% 加 3pp + 疲劳&gt;${FATIGUE_THRESHOLD} 每超 10 加 2pp · 硬上限 ${HARD_CAP}% · 输出限速 ≤${MAX_RATE_PER_SEC}pp/s</p>
  </div>

  <div class="as-scn" id="as-scn" role="group" aria-label="场景切换(模拟)">
    ${SCN_ORDER.map(k => `<button type="button" class="fchip${k === 'flat' ? ' is-on' : ''}" data-scn="${k}">${ACTIVITY_LABELS[k]}<span class="as-scn-en">${k.toUpperCase()}</span></button>`).join('')}
  </div>
  <div class="as-scn">
    <button type="button" class="fchip as-ble" id="as-ble">连接护具 BLE · LIVE</button>
    <span class="as-ble-note muted" id="as-ble-note"></span>
  </div>

  <div class="as-grid">
    <div class="panel as-gauge-panel">
      <span class="ku-chip sim as-chip">SIMULATED · 模拟</span>
      <canvas class="as-gauge" id="as-gauge" role="img"></canvas>
      <p class="as-readout" id="as-readout">基准 10% · 无修正 · 目标 10%</p>
    </div>

    <div class="panel">
      <h3>输入因子 Inputs</h3>
      <p class="panel-sub">模拟传感流 · 随场景变化 · 观察项不参与 v1 规则(膝角/速度)· 疲劳含训练游戏结算回写(10 分钟衰减)</p>
      <div class="as-factors">
        <div class="as-factor"><span class="k">当前动作</span><span class="v badge" id="as-f-act">平地 FLAT</span></div>
        <div class="as-factor"><span class="k">膝角 Knee</span><span class="v" id="as-f-knee">—</span><span class="bar"><i id="as-b-knee"></i><em style="left:${(100 / 190) * 100}%"></em></span></div>
        <div class="as-factor"><span class="k">速度 Speed</span><span class="v" id="as-f-speed">—</span><span class="bar"><i id="as-b-speed"></i></span></div>
        <div class="as-factor"><span class="k">左右差 SI</span><span class="v" id="as-f-si">—</span><span class="bar"><i id="as-b-si"></i><em style="left:${(SI_THRESHOLD / 25) * 100}%"></em></span></div>
        <div class="as-factor"><span class="k">疲劳指数 Fatigue</span><span class="v" id="as-f-fat">—</span><span class="bar"><i id="as-b-fat"></i><em style="left:${FATIGUE_THRESHOLD}%"></em></span></div>
      </div>
    </div>
  </div>

  <div class="panel">
    <h3>Assist% 随时间</h3>
    <p class="panel-sub">滚动窗口 ${WINDOW_S} 秒 · 纵轴固定 0–${HARD_CAP}%(诚实缩放)· 虚线 = 阈值 ${WARN_AT}/${DANGER_AT}</p>
    <div class="screen-canvas-wrap sim-skin">
      <canvas class="chart-canvas as-trend" id="as-trend" role="img" aria-label="助力等级随时间曲线,滚动窗口 30 秒"></canvas>
      <div class="sim-stripes" aria-hidden="true"></div>
    </div>
    <div class="legend-row">
      <span class="lg"><i></i>Assist%(限速后输出)</span>
      <span class="lg"><i class="dash"></i>阈值 ${WARN_AT}%</span>
      <span class="lg"><i class="dash" style="border-top-color:var(--danger)"></i>阈值 ${DANGER_AT}%</span>
    </div>
  </div>

  <div class="panel">
    <h3>修正原因流 Modifiers</h3>
    <p class="panel-sub">规则触发的阶梯修正,逐条可解释 · 变化时记录</p>
    <ul class="as-feed" id="as-feed"><li class="muted">当前无修正——基准输出</li></ul>
  </div>

  <p class="screen-foot">说明:本面板为规则引擎演示(数据 SIMULATED 模拟),输出为助力等级参考值,不构成建议性设定;硬上限 ${HARD_CAP}% 与速率限制 ≤${MAX_RATE_PER_SEC}pp/s 为安全约束。</p>`;

  const sim = createAssistSim({ seed: 11 });
  const eng = new AssistEngine();
  sim.setScenario('flat');

  // BLE 实机通道（LIVE）:连接后膝角/SI 取自实机，速度与疲劳仍由模拟通道补全（如实标注）
  const chipEl = root.querySelector('.as-chip');
  const bleBtn = root.querySelector('#as-ble');
  const bleNote = root.querySelector('#as-ble-note');
  const ble = createBleSource({
    onState(s, detail) {
      if (s === 'live') {
        chipEl.className = 'ku-chip live as-chip'; chipEl.textContent = 'LIVE · BLE 实测';
        bleBtn.classList.add('is-on'); bleBtn.textContent = '断开 BLE';
        bleNote.textContent = `已连接${detail ? ' ' + detail : ''} · 膝角/左右差为实机值,速度/疲劳仍为模拟`;
      } else if (s === 'closed') {
        chipEl.className = 'ku-chip sim as-chip'; chipEl.textContent = 'SIMULATED · 模拟';
        bleBtn.classList.remove('is-on'); bleBtn.textContent = '连接护具 BLE · LIVE';
        bleNote.textContent = '已断开,回退模拟通道';
      } else if (s === 'connecting') { bleNote.textContent = '连接中…'; }
    },
  });
  if (!bleSupported()) {
    bleBtn.disabled = true;
    bleNote.textContent = '当前浏览器不支持 Web Bluetooth · 请用桌面或 Android Chrome';
  } else {
    bleBtn.addEventListener('click', async () => {
      if (ble.running) { await ble.stop(); return; }
      try { await ble.start(); }
      catch (e) {
        bleNote.textContent = e && e.name === 'NotFoundError' && /cancel/i.test(e.message || '')
          ? '已取消设备选择'
          : `连接失败(${e && e.name || '未知'}) · 保持模拟通道`;
      }
    });
  }

  const cvG = root.querySelector('#as-gauge');
  const cvT = root.querySelector('#as-trend');
  const readout = root.querySelector('#as-readout');
  const feed = root.querySelector('#as-feed');
  const F = {
    act: root.querySelector('#as-f-act'), knee: root.querySelector('#as-f-knee'),
    speed: root.querySelector('#as-f-speed'), si: root.querySelector('#as-f-si'), fat: root.querySelector('#as-f-fat'),
  };
  const B = {
    knee: root.querySelector('#as-b-knee'), speed: root.querySelector('#as-b-speed'),
    si: root.querySelector('#as-b-si'), fat: root.querySelector('#as-b-fat'),
  };

  const state = { buf: [], clock: 0, lastPush: 0, lastDom: 0, lastSnap: 0, lastSig: '', raf: 0, dead: false };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function pushFeed(d, wallTs) {
    const sig = d.modifiers.map(m => m.delta).join('|') + (d.capped ? '#cap' : '');
    if (sig === state.lastSig) return;
    state.lastSig = sig;
    const items = [];
    if (!d.modifiers.length && !d.capped) {
      items.push(`<li><span class="t">${fmtT(wallTs)}</span><span class="muted">无修正 · 基准 ${d.base}%</span></li>`);
    } else {
      d.modifiers.forEach(m => items.push(`<li><span class="t">${fmtT(wallTs)}</span><span class="pp">+${m.delta}pp</span><span>${m.reason}</span></li>`));
      if (d.capped) items.push(`<li class="cap"><span class="t">${fmtT(wallTs)}</span><span class="pp">硬上限</span><span>输出截断至 ${HARD_CAP}%</span></li>`);
    }
    feed.insertAdjacentHTML('afterbegin', items.join(''));
    while (feed.children.length > 8) feed.lastElementChild.remove();
  }

  function tick(now) {
    if (state.dead) return;
    const f = sim.frame(now);
    const bf = ble.running ? ble.getFrame() : null;
    if (bf) {
      // BLE LIVE:膝角取实机较小值;SI=|L−R|/(0.5(L+R))×100%(蓝本 §4.1③)
      const L = bf.angleL, R = bf.angleR;
      if (L != null) f.kneeAngle = L;
      if (L != null && R != null) f.si = clamp(Math.abs(L - R) / Math.max(1, (L + R) / 2) * 100, 0, 100);
    }
    const boost = getFatigueBoost();           // 游戏结算写回的疲劳贡献(10min 衰减)
    const fatigueTotal = clamp(f.fatigue + boost, 0, 100);
    const d = eng.update({ ...f, fatigue: fatigueTotal }, now);
    state.clock = now / 1000;

    if (now - state.lastPush >= 1000 / PUSH_HZ) {
      state.lastPush = now;
      state.buf.push({ t: state.clock, v: d.level });
      if (state.buf.length > WINDOW_S * PUSH_HZ + 20) state.buf.splice(0, state.buf.length - WINDOW_S * PUSH_HZ);
    }
    if (!reduced || now - state.lastDom > 1000) {
      drawGauge(cvG, d);
      drawTrend(cvT, state.buf, state.clock);
    }
    if (now - state.lastDom > 250) {
      state.lastDom = now;
      F.act.textContent = `${ACTIVITY_LABELS[f.activity]} ${f.activity.toUpperCase()}`;
      F.knee.textContent = `${Math.round(f.kneeAngle)}°`;
      F.speed.textContent = `${f.speed.toFixed(1)} km/h`;
      F.si.textContent = `${f.si.toFixed(1)} %`;
      F.fat.textContent = `${Math.round(fatigueTotal)} /100${boost > 0.5 ? `(含训练回写 +${Math.round(boost)})` : ''}`;
      B.knee.style.width = `${clamp(f.kneeAngle / 190 * 100, 0, 100)}%`;
      B.speed.style.width = `${clamp(f.speed / 6 * 100, 0, 100)}%`;
      B.si.style.width = `${clamp(f.si / 25 * 100, 0, 100)}%`;
      B.fat.style.width = `${clamp(fatigueTotal, 0, 100)}%`;
      const mods = d.modifiers.reduce((s, m) => s + m.delta, 0);
      readout.textContent = `基准 ${d.base}% ＋ 修正 +${mods}% ＝ 目标 ${d.target}%${d.capped ? ` · 已截断至 ${HARD_CAP}%` : ''}${d.rateLimited ? ` · 限速输出 ${d.level.toFixed(1)}%` : ''}`;
      pushFeed(d, Date.now());
    }
    if (now - state.lastSnap > 500) {
      state.lastSnap = now;
      writeAssistSnapshot({ level: d.level, activity: d.activity });   // 跨页共享快照
    }
    state.raf = requestAnimationFrame(tick);
  }
  state.raf = requestAnimationFrame(tick);

  root.querySelector('#as-scn').addEventListener('click', e => {
    const btn = e.target.closest('[data-scn]'); if (!btn) return;
    root.querySelectorAll('#as-scn .fchip').forEach(b => b.classList.toggle('is-on', b === btn));
    sim.setScenario(btn.dataset.scn);
  });

  return () => { state.dead = true; cancelAnimationFrame(state.raf); try { ble.running && ble.stop(); } catch {} };
}
