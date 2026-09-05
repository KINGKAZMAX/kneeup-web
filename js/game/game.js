// game.js — 「膝望升空 KNEE-UP LIFT」薄版（C4 §三裁剪清单 + K7 §三/§四）
// 膝角入训练目标带（plan.v1，默认 100-140°）→ 充能；合格 rep → 飞艇升一格；
// 连击 ×2；plan.sets 组完成 → 冲线结算。安全：<80° / >185° 两次 → danger + 暂停；
// 自评 0-10（≥4 建议结束本组）。结算写 sessions.v1（CONTRACT schema，source 跟通道）。
// 接口：mountGame(el, driver)，driver = { getFrame()→frame|null, onRep?(ev, info) }，
// frame = { ts, angleL, angleR|null, visibility, source:'live'|'simulated', landmarks }。
// UI 文案只用「训练/动作质量/自评」口径；#E5544B/#F0B34E 仅安全语义（经 tokens 变量引用）。

import { RepCounter, symmetry, qualityScore, clamp } from '../ai/pose-engine.js';
import { store } from '../store.js';

const ARC_MIN = 60, ARC_MAX = 190;          // 目标弧量程（度）
const RED_DEEP = 80, RED_EXT = 185;         // 红线：过深 / 过伸（CONTRACT 安全语义）
const REDLINE_PAUSE_AT = 2;                 // 两次红线 → 自动安全暂停
const PAIN_STOP_AT = 4;                     // 自评 ≥4 → 建议结束本组
const CENTER_TOL = 5;                       // 中心带 ±5° = PERFECT（D3 §二）
const LOOP_MS = 33;                         // 30fps 节流（D3 §七）
const CHARGE_FULL_MS = 1500;                // 带内充能到满的时长

const $ = (sel, root) => root.querySelector(sel);
const pctOf = deg => clamp((ARC_MAX - deg) / (ARC_MAX - ARC_MIN), 0, 1) * 100; // 角度→弧道百分比（上=伸直）
const fmtMs = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function normalizePlan(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const band = Array.isArray(p.band) && p.band.length === 2 ? p.band.map(Number) : [100, 140];
  return {
    sets: clamp(Math.round(p.sets ?? 3), 1, 10),
    reps: clamp(Math.round(p.reps ?? 3), 1, 30),
    band: [Math.min(band[0], band[1]), Math.max(band[0], band[1])],
  };
}

export function mountGame(el, driver) {
  if (!el || !driver || typeof driver.getFrame !== 'function') return null;
  const plan = normalizePlan(store.get('plan.v1'));
  const total = plan.sets * plan.reps;
  const center = (plan.band[0] + plan.band[1]) / 2;

  el.innerHTML = `
  <div class="kug">
    <div class="kug-top">
      <span class="kug-title">膝望升空 <span class="en">KNEE-UP LIFT</span></span>
      <span class="kug-state" data-role="state">SIMULATED</span>
      <span class="kug-note" data-role="plan">Plan 默认 · ${plan.sets}组×${plan.reps}次 · 目标带 ${plan.band[0]}-${plan.band[1]}°</span>
    </div>
    <div class="kug-main">
      <div class="kug-left">
        <div class="kug-baseline" data-role="baseline">Stand in frame · 站入画框…</div>
        <div class="kug-arc" data-role="arc">
          <div class="kug-zone" data-role="zone"></div>
          <div class="kug-perfect" data-role="perfect"></div>
          <div class="kug-red" data-role="redDeep"></div>
          <div class="kug-red" data-role="redExt"></div>
          <div class="kug-ptr" data-role="ptr" data-a="—"></div>
          <span class="lbl" style="top:2%">${ARC_MAX}</span>
          <span class="lbl" style="bottom:2%">${ARC_MIN}</span>
        </div>
        <div class="kug-charge-lbl">CHARGE 充能</div>
        <div class="kug-charge" data-role="charge"><i></i></div>
      </div>
      <div class="kug-right">
        <div class="kug-track" data-role="track">
          <div class="kug-finish"><span>FINISH 冲线</span></div>
          <div class="kug-cloud" style="top:30%"></div>
          <div class="kug-cloud" style="top:58%; left:70%"></div>
          <div class="kug-ship" data-role="ship"></div>
          <div class="kug-alert" data-role="alert"></div>
          <div class="kug-ovl" data-role="ovl"></div>
        </div>
      </div>
    </div>
    <div class="kug-bar">
      <span>REPS <b class="num" data-role="reps">0/${total}</b></span>
      <span>SET <b data-role="set">1/${plan.sets}</b></span>
      <span>COMBO <b class="kug-combo" data-role="combo">×0</b></span>
      <span>SCORE <b class="num" data-role="score">0</b></span>
      <span class="kug-spacer"></span>
      <span class="kug-painrow" data-role="painrow" title="自评 SELF-REPORT 0-10"></span>
      <button class="kug-btn" data-role="pause" type="button">暂停 ⏸</button>
    </div>
  </div>`;

  const ui = {};
  el.querySelectorAll('[data-role]').forEach(n => { ui[n.dataset.role] = n; });

  const S = freshState();
  function freshState() {
    return {
      phase: 'idle',            // idle | run | paused | safe | done
      source: 'simulated',
      set: 1, qualified: 0, score: 0, combo: 0, maxCombo: 0, perfect: 0,
      charge: 0, baseline: null, baselineN: 0,
      symSum: 0, symN: 0, qualitySum: 0, qualityN: 0, peakL: 180, peakR: 180,
      redlines: 0, voidPending: false, pain: null, painAsked: false,
      safetyEvents: [], tsStart: null, sessionWritten: false,
      lastT: 0, alertTimer: 0,
    };
  }
  const counter = new RepCounter(); // CONTRACT 默认：DOWN<100 / UP>160 / 谷底≥400ms

  /* ── 静态刻度：目标带 / PERFECT 中心带 / 红线区 / 升格缺口 ── */
  const setBand = (node, lo, hi) => {
    const top = pctOf(hi), bot = pctOf(lo);
    node.style.top = top + '%'; node.style.height = (bot - top) + '%';
  };
  setBand(ui.zone, plan.band[0], plan.band[1]);
  setBand(ui.perfect, center - CENTER_TOL, center + CENTER_TOL);
  setBand(ui.redDeep, ARC_MIN, RED_DEEP);
  setBand(ui.redExt, RED_EXT, ARC_MAX);
  for (let i = 1; i <= total; i++) {
    const n = document.createElement('i');
    n.className = 'kug-notch'; n.dataset.rep = String(i);
    n.style.bottom = `calc(8px + ${(i / total).toFixed(4)} * (100% - 60px))`;
    ui.track.appendChild(n);
  }
  for (let v = 0; v <= 10; v++) {
    const b = document.createElement('button');
    b.className = 'kug-btn'; b.type = 'button'; b.textContent = v;
    b.addEventListener('click', () => onPain(v));
    ui.painrow.appendChild(b);
  }

  /* ── 渲染 ── */
  function renderState() {
    const map = { idle: 'SIMULATED', run: S.source === 'live' ? 'LIVE' : 'SIMULATED', paused: 'PAUSED', safe: 'SAFE', done: 'DONE' };
    ui.state.textContent = map[S.phase] ?? '—';
    ui.state.className = 'kug-state ' + (S.phase === 'run' && S.source === 'live' ? 'live' : S.phase === 'paused' ? 'paused' : S.phase === 'safe' ? 'safe' : '');
    ui.reps.textContent = `${S.qualified}/${total}`;
    ui.set.textContent = `${S.set}/${plan.sets}`;
    ui.combo.textContent = `×${S.combo}`;
    ui.score.textContent = S.score.toLocaleString('en-US');
  }
  const renderProgress = () => {
    const p = clamp(S.qualified / total, 0, 1);
    ui.ship.style.setProperty('--prog', p.toFixed(4));
    const c = S.charge.toFixed(3);
    ui.charge.style.setProperty('--charge', c);   // 充能条
    ui.track.style.setProperty('--charge', c);    // 飞艇尾焰亮度
    ui.track.querySelectorAll('.kug-notch').forEach(n => n.classList.toggle('hit', +n.dataset.rep <= S.qualified));
  };
  function flashAlert(text, danger = false, ms = 2600) {
    ui.alert.textContent = text;
    ui.alert.className = 'kug-alert show' + (danger ? ' danger' : '');
    clearTimeout(S.alertTimer);
    S.alertTimer = setTimeout(() => { ui.alert.className = 'kug-alert' + (danger ? ' danger' : ''); }, ms);
  }

  /* ── 弹层 ── */
  function overlay(html) { ui.ovl.innerHTML = `<div class="kug-card">${html}</div>`; ui.ovl.classList.add('show'); }
  const hideOverlay = () => ui.ovl.classList.remove('show');

  function interSetOverlay(doneSet) {
    S.phase = 'paused'; renderState();
    overlay(`<h3>第 ${doneSet} 组完成 · Set done</h3>
      <p>已合格 ${S.qualified}/${total} 次。休息片刻，准备好再继续。</p>
      <div class="kug-cta"><button class="kug-btn solid" data-act="next" type="button">继续下一组 · Next set</button></div>`);
  }
  function safetyOverlay() {
    S.phase = 'safe'; renderState();
    ui.track.classList.add('danger');
    overlay(`<h3>已自动暂停 · Safety pause</h3>
      <p>连续两次超出安全角度范围，充能已冻结。请先休息，感觉良好再继续。</p>
      <div class="kug-cta"><button class="kug-btn solid" data-act="resume" type="button">我已休息，继续</button>
      <button class="kug-btn warn" data-act="finish" type="button">结束并结算</button></div>`);
  }
  function painOverlay(v) {
    S.phase = 'paused'; renderState();
    overlay(`<h3>自评 ${v}/10 · 建议结束本组</h3>
      <p>如有不适请立即停止。今天的状态比次数重要。</p>
      <div class="kug-cta"><button class="kug-btn solid" data-act="finish" type="button">结束并结算</button>
      <button class="kug-btn" data-act="resume" type="button">继续本组</button></div>`);
  }
  function summary(win) {
    S.phase = 'done'; renderState();
    if (win) ui.track.classList.add('win');
    writeSession(win);
    const symAvg = S.symN ? Math.round(S.symSum / S.symN) : 0;
    const perfPct = S.qualified ? Math.round(S.perfect / S.qualified * 100) : 0;
    const deepest = Math.min(S.peakL, S.peakR);
    overlay(`
      <p class="kug-sum-line">${win ? '<span class="ok">✓</span> SESSION COMPLETE · 训练完成' : 'SESSION ENDED · 已结束'}</p>
      <div class="kug-bigs">
        <div class="kug-big"><div class="v">${S.score.toLocaleString('en-US')}</div><div class="k">SCORE 总分</div></div>
        <div class="kug-big"><div class="v">${perfPct}%</div><div class="k">PERFECT 完美率</div></div>
        <div class="kug-big"><div class="v">${symAvg}%</div><div class="k">SYMMETRY 对称度</div></div>
        <div class="kug-big"><div class="v">${S.qualified}/${total}</div><div class="k">REPS 次数</div></div>
      </div>
      <p class="kug-sub">用时 ${S.tsStart ? fmtMs(Date.now() - S.tsStart) : '—'} · 最大连击 ×${S.maxCombo} · 红线 ${S.redlines} 次</p>
      <p class="kug-insight">最佳连击 ×${S.maxCombo}；本局对称度均值 ${symAvg}%${S.qualified ? `，最深膝角 ${Math.round(deepest)}°` : ''}。以上均为本局实测数据。</p>
      <div class="kug-cta"><button class="kug-btn solid" data-act="restart" type="button">再来一次</button>
      <button class="kug-btn" data-act="close" type="button">收起</button></div>`);
  }

  ui.ovl.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    hideOverlay();
    if (act === 'next') { S.phase = 'run'; }
    else if (act === 'resume') { S.phase = 'run'; ui.track.classList.remove('danger'); }
    else if (act === 'finish') { summary(false); }
    else if (act === 'restart') { restart(); }
    else if (act === 'close') { S.phase = 'done'; } // 收起结算卡，游戏停在完成态（不再计数）
    renderState();
  });
  ui.pause.addEventListener('click', () => {
    if (S.phase === 'run') {
      S.phase = 'paused'; renderState();
      overlay(`<h3>已暂停 · Paused</h3><p>膝角数据暂停处理，随时继续。</p>
        <div class="kug-cta"><button class="kug-btn solid" data-act="resume" type="button">继续</button>
        <button class="kug-btn" data-act="finish" type="button">结束并结算</button></div>`);
    }
  });

  function onPain(v) {
    S.pain = v;
    ui.painrow.querySelectorAll('.kug-btn').forEach(b => b.classList.toggle('on', +b.textContent === v));
    if (v >= PAIN_STOP_AT && S.phase !== 'done') {
      S.safetyEvents.push({ t: S.tsStart ? Math.round((Date.now() - S.tsStart) / 1000) : 0, type: 'pain', value: v });
      painOverlay(v);
    } else if (S.phase === 'run') {
      flashAlert(`自评 ${v}/10 已记录`, false, 1800);
    }
  }

  function restart() {
    el.querySelectorAll('.kug-notch').forEach(n => n.classList.remove('hit'));
    ui.track.classList.remove('win', 'danger');
    Object.assign(S, freshState());
    counter.reset();
    renderState(); renderProgress();
  }

  /* ── sessions.v1 写入（CONTRACT schema；source 跟通道） ── */
  function writeSession(win) {
    if (S.sessionWritten || !S.tsStart) return;
    S.sessionWritten = true;
    const flag = S.redlines >= REDLINE_PAUSE_AT ? 'stop'
      : (S.redlines > 0 || (S.pain ?? 0) >= PAIN_STOP_AT) ? 'caution' : 'none';
    const sessions = store.get('sessions.v1', []);
    sessions.push({
      id: `s-${S.tsStart.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      tsStart: S.tsStart, tsEnd: Date.now(),
      exercise: 'squat',
      inputMode: S.source === 'live' ? 'live' : 'simulated',
      source: S.source,                                    // 通道标记：live | simulated
      counts: { target: total, completed: S.qualified },
      metrics: {
        kneePeakL: Math.round(S.peakL), kneePeakR: Math.round(S.peakR),
        symmetryAvg: S.symN ? Math.round(S.symSum / S.symN) : 0,
        qualityAvg: S.qualityN ? Math.round(S.qualitySum / S.qualityN) : 0,
      },
      subjective: {
        pain: S.pain ?? 0, selfReported: S.pain != null,
        feeling: (S.pain ?? 0) >= PAIN_STOP_AT ? '自评偏高，建议减量' : win ? '完成全部组次' : '本组结束',
      },
      safety: { flag, events: S.safetyEvents },
    });
    store.set('sessions.v1', sessions.slice(-200)); // 上限 200（CONTRACT）
  }

  /* ── 帧处理 ── */
  function handleRep(ev) {
    if (S.voidPending) { S.voidPending = false; flashAlert('该次不计（出安全角度）', false); return; }
    const symNow = S.symN ? S.symSum / S.symN : null;
    const q = qualityScore({ sym: symNow, depth: ev.depth, zone: plan.band, repMs: ev.durationMs });
    if (q != null) { S.qualitySum += q; S.qualityN++; }
    const perfect = Math.abs(ev.depth - center) <= CENTER_TOL;
    if (perfect) S.perfect++;
    S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo);
    const mult = S.combo >= 2 ? 2 : 1;                    // 连击 ×2
    const pts = Math.round(100 * (perfect ? 1.5 : 1) * mult);
    S.score += pts; S.qualified++;
    S.charge = 0;
    flashAlert(`第 ${S.qualified} 次 +${pts}${perfect ? ' · PERFECT' : ''}${mult > 1 ? ' · 连击×2' : ''}`);
    if (ev.shallow) flashAlert('这一蹲略浅，再低一点 · Slightly shallow', false);
    renderProgress(); renderState();
    driver.onRep?.(ev, { quality: q, perfect, combo: S.combo, score: S.score, qualified: S.qualified });
    if (S.qualified % plan.reps === 0) {
      if (S.set >= plan.sets) { ui.ship.style.setProperty('--prog', '1'); summary(true); }
      else { const done = S.set; S.set++; interSetOverlay(done); }
    }
  }

  function processFrame(f, now) {
    S.source = f.source === 'live' ? 'live' : 'simulated';
    if (S.phase === 'run' && S.tsStart === null) S.tsStart = Date.now();
    const L = f.angleL, R = f.angleR;
    if (L != null) S.peakL = Math.min(S.peakL, L);
    if (R != null) S.peakR = Math.min(S.peakR, R);
    const g = L != null && R != null ? Math.min(L, R) : (L ?? R);
    if (g == null) { ui.ptr.style.setProperty('--ptr', '50%'); ui.ptr.dataset.a = '—'; return; }

    if (L != null && R != null) { const s = symmetry(L, R); S.symSum += s; S.symN++; }

    // 指针（角→弧道百分比）
    ui.ptr.style.setProperty('--ptr', pctOf(g).toFixed(2) + '%');
    ui.ptr.dataset.a = Math.round(g) + '°';

    // 基线（K7 §四 15min 版：前 5 帧直立 → 可见锁定状态行）
    if (S.baseline === null) {
      if (g > 160) { if (++S.baselineN >= 5) { S.baseline = g; ui.baseline.textContent = `Baseline locked ✓ 站立基线已锁定 ${Math.round(g)}°`; ui.baseline.classList.add('locked'); } }
      else S.baselineN = 0;
    }

    if (S.phase !== 'run') { S.lastT = now; return; }

    // 充能：入目标带
    const dt = S.lastT ? Math.min(now - S.lastT, 500) : 0; // 暂停/丢帧后 dt 截断，防充能跳变
    S.lastT = now;
    if (g >= plan.band[0] && g <= plan.band[1]) S.charge = clamp(S.charge + dt / CHARGE_FULL_MS, 0, 1);
    renderProgress();

    // 安全红线：<80 过深 / >185 过伸（两次 → danger + 暂停）
    if (g < RED_DEEP || g > RED_EXT) {
      S.redlines++;
      S.safetyEvents.push({ t: S.tsStart ? Math.round((Date.now() - S.tsStart) / 1000) : 0, type: g < RED_DEEP ? 'redline-deep' : 'redline-ext', angle: Math.round(g) });
      S.combo = 0; S.voidPending = true;
      flashAlert(g < RED_DEEP ? '过深 Too deep · 该次不计' : '膝超伸 Hyperextension · 该次不计', true);
      renderState();
      if (S.redlines >= REDLINE_PAUSE_AT) safetyOverlay();
    }

    // 计数（滞回状态机，min(L,R)）
    const ev = counter.update(g, f.ts ?? now);
    if (ev) handleRep(ev);
  }

  /* ── 主循环（30fps 节流） ── */
  let rafId = 0, lastLoop = 0;
  function tick(now) {
    rafId = requestAnimationFrame(tick);
    if (now - lastLoop < LOOP_MS) return;
    lastLoop = now;
    const f = driver.getFrame();
    if (f) { S.phase = S.phase === 'idle' ? 'run' : S.phase; processFrame(f, now); }
    else if (S.phase === 'run') { S.lastT = now; }
    renderState();
  }
  rafId = requestAnimationFrame(tick);

  renderState(); renderProgress();
  return {
    destroy() { cancelAnimationFrame(rafId); clearTimeout(S.alertTimer); el.innerHTML = ''; },
    get state() { return S; },
  };
}
