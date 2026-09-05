// 用户端 · 今日概览（计划卡+连续天数点阵+ROM 周趋势+质量分柱）+ 记录列表（source chip）+ 导出
import { getSessions, getPlan } from '../data/repo.js';
import { exportAll } from '../data/export.js';
import { drawRomTrend, drawQualityBars } from '../viz/charts.js';

const pad = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

function dailyRom(sessions, days = 14) {
  const map = new Map();
  sessions.forEach(s => {
    const k = dayKey(s.tsStart);
    if (!map.has(k)) map.set(k, { k, l: [], r: [] });
    const e = map.get(k);
    e.l.push(s.metrics.kneePeakL); e.r.push(s.metrics.kneePeakR);
  });
  return [...map.values()].sort((a, b) => (a.k < b.k ? -1 : 1)).slice(-days)
    .map(e => ({ label: e.k.slice(5).replace('-', '/'), l: Math.round(avg(e.l)), r: Math.round(avg(e.r)) }));
}

function streakInfo(sessions) {
  const perDay = new Map();
  sessions.forEach(s => {
    if (s.counts.completed > 0) {
      const k = dayKey(s.tsStart);
      perDay.set(k, (perDay.get(k) || 0) + 1);
    }
  });
  const cur = new Date();
  if (!perDay.has(dayKey(cur.toISOString()))) cur.setDate(cur.getDate() - 1); // 今天未练不算断
  let streak = 0;
  while (perDay.has(dayKey(cur.toISOString()))) { streak++; cur.setDate(cur.getDate() - 1); }
  return { streak, perDay };
}

function dotGrid(perDay) {
  const cells = [];
  const start = new Date(); start.setHours(12, 0, 0, 0); start.setDate(start.getDate() - 27);
  const offset = (start.getDay() + 6) % 7; // 周一=0
  for (let i = 0; i < offset; i++) cells.push('<span class="streak-dot ghost" aria-hidden="true"></span>');
  const todayKey = dayKey(new Date().toISOString());
  for (let i = 0; i < 28; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dayKey(d.toISOString());
    const c = perDay.get(k) || 0;
    const lv = c >= 3 ? 3 : c;
    const lbl = `${d.getMonth() + 1}月${d.getDate()}日，${c > 0 ? `完成 ${c} 次训练` : '无记录'}`;
    cells.push(`<span class="streak-dot ${c > 0 ? `on lv${lv}` : ''} ${k === todayKey ? 'today' : ''}" role="img" aria-label="${lbl}" title="${lbl}"></span>`);
  }
  return cells.join('');
}

const EX = { squat: '深蹲', 'seated-ext': '坐姿伸膝' };
function recRow(s) {
  const d = new Date(s.tsStart);
  const chip = s.source === 'live'
    ? '<span class="ku-chip live">LIVE · 实测</span>'
    : '<span class="ku-chip sim">SIMULATED · 模拟</span>';
  return `<div class="rec-row">
    <span class="rec-date">${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}</span>
    <span class="rec-main">${EX[s.exercise] || s.exercise} · 完成 ${s.counts.completed}/${s.counts.target} 次 · 自评 ${s.subjective.pain}/10<span class="muted">（主动记录）</span></span>
    <span class="rec-metric">质量 ${Math.round(s.metrics.qualityAvg)} · 对称 ${Math.round(s.metrics.symmetryAvg)}%</span>
    ${chip}
  </div>`;
}

export function render(root) {
  const sessions = getSessions();
  const plan = getPlan();
  const { streak, perDay } = streakInfo(sessions);
  const rom = dailyRom(sessions);
  const now = new Date();

  root.innerHTML = `
  <div class="view-head">
    <span class="eyebrow">Patient View · 用户端</span>
    <h1>今日概览</h1>
    <p class="view-sub">${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 数据为本地演示（SIMULATED），导出 JSON 逐条携带 source 标注</p>
  </div>

  <div class="grid-2">
    <div class="col">
      <div class="panel">
        <h3>今日计划 Today's Plan</h3>
        <p class="panel-sub">读取自教练端设定（plan.v1 · 本地演示数据）</p>
        <div class="plan-nums">
          <span><b class="stat-inline">${plan.sets}</b> 组</span>
          <span class="muted">×</span>
          <span><b class="stat-inline">${plan.reps}</b> 次/组</span>
          <span class="plan-sep"></span>
          <span>支撑档位 <b class="stat-inline">${plan.supportPct}%</b></span>
        </div>
        <div class="quick-links">
          <a class="btn" href="#/game">开始训练</a>
          <a class="btn ghost" href="#/body">身体记录</a>
        </div>
      </div>

      <div class="panel">
        <h3>连续训练天数 Streak</h3>
        <p class="panel-sub">近 28 天 · 完成 1 次训练即点亮</p>
        <div class="streak-top"><span class="streak-num">${streak}</span><span class="streak-unit">天</span></div>
        <div class="streak-grid">${dotGrid(perDay)}</div>
      </div>

      <div class="panel">
        <h3>活动度 ROM 周趋势</h3>
        <p class="panel-sub">膝角峰值（度）· 纵轴固定 0–150° · 按日聚合</p>
        <canvas class="chart-canvas chart-rom" id="pt-rom"></canvas>
        <div class="legend-row">
          <span class="lg"><i></i>左膝 L</span>
          <span class="lg"><i class="dash"></i>右膝 R</span>
          <span class="lg"><i class="area"></i>峰值区间</span>
        </div>
      </div>

      <div class="panel">
        <h3>动作质量分（近 20 次）</h3>
        <p class="panel-sub">0–100 · 柱=单次，线=7 次移动均值 · ▲=触发安全警示</p>
        <canvas class="chart-canvas chart-q" id="pt-q"></canvas>
        <p class="chart-note" id="pt-q-note"></p>
      </div>
    </div>

    <div class="col">
      <div class="panel">
        <h3>训练记录</h3>
        <p class="panel-sub">每条记录带来源标注（source）</p>
        <div class="rec-list">${sessions.slice(0, 9).map(recRow).join('') || '<p class="muted">暂无记录</p>'}</div>
        <button class="btn ghost btn-block" id="pt-export">导出数据 JSON</button>
        <p class="plan-note" id="pt-export-note">导出文件含 integrityNote：模拟数据 source 逐条标注，不得抹除</p>
      </div>
    </div>
  </div>`;

  const romCv = root.querySelector('#pt-rom');
  const qCv = root.querySelector('#pt-q');
  const draw = () => {
    drawRomTrend(romCv, rom);
    const info = drawQualityBars(qCv, sessions);
    const note = root.querySelector('#pt-q-note');
    if (note && info) note.textContent = `近 ${sessions.slice(0, 20).length} 次均值 ${Math.round(info.baseline)} 分，安全警示 ${info.warns} 次`;
  };
  draw();

  let tid = null;
  const onResize = () => { clearTimeout(tid); tid = setTimeout(draw, 150); };
  window.addEventListener('resize', onResize);

  root.querySelector('#pt-export').addEventListener('click', () => {
    const name = exportAll();
    root.querySelector('#pt-export-note').textContent = name ? `已导出：${name}` : '导出失败，请重试';
  });

  return () => { window.removeEventListener('resize', onResize); clearTimeout(tid); };
}
