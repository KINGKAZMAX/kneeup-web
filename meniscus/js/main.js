// MENISCUS SHIELD — Live Knee AI demo
// Built during AIx Origin Summit 2026 (Sep 5). Vision channel = MediaPipe Pose Landmarker (on-device).
import { FilesetResolver, PoseLandmarker, DrawingUtils } from "../../vendor/mp-1014/vision_bundle.mjs";

const L = { hip: 23, knee: 25, ankle: 27 };
const R = { hip: 24, knee: 26, ankle: 28 };

const state = {
  landmarker: null, running: false, lastVideoTime: -1,
  buf: { l: [], r: [] },           // smoothing buffers
  repState: 'up', reps: 0, shallow: 0,
  compFrames: 0, history: [], t0: performance.now(),
};

const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d');

// ---------- math ----------
function angle(a, b, c) { // angle at point b, degrees
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1e-9;
  return Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180 / Math.PI;
}
function median(arr) { const s = [...arr].sort((x, y) => x - y); return s[s.length >> 1]; }
function push(buf, v, n = 5) { buf.push(v); if (buf.length > n) buf.shift(); return median(buf); }
const ema = (prev, v, a = 0.4) => prev == null ? v : a * v + (1 - a) * prev;

// ---------- init ----------
async function init() {
  const fileset = await FilesetResolver.forVisionTasks(
    "../vendor/mp-1014/wasm");
  state.landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "../vendor/mp-1014/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO", numPoses: 1,
  });
}

// ---------- chart ----------
const chart = new Chart($('chart'), {
  type: 'line',
  data: { labels: [], datasets: [
    { label: 'L', data: [], borderColor: '#4376EB', borderWidth: 2, pointRadius: 0, tension: .3 },
    { label: 'R', data: [], borderColor: '#9DB8F7', borderWidth: 2, pointRadius: 0, tension: .3 },
    { label: 'Textile(sim)', data: [], borderColor: '#8B909A', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: .3 },
  ]},
  options: { animation: false, responsive: true, maintainAspectRatio: false,
    scales: { y: { min: 60, max: 185, ticks: { color: '#8B909A', font: { size: 10 } }, grid: { color: '#232428' } },
              x: { ticks: { display: false }, grid: { display: false } } },
    plugins: { legend: { labels: { color: '#8B909A', boxWidth: 10, font: { size: 10 } } } } },
});

// Channel B — simulated textile strain sensor (future hardware feeds the same rules engine over BLE).
// Sinusoid + noise approximates a knee-flexion signal; on the real product this is replaced by
// woven strain gauge readings, which is exactly why the analysis layer is hardware-agnostic.
function textileSim(tSec, refAngle) {
  const base = refAngle ?? 170;
  const squatCycle = 150 - 80 * Math.max(0, Math.sin(tSec / 4)) ** 2; // slow squat-like oscillation
  return squatCycle + (Math.sin(tSec * 7.3) + Math.sin(tSec * 3.1)) * 1.2 + (Math.random() - .5) * .8;
}

// ---------- core loop ----------
function onResults(lm) {
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  drawSkeleton(lm);

  const vis = i => (lm[i]?.visibility ?? 0) > 0.5;
  let lA = null, rA = null;
  if (vis(L.hip) && vis(L.knee) && vis(L.ankle)) lA = push(state.buf.l, angle(lm[L.hip], lm[L.knee], lm[L.ankle]));
  else state.buf.l.length = 0;
  if (vis(R.hip) && vis(R.knee) && vis(R.ankle)) rA = push(state.buf.r, angle(lm[R.hip], lm[R.knee], lm[R.ankle]));
  else state.buf.r.length = 0;

  setMetric('mLeft', lA); setMetric('mRight', rA);

  const min = lA != null && rA != null ? Math.min(lA, rA) : (lA ?? rA);
  const diff = lA != null && rA != null ? Math.abs(lA - rA) : null;
  setMetric('mDiff', diff);

  // compensation warning: >10° for 3 consecutive frames
  if (diff != null && diff > 10) { if (++state.compFrames >= 3) warn('aComp', true, 'orange'); }
  else { state.compFrames = 0; warn('aComp', false); }

  // hip lateral shift (front view): hip midpoint x deviation vs baseline
  if (vis(23) && vis(24)) {
    const cx = (lm[23].x + lm[24].x) / 2;
    state.hipBase ??= cx;
    if (Math.abs(cx - state.hipBase) > 0.05 && min != null && min < 150) warn('aShift', true, 'orange');
    else warn('aShift', false);
  }

  // squat rep detection with hysteresis (170 -> below 95 -> 170)
  if (min != null) {
    if (state.repState === 'up' && min < 95) state.repState = 'down';
    else if (state.repState === 'down' && min > 170) {
      state.repState = 'up'; state.reps++;
      $('mCount').querySelector('.v').textContent = state.reps;
      if (state.lastMin > 110) { state.shallow++; warn('aShallow', true, 'red'); setTimeout(() => warn('aShallow', false), 1600); }
      report();
    }
    if (state.repState === 'down') state.lastMin = Math.min(state.lastMin ?? 999, min);
    else state.lastMin = 999;
  }

  // chart (last 300 samples)
  if (lA != null || rA != null) {
    const t = ((performance.now() - state.t0) / 1000);
    const d = chart.data;
    d.labels.push(t.toFixed(1));
    d.datasets[0].data.push(lA); d.datasets[1].data.push(rA);
    d.datasets[2].data.push(textileSim(t, min));
    if (d.labels.length > 300) { d.labels.shift(); d.datasets.forEach(s => s.data.shift()); }
    chart.update('none');
  }
}

function drawSkeleton(lm) {
  const du = new DrawingUtils(ctx);
  const conn = PoseLandmarker.POSE_CONNECTIONS;
  ctx.globalAlpha = .95;
  du.drawConnectors(lm, conn, { color: '#4376EB55', lineWidth: 5 });
  du.drawConnectors(lm, conn, { color: '#4376EB', lineWidth: 2 });
  for (const set of [L, R]) {
    const p = lm[set.knee];
    if (p && (p.visibility ?? 0) > .5) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, 9, 0, 7); ctx.fill();
    }
  }
}

function setMetric(id, v) {
  const el = $(id), box = el.classList;
  if (v == null) { el.querySelector('.v').textContent = '--'; box.remove('warn', 'bad'); return; }
  el.querySelector('.v').textContent = Math.round(v) + '°';
  box.toggle('warn', id === 'mDiff' && v > 10 && v <= 15);
  box.toggle('bad', id === 'mDiff' && v > 15);
}

function warn(id, on, level) {
  const el = $(id);
  el.classList.toggle('on', on);
  el.classList.toggle('red', on && level === 'red');
}

function report() {
  const el = $('report');
  el.classList.add('on');
  el.innerHTML = `<b>Session Report · 本次训练报告</b><br>
    Reps: <b>${state.reps}</b> · Shallow reps 蹲浅: <b>${state.shallow}</b><br>
    Feedback is based on sagittal knee angle & L/R symmetry. Reference only — not a medical assessment.`;
}

// ---------- camera / file ----------
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  video.srcObject = stream; await video.play();
  loop();
}
$('fileIn').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  video.srcObject = null; video.src = URL.createObjectURL(f); video.loop = true;
  video.onloadeddata = () => { video.play(); loop(); };
  $('overlay').classList.add('hidden');
});
$('startBtn').addEventListener('click', async () => {
  try { await startCamera(); $('overlay').classList.add('hidden'); }
  catch (err) { $('fileHint').textContent = 'Camera blocked — please upload a squat video below'; }
});

function loop() {
  if (state.running) return; state.running = true;
  const tick = () => {
    if (video.currentTime !== state.lastVideoTime && state.landmarker) {
      state.lastVideoTime = video.currentTime;
      const res = state.landmarker.detectForVideo(video, performance.now());
      if (res.landmarks?.[0]) onResults(res.landmarks[0]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

init().catch(e => { $('fileHint').textContent = 'Model load failed — check network; offline copy: see README'; console.error(e); });
