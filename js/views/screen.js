// AI 数据屏 · 双通道滚动曲线（K9 图D）：左轴 sEMG（accent），右轴膝角（琥珀虚线）
// rAF 驱动 sim 30Hz / 窗口 10s；SIMULATED 斜纹角标；断流显示「信号中断」；预留 Web Serial 接入口
import { tok } from '../viz/charts.js';

const SAMPLE_HZ = 30, WINDOW_S = 10, CAP = SAMPLE_HZ * WINDOW_S;

export function render(root) {
  root.innerHTML = `
  <div class="view-head">
    <span class="eyebrow">AI Data Screen · AI 数据屏</span>
    <h1>实时双通道曲线</h1>
    <p class="view-sub">sEMG 包络（左轴，归一化 0–1）× 膝角（右轴，0–150°）· 滚动窗口 10 秒 · 30Hz</p>
  </div>

  <div class="screen-chips">
    <span class="ku-chip sim" id="scr-chip">SIMULATED · 模拟实时流</span>
    <span class="rec-dot" aria-hidden="true"></span><span class="rec-txt">REC</span>
  </div>

  <div class="stat-grid">
    <div class="stat-card"><span class="k">sEMG 包络</span><span class="v" id="st-emg">0<small> %</small></span></div>
    <div class="stat-card"><span class="k">膝角 Knee</span><span class="v" id="st-knee">0<small> °</small></span></div>
    <div class="stat-card"><span class="k">对称度 Sym</span><span class="v" id="st-sym">0<small> %</small></span></div>
    <div class="stat-card"><span class="k">质量分 Q</span><span class="v" id="st-qlt">0</span></div>
  </div>

  <div class="screen-canvas-wrap sim-skin" id="scr-wrap">
    <canvas class="screen-canvas" id="scr-canvas" role="img" aria-label="实时曲线：sEMG 模拟包络与膝角双通道，滚动窗口 10 秒"></canvas>
    <div class="sim-stripes" id="scr-stripes" aria-hidden="true"></div>
    <div class="signal-lost" id="scr-lost">信号中断 · SIGNAL LOST</div>
  </div>

  <div class="legend-row" style="margin-top:10px">
    <span class="lg"><i></i>sEMG（左轴）</span>
    <span class="lg"><i class="dash"></i>膝角（右轴）</span>
    <span class="lg muted">纵轴固定域 · 诚实缩放</span>
  </div>

  <div class="screen-actions">
    <button class="btn ghost" id="scr-live" hidden>连接串口 LIVE</button>
    <button class="btn ghost" id="scr-drop">演示断流 3s</button>
  </div>
  <p class="screen-foot">串口协议：115200 baud，行如「A0:0.42 A1:96」（A0=sEMG 0–1 或 0–1023，A1=膝角度）· 不支持 Web Serial 的浏览器自动隐藏 LIVE 按钮，保持模拟流。</p>
  <p class="screen-foot">说明：演示流为模拟包络；测量值用于动作与支撑判断，不代表关节内部压力。</p>`;

  const cv = root.querySelector('#scr-canvas');
  const wrap = root.querySelector('#scr-wrap');
  const chip = root.querySelector('#scr-chip');
  const stripes = root.querySelector('#scr-stripes');
  const lost = root.querySelector('#scr-lost');
  const st = {
    emg: root.querySelector('#st-emg'), knee: root.querySelector('#st-knee'),
    sym: root.querySelector('#st-sym'), qlt: root.querySelector('#st-qlt'),
  };

  const state = {
    mode: 'sim',            // 'sim' | 'live'
    buf: [],                // {t, emg, knee}，t=相对秒
    clock: 0,               // 采样时钟（相对秒）
    lastFeed: performance.now(),
    lastDraw: 0, lastStat: 0,
    dropUntil: 0,
    port: null, reader: null,
    raf: 0, dead: false,
  };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function push(emg, knee) {
    state.clock += 1 / SAMPLE_HZ;
    state.buf.push({ t: state.clock, emg: clamp(emg, 0, 1), knee: clamp(knee, 0, 150) });
    if (state.buf.length > CAP + 30) state.buf.splice(0, state.buf.length - CAP);
    state.lastFeed = performance.now();
  }

  // 模拟源：0.25Hz 节律收缩包络 + 慢波膝角
  function simTick() {
    const t = state.clock;
    const burst = Math.pow(Math.max(0, Math.sin(t * Math.PI * 0.5)), 3);
    const emg = clamp(0.06 + burst * (0.5 + 0.28 * Math.sin(t * 0.7)) + (Math.random() - 0.5) * 0.06, 0, 1);
    const knee = 100 + 34 * Math.sin(t * Math.PI / 4 - 0.6) + (Math.random() - 0.5) * 2;
    push(emg, knee);
  }

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 640, h = cv.clientHeight || 280;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const mL = 40, mR = 44, mT = 14, mB = 20;
    const x0 = mL, x1 = w - mR, ph = h - mT - mB;
    const tNow = state.buf.length ? state.buf[state.buf.length - 1].t : 0;
    const px = t => x1 - (tNow - t) * ((x1 - x0) / WINDOW_S);
    const yL = v => mT + ph - ph * v;          // 左轴 0–1
    const yR = v => mT + ph - ph * (v / 150);  // 右轴 0–150°

    // 网格 + 双轴刻度
    ctx.font = '10px ' + tok('--font-mono');
    ctx.strokeStyle = tok('--line'); ctx.fillStyle = tok('--muted'); ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i++) {
      const y = Math.round(yL(i / 2)) + .5;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(['0', '0.5', '1.0'][i], x0 - 6, y + 3);
    }
    [0, 50, 100, 150].forEach(v => {
      ctx.textAlign = 'left'; ctx.fillText(v + '°', x1 + 6, yR(v) + 3);
    });
    for (let s = 0; s <= WINDOW_S; s++) {
      const x = Math.round(px(tNow - s)) + .5;
      ctx.strokeStyle = tok('--line');
      ctx.beginPath(); ctx.moveTo(x, mT); ctx.lineTo(x, mT + ph); ctx.stroke();
    }

    const visible = state.buf.filter(p => p.t >= tNow - WINDOW_S - 0.2);
    // sEMG（accent 2px 实线）
    ctx.strokeStyle = tok('--accent'); ctx.lineWidth = 2;
    ctx.beginPath();
    visible.forEach((p, i) => i ? ctx.lineTo(px(p.t), yL(p.emg)) : ctx.moveTo(px(p.t), yL(p.emg)));
    ctx.stroke();
    // 膝角（warn 1.5px 虚线）
    ctx.save();
    ctx.strokeStyle = tok('--warn'); ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    visible.forEach((p, i) => i ? ctx.lineTo(px(p.t), yR(p.knee)) : ctx.moveTo(px(p.t), yR(p.knee)));
    ctx.stroke();
    ctx.restore();

    // 断流检测：>1.5s 无新样本 → 冻结 + 灰字，不假装继续
    const starving = now - state.lastFeed > 1500;
    lost.classList.toggle('show', starving);
    if (now - state.lastStat > 100) {
      state.lastStat = now;
      const last = state.buf[state.buf.length - 1] || { emg: 0, knee: 0 };
      const t = state.clock;
      st.emg.innerHTML = `${Math.round(last.emg * 100)}<small> %</small>`;
      st.knee.innerHTML = `${Math.round(last.knee)}<small> °</small>`;
      st.sym.innerHTML = `${Math.round(93 + 4 * Math.sin(t * 0.31))}<small> %</small>`;
      st.qlt.textContent = String(Math.round(80 + 5 * Math.sin(t * 0.17)));
    }
  }

  let acc = 0, prev = performance.now();
  function loop(now) {
    if (state.dead) return;
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    const feeding = state.mode === 'live' || now >= state.dropUntil;
    if (feeding && state.mode === 'sim') {
      acc += dt;
      while (acc >= 1 / SAMPLE_HZ) { simTick(); acc -= 1 / SAMPLE_HZ; }
    }
    if (!reduced || now - state.lastDraw > 1000) { draw(now); state.lastDraw = now; }
    state.raf = requestAnimationFrame(loop);
  }
  state.raf = requestAnimationFrame(loop);

  function setMode(live) {
    state.mode = live ? 'live' : 'sim';
    wrap.classList.toggle('sim-skin', !live);
    stripes.style.display = live ? 'none' : '';
    chip.className = 'ku-chip ' + (live ? 'live' : 'sim');
    chip.textContent = live ? 'LIVE · 串口实时流' : 'SIMULATED · 模拟实时流';
  }

  // ---- Web Serial 接入口（115200，解析 A0/A1）----
  let serialSupported = false;
  try { serialSupported = 'serial' in navigator; } catch { serialSupported = false; }
  const liveBtn = root.querySelector('#scr-live');
  if (serialSupported) liveBtn.hidden = false;

  liveBtn.addEventListener('click', async () => {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      state.port = port;
      const decoder = new TextDecoder();
      const reader = port.readable.getReader();
      state.reader = reader;
      let text = '';
      setMode(true);
      const onDisconnect = () => { try { setMode(false); } catch {} };
      navigator.serial.addEventListener('disconnect', onDisconnect);
      state.offDisconnect = () => navigator.serial.removeEventListener('disconnect', onDisconnect);
      while (true) {
        const { value, done } = await reader.read();
        if (done || state.dead) break;
        text += decoder.decode(value, { stream: true });
        const lines = text.split('\n');
        text = lines.pop() || '';
        for (const line of lines) {
          const a0 = line.match(/A0[:=\s]+([\d.]+)/i);
          const a1 = line.match(/A1[:=\s]+([\d.]+)/i);
          if (a0) {
            const raw = parseFloat(a0[1]);
            const emg = raw <= 1 ? raw : raw / 1023;
            const knee = a1
              ? clamp((parseFloat(a1[1]) <= 150 ? parseFloat(a1[1]) : parseFloat(a1[1]) / 1023 * 150), 0, 150)
              : 100 + 34 * Math.sin(state.clock * Math.PI / 4 - 0.6);
            push(emg, knee);
          }
        }
      }
    } catch (e) {
      console.warn('[screen] serial 不可用，回退模拟流', e);
      setMode(false);
    }
  });

  root.querySelector('#scr-drop').addEventListener('click', () => {
    state.dropUntil = performance.now() + 3000; // 模拟断流 3s：曲线冻结 + 「信号中断」
  });

  return () => {
    state.dead = true;
    cancelAnimationFrame(state.raf);
    try { state.reader && state.reader.cancel(); } catch {}
    try { state.port && state.port.close(); } catch {}
    try { state.offDisconnect && state.offDisconnect(); } catch {}
  };
}
