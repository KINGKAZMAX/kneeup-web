// 教练端 · 用户列表（风险分层，模拟数据带 chip）+ 计划设定滑杆（写 plan.v1）
import { getPlan, setPlan } from '../data/repo.js';

// 演示名单（模拟——每行带 SIMULATED chip）
const USERS = [
  {
    id: 'u1', initials: 'Z.M', name: '用户 Z.M', tier: 'warn', tierLabel: '需关注',
    summary: ['自评 7 日上升 2 分（3→5，主动记录）', '完成率 62%，近 7 日漏练 4 天'],
    rate: [4, 6, 5, 7, 0, 6, 8],
  },
  {
    id: 'u2', initials: 'L.Q', name: '用户 L.Q', tier: 'follow', tierLabel: '待跟进',
    summary: ['自评平稳（2→2，主动记录）', '完成率 78%，对称度 91%'],
    rate: [8, 7, 9, 8, 6, 9, 8],
  },
  {
    id: 'u3', initials: 'W.H', name: '用户 W.H', tier: 'good', tierLabel: '稳定',
    summary: ['自评下降（4→2，主动记录）', '完成率 95%，连续 9 天有记录'],
    rate: [9, 10, 9, 10, 9, 10, 10],
  },
];

function userRow(u) {
  const bars = u.rate.map((v, i) => {
    const hpx = Math.max(3, v * 2.6);
    const peak = v === Math.max(...u.rate) ? ' peak' : '';
    return `<i class="${peak}" style="height:${hpx}px" title="第 ${i + 1} 天：${v * 10}%"></i>`;
  }).join('');
  return `<div class="user-row tier-${u.tier}" data-tier="${u.tier}">
    <span class="avatar" aria-hidden="true">${u.initials}</span>
    <div class="u-main">
      <div class="u-name">${u.name} <span class="tier-chip">${u.tierLabel}</span></div>
      <div class="u-sum">${u.summary.map(s => `<span>${s}</span>`).join('')}</div>
    </div>
    <div class="u-side">
      <div class="mini-bars" role="img" aria-label="近 7 日完成率：${u.rate.map(v => v * 10 + '%').join('、')}">${bars}</div>
      <span class="ku-chip sim">SIMULATED</span>
    </div>
  </div>`;
}

export function render(root) {
  const plan = getPlan();

  root.innerHTML = `
  <div class="view-head">
    <span class="eyebrow">Coach Console · 教练端</span>
    <h1>用户概览</h1>
    <p class="view-sub">风险分层为信息整理，不构成医疗判断 · 名单为模拟演示数据</p>
  </div>

  <div class="grid-2">
    <div class="col">
      <div class="filter-chips" id="coach-filter" role="group" aria-label="分层筛选">
        <button type="button" class="fchip is-on" data-f="all">全部</button>
        <button type="button" class="fchip" data-f="warn">需关注</button>
        <button type="button" class="fchip" data-f="follow">待跟进</button>
        <button type="button" class="fchip" data-f="good">稳定</button>
      </div>
      <div class="panel">
        <div class="user-list" id="coach-list">${USERS.map(userRow).join('')}</div>
        <p class="plan-note">分层依据（演示规则）：自评变化 ×2 + 漏练天数 + 对称度降幅 + 安全事件 ×3；每行数据均为 SIMULATED。</p>
      </div>
    </div>

    <div class="col">
      <div class="panel">
        <h3>计划设定 Plan</h3>
        <p class="panel-sub">写入 plan.v1（本地）· 用户端「今日计划」即刻读取</p>
        <div class="slider-row">
          <label for="pl-sets">组数 Sets <output id="pl-sets-out">${plan.sets} 组</output></label>
          <input type="range" id="pl-sets" min="1" max="6" step="1" value="${plan.sets}">
        </div>
        <div class="slider-row">
          <label for="pl-reps">单组次数 Reps <output id="pl-reps-out">${plan.reps} 次</output></label>
          <input type="range" id="pl-reps" min="4" max="20" step="1" value="${plan.reps}">
        </div>
        <div class="slider-row">
          <label for="pl-support">支撑档位 Support <output id="pl-support-out">${plan.supportPct}%</output></label>
          <input type="range" id="pl-support" min="0" max="100" step="5" value="${plan.supportPct}">
        </div>
        <div class="sheet-actions">
          <button class="btn" id="pl-save">保存设定</button>
        </div>
        <p class="save-ok" id="pl-ok" aria-live="polite"></p>
        <p class="plan-note">日容量约 <b id="pl-vol">${plan.sets * plan.reps}</b> 次/日 · 档位仅调节支撑感受，不构成建议性设定</p>
      </div>
    </div>
  </div>`;

  // 筛选
  root.querySelector('#coach-filter').addEventListener('click', e => {
    const btn = e.target.closest('.fchip'); if (!btn) return;
    root.querySelectorAll('.fchip').forEach(b => b.classList.toggle('is-on', b === btn));
    const f = btn.dataset.f;
    root.querySelectorAll('.user-row').forEach(r => {
      r.style.display = (f === 'all' || r.dataset.tier === f) ? '' : 'none';
    });
  });

  // 滑杆联动
  const sets = root.querySelector('#pl-sets'), reps = root.querySelector('#pl-reps'), sup = root.querySelector('#pl-support');
  const vol = root.querySelector('#pl-vol');
  const sync = () => {
    root.querySelector('#pl-sets-out').textContent = `${sets.value} 组`;
    root.querySelector('#pl-reps-out').textContent = `${reps.value} 次`;
    root.querySelector('#pl-support-out').textContent = `${sup.value}%`;
    vol.textContent = String(sets.value * reps.value);
  };
  [sets, reps, sup].forEach(el => el.addEventListener('input', sync));

  root.querySelector('#pl-save').addEventListener('click', () => {
    const next = setPlan({ sets: +sets.value, reps: +reps.value, supportPct: +sup.value });
    root.querySelector('#pl-ok').textContent = `已保存：${next.sets} 组 × ${next.reps} 次 · 档位 ${next.supportPct}%`;
  });

  return null;
}
