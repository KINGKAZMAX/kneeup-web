// demo-bind.js — #demo 区绑定（W2）：live/sim 双入口 + 四触发器兜底 + 游戏挂载
// DOM id 严格按 CONTRACT §「DOM id 契约」；骨架/膝角/滞回计数逻辑照抄已验证的
// meniscus-shield-demo/js/main.js（路径换 vendor 离线）；配色只取 tokens 变量。
// 四触发器（任一 → 自动切 sim，#ku-chip 切 .sim，不再自动切回）：
//   ① getUserMedia 拒绝/不支持  ② 模型加载失败或 6s 总超时（mp-loader 内置）
//   ③ live 启动后 10s 无人入镜（髋/膝 visibility<0.5）  ④ NotReadable|NotFound（占用/无设备）

import { loadPoseLandmarker } from './ai/mp-loader.js';
import { createSimSource } from './ai/sim-source.js';
import { createBleSource, bleSupported } from './ai/ble-source.js';
import { LM, LOWER_LIMB_EDGES, kneeAngle, MedianBuffer, symmetry } from './ai/pose-engine.js';
import { mountGame } from './game/game.js';

const $id = id => document.getElementById(id);
const video = $id('ku-video'), canvas = $id('ku-overlay');
const ctx = canvas.getContext('2d');
const chip = $id('ku-chip'), cueBox = $id('ku-cues');
const hintEl = video.closest('.stage')?.querySelector('.stage-hint') ?? null;

/* game.css 由本模块按需注入（index.html 头部为 W1 所有，不越界改标记） */
if (!document.querySelector('link[href$="game.css"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/game.css', import.meta.url).href;
  document.head.appendChild(link);
}

/* ── 状态 ── */
let mode = 'idle';            // idle | live | sim
let starting = false;
let landmarker = null, stream = null;
let liveRaf = 0, simRaf = 0, lastVideoTime = -1;
let liveArmedTs = 0, lastPersonTs = 0, lastFrameTs = 0;
let currentFrame = null;      // 供游戏 driver 拉取
const bufL = new MedianBuffer(5), bufR = new MedianBuffer(5); // 中值平滑（照抄旧 demo 滑窗 n=5）
const simSource = createSimSource();  // 正弦膝角 90↔170°、3s/rep、source:'simulated'
const qRoll = [];             // 质量分滚动均值
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ── 指标/提示流 ── */
const setText = (id, v) => { const el = $id(id); if (el) el.textContent = v; };

let lastCueAt = 0, lastCueKey = '';
function cue(key, text, { force = false } = {}) {
  const now = performance.now();
  if (!force) {
    if (now - lastCueAt < 1200) return;               // 提示流最小间隔
    if (key === lastCueKey && now - lastCueAt < 8000) return; // 同键去重
  }
  lastCueAt = now; lastCueKey = key;
  const p = document.createElement('p');
  p.className = 'muted'; p.textContent = text;
  cueBox.prepend(p);
  while (cueBox.children.length > 6) cueBox.lastChild.remove();
}

function setChip(live) {
  chip.className = 'ku-chip ' + (live ? 'live' : 'sim');
  chip.textContent = live ? 'LIVE · 实时' : 'SIMULATED · 模拟';
}
function setHint(state) {
  if (!hintEl) return;
  if (state === 'live') hintEl.style.display = 'none';
  else if (state === 'ble') {
    hintEl.style.display = '';
    hintEl.querySelector('p').innerHTML =
      'LIVE · BLE 护具直连<br><span class="muted">膝角来自实机传感（本通道无摄像头画面）</span>';
  }
  else {
    hintEl.style.display = '';
    hintEl.querySelector('p').innerHTML =
      'SIMULATED · 模拟演示<br><span class="muted">正弦膝角脚本驱动同一套计分管线（非实时画面）</span>';
  }
}

/* 共享发布：两通道同管线（角度 → 指标 → 游戏帧） */
let prevMin = null, prevMinTs = 0;
function publish(frame) {
  currentFrame = frame;
  const { angleL: L, angleR: R } = frame;
  setText('ku-lk', L != null ? `${Math.round(L)}°` : '—');
  setText('ku-rk', R != null ? `${Math.round(R)}°` : '—');
  if (L != null && R != null) {
    setText('ku-sym', `${Math.round(symmetry(L, R))}%`);
    formCues(Math.min(L, R), Math.abs(L - R), frame.ts);
  } else setText('ku-sym', '—');
}

/* 规则化提示流（提示为准，不涉疾病语义） */
function formCues(min, absDiff, ts) {
  const dt = prevMinTs ? (ts - prevMinTs) / 1000 : 0;
  const vel = dt > 0 && prevMin != null ? (min - prevMin) / dt : 0; // deg/s，负=下蹲
  prevMin = min; prevMinTs = ts;
  const sym = 100 - absDiff / 60 * 100; // 与 symmetry() 同式
  if (vel < -140 && min > 105) cue('slow', '下放慢一点 · Slow the descent');
  else if (vel < -25 && min < 150 && min > 100) cue('track', '膝盖对准脚尖 · Knees track over toes');
  if (absDiff > 10) cue('shift', '重心略偏 · Even out your weight');
  else if (sym >= 93 && min < 155 && min > 95) cue('goodsym', '对称度很好，保持 · Good symmetry — hold it');
}

/* ── 骨架叠加（照抄旧 demo 双 pass 描边；色取 tokens：--accent=#4376EB） ── */
function drawOverlay(lm) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h || !lm) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.clearRect(0, 0, w, h);
  const accent = cssVar('--accent') || '#4376EB';
  const vis = i => (lm[i]?.visibility ?? 0) > 0.5;
  for (const [alpha, lw] of [[0.33, 5], [1, 2]]) {   // pass1 宽淡=光晕，pass2 窄亮=主线
    ctx.globalAlpha = alpha; ctx.strokeStyle = accent; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of LOWER_LIMB_EDGES) {
      if (!vis(a) || !vis(b)) continue;
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = cssVar('--ink') || '#FFFFFF';       // 膝点白圆（照抄旧 demo）
  for (const k of [LM.L_KNEE, LM.R_KNEE]) {
    const p = lm[k];
    if (!p || !vis(k)) continue;
    ctx.beginPath(); ctx.arc(p.x * w, p.y * h, Math.max(6, w * 0.007), 0, 7); ctx.fill();
  }
}
const clearOverlay = () => ctx.clearRect(0, 0, canvas.width, canvas.height);

/* ── live 管线 ── */
function liveTick() {
  liveRaf = requestAnimationFrame(liveTick);
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  let lm = null;
  try { lm = landmarker.detectForVideo(video, performance.now())?.landmarks?.[0] ?? null; }
  catch { /* 单帧检测失败容忍，下一帧重试 */ }
  handleLandmarks(lm);
}
function handleLandmarks(lm) {
  const now = performance.now();
  const vis = i => (lm?.[i]?.visibility ?? 0) > 0.5;
  const okL = vis(LM.L_HIP) && vis(LM.L_KNEE) && vis(LM.L_ANKLE);
  const okR = vis(LM.R_HIP) && vis(LM.R_KNEE) && vis(LM.R_ANKLE);
  const L = okL ? bufL.push(kneeAngle(lm[LM.L_HIP], lm[LM.L_KNEE], lm[LM.L_ANKLE])) : (bufL.clear(), null);
  const R = okR ? bufR.push(kneeAngle(lm[LM.R_HIP], lm[LM.R_KNEE], lm[LM.R_ANKLE])) : (bufR.clear(), null);
  const person = vis(LM.L_HIP) && vis(LM.R_HIP) && (okL || okR);
  if (person) lastPersonTs = now;
  else if (now - lastPersonTs > 1500) cue('frame', '请全身入镜（髋、膝可见） · Stand so your full body is in frame');
  if (lm) drawOverlay(lm); else clearOverlay();
  publish({ ts: now, angleL: L, angleR: R, visibility: person ? 1 : 0, source: 'live', landmarks: lm });
  // 触发器③：10s 无人入镜（visibility<0.5）
  if (now - Math.max(liveArmedTs, lastPersonTs) > 10000) {
    fallbackToSim('10 秒未检测到人体入镜');
  }
}

/* ── sim 管线（同 publish 管线，无模型依赖，C4 §五 洞2） ── */
let lastSimLoop = 0;
function simTick(now) {
  simRaf = requestAnimationFrame(simTick);
  if (now - lastSimLoop < 33) return; // 30fps
  lastSimLoop = now;
  const f = simSource.frame();
  if (f) publish(f);
}

/* ── 切换与兜底 ── */
function stopLoops() { cancelAnimationFrame(liveRaf); cancelAnimationFrame(simRaf); cancelAnimationFrame(bleRaf); liveRaf = simRaf = bleRaf = 0; }
function stopCamera() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null; video.srcObject = null;
}
function startSim(reason) {
  stopLoops(); stopCamera();
  mode = 'sim'; setChip(false); setHint('sim'); clearOverlay();
  bufL.clear(); bufR.clear();
  simSource.start();
  simRaf = requestAnimationFrame(simTick);
  cue('sim', `${reason} · 已切换 SIMULATED 演示（不会自动切回）`, { force: true });
}
function fallbackToSim(reason) {
  if (mode !== 'live') return;
  startSim(reason);
}
function describeErr(err) {
  const name = err?.name || '';
  if (String(err?.message || '').startsWith('[mp-loader]')) return '姿态模型加载失败或超时（6s 总预算）';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return '摄像头权限被拒';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '未找到可用摄像头';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '摄像头被占用或不可读';
  if (name === 'NotSupported' || !navigator.mediaDevices?.getUserMedia) return '当前浏览器不支持摄像头采集';
  return `摄像头启动失败（${name || '未知错误'}）`;
}

async function startLive() {
  if (mode === 'live' || starting) return;
  starting = true;
  const wasSim = mode === 'sim';
  stopLoops();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupported' });
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    video.srcObject = stream;
    video.playsInline = true; video.muted = true; video.autoplay = true; // iOS 必需三件套
    await video.play();
    cue('loading', '摄像头已连接 · 正在加载本地姿态模型（预算 6s）…', { force: true });
    landmarker = await loadPoseLandmarker(); // GPU→CPU→超时 reject（触发器②在此抛出）
    mode = 'live'; setChip(true); setHint('live');
    bufL.clear(); bufR.clear(); prevMin = null;
    lastVideoTime = -1; liveArmedTs = lastPersonTs = performance.now();
    liveRaf = requestAnimationFrame(liveTick);
    cue('live', 'LIVE · 画面仅在浏览器内计算，不上传', { force: true });
  } catch (err) {
    const reason = describeErr(err);
    if (wasSim) { // 手动重试 live 失败：续跑模拟，不打断演示
      if (!simRaf) simRaf = requestAnimationFrame(simTick);
      cue('sim', `${reason} · 已继续 SIMULATED 演示`, { force: true });
    } else {
      startSim(reason);
    }
  } finally { starting = false; }
}

/* ── 游戏挂载（driver 可接 live 或 sim） ── */
mountGame($id('ku-game'), {
  getFrame: () => currentFrame,
  onRep: (ev, info) => {
    setText('ku-reps', String(info.qualified));
    if (info.quality != null && Number.isFinite(info.quality)) {
      qRoll.push(info.quality);
      if (qRoll.length > 50) qRoll.shift();
      setText('ku-ql', String(Math.round(qRoll.reduce((s, v) => s + v, 0) / qRoll.length)));
    }
    cue(ev.shallow ? 'shallow' : `rep-${info.qualified}`,
      ev.shallow
        ? `第 ${info.qualified} 次 · 谷底 ${Math.round(ev.depth)}°，略浅，再低一点`
        : `第 ${info.qualified} 次 · 谷底 ${Math.round(ev.depth)}° · 质量 ${info.quality ?? '—'}${info.perfect ? ' · PERFECT' : ''}${info.combo >= 2 ? ' · 连击×2' : ''}`,
      { force: true });
  },
});

/* ── BLE 管线（Web Bluetooth NUS,实机 LIVE;断开自动回退 sim) ── */
let bleRaf = 0;
const bleSource = createBleSource({
  onState(s) {
    if (s === 'closed' && mode === 'ble') startSim('BLE 连接已断开，自动回退模拟演示');
  },
});
function bleTick() {
  bleRaf = requestAnimationFrame(bleTick);
  const f = bleSource.getFrame();
  if (f) publish(f);
}
function describeBleErr(err) {
  const name = err?.name || '';
  if (name === 'NotSupported') return '当前浏览器不支持 Web Bluetooth（请用桌面或 Android Chrome）';
  if (name === 'SecurityError') return 'BLE 需由用户手势触发';
  if (name === 'NotFoundError') return '未发现护具设备（确认护具已开机广播）';
  return `BLE 连接失败（${name || '未知错误'}）`;
}
async function startBle() {
  if (mode === 'ble' || starting) return;
  starting = true;
  const wasSim = mode === 'sim';
  stopLoops();
  try {
    await bleSource.start();               // requestDevice 必须在本点击手势内
    stopCamera(); clearOverlay();
    mode = 'ble'; setChip(true); chip.textContent = 'LIVE · BLE 实时';
    setHint('ble');
    bleRaf = requestAnimationFrame(bleTick);
    cue('ble', `LIVE · BLE 已连接${bleSource.deviceName ? ' ' + bleSource.deviceName : ''}`, { force: true });
  } catch (err) {
    const cancelled = err?.name === 'NotFoundError' && /cancel/i.test(err?.message || '');
    if (cancelled) {
      // 用户取消设备选择：不打断当前通道
      if (wasSim) simRaf = requestAnimationFrame(simTick);
      cue('ble-cancel', '已取消 BLE 设备选择', { force: true });
    } else if (wasSim) {
      simRaf = requestAnimationFrame(simTick);
      cue('ble-fail', `${describeBleErr(err)} · 已继续 SIMULATED 演示`, { force: true });
    } else {
      startSim(describeBleErr(err));
    }
  } finally { starting = false; }
}

/* ── 入口 ── */
$id('ku-start-live').addEventListener('click', () => { startLive(); });
$id('ku-start-sim').addEventListener('click', () => { startSim('手动选择模拟演示'); });
{
  const bleBtn = $id('ku-start-ble');
  if (bleBtn) {
    if (!bleSupported()) {
      bleBtn.disabled = true;
      bleBtn.title = '当前浏览器不支持 Web Bluetooth · 请用桌面或 Android Chrome';
      bleBtn.textContent = 'BLE 不可用 · 需桌面/Android Chrome';
    } else {
      bleBtn.addEventListener('click', () => { startBle(); });
    }
  }
}
setText('ku-reps', '0');
