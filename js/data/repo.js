// 数据层——sessions.v1 / body.regions.v1 / plan.v1 三键读写（走 store.js）
// 纪律：安全 parse（失败删键重建）、200 条上限、旧 airflowCompleted 迁移种子
import { store } from '../store.js';
import { bus } from '../bus.js';

export const REGION_KEYS = ['knee-anterior', 'knee-medial', 'knee-lateral', 'knee-posterior', 'hip', 'ankle', 'contra'];
export const SESSION_CAP = 200;

const K = { sessions: 'sessions.v1', body: 'body.regions.v1', plan: 'plan.v1' };
const BAD = '@@ku-unreadable@@';

function rawExists(key) {
  try { return localStorage.getItem('kneeup:' + key) !== null; } catch { return false; }
}

// 安全读取：parse 失败或形状不对 → 删键 → 用 rebuild() 重建落盘
function readSafe(key, isValid, rebuild) {
  let v = store.get(key, BAD);
  if (v === BAD || !isValid(v)) {
    if (rawExists(key)) store.del(key);
    v = rebuild();
    store.set(key, v);
  }
  return v;
}

const pad = n => String(n).padStart(2, '0');
export function genId() {
  const d = new Date();
  return `ks_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${Math.random().toString(36).slice(2, 6)}`;
}

// Session 工厂（CONTRACT schema：exercise/inputMode/source 枚举对齐）
export function makeSession(o = {}) {
  const ts = o.tsStart || new Date().toISOString();
  return {
    id: o.id || genId(),
    tsStart: ts,
    tsEnd: o.tsEnd || ts,
    exercise: o.exercise === 'seated-ext' ? 'seated-ext' : 'squat',
    inputMode: o.inputMode === 'live' ? 'live' : 'simulated',
    source: o.source === 'live' ? 'live' : 'simulated',
    counts: { target: 12, completed: 0, ...(o.counts || {}) },
    metrics: { kneePeakL: 0, kneePeakR: 0, symmetryAvg: 0, qualityAvg: 0, ...(o.metrics || {}) },
    subjective: { pain: 0, selfReported: true, feeling: '', ...(o.subjective || {}) },
    safety: { flag: 'none', events: [], ...(o.safety || {}) },
  };
}

// 旧键迁移：airflowCompleted（数字>0）→ 一条 simulated 种子 Session
function migrateAirflow() {
  const done = store.get('airflowCompleted', null);
  if (typeof done === 'number' && done > 0) {
    store.del('airflowCompleted');
    return makeSession({
      id: 'ks_airflow_legacy',
      exercise: 'seated-ext',
      counts: { target: done, completed: done },
      metrics: { kneePeakL: 96, kneePeakR: 94, symmetryAvg: 91, qualityAvg: 76 },
      subjective: { pain: 2, selfReported: true, feeling: '旧版数据迁移' },
    });
  }
  return null;
}

// 演示种子（全部 source:'simulated'——UI 处处带 chip）
function demoSessions() {
  const out = [];
  const now = Date.now();
  for (let d = 23; d >= 1; d--) {
    if (d % 6 === 4) continue; // 制造断练日
    const t = new Date(now - d * 864e5);
    t.setHours(10 + (d % 3) * 2, 12 + (d * 7) % 40, 0, 0);
    const prog = (23 - d) / 22; // 渐进向好
    out.push(makeSession({
      id: `ks_seed_${d}`,
      tsStart: t.toISOString(),
      tsEnd: new Date(t.getTime() + (120 + (d % 4) * 30) * 1000).toISOString(),
      exercise: d % 3 === 0 ? 'seated-ext' : 'squat',
      counts: { target: 12, completed: 6 + Math.round(prog * 5) + (d % 3 === 0 ? 1 : 0) },
      metrics: {
        kneePeakL: 92 + Math.round(prog * 14) + (d % 2) * 2,
        kneePeakR: 90 + Math.round(prog * 13) + (d % 3 === 0 ? 3 : 0),
        symmetryAvg: 88 + Math.round(prog * 8),
        qualityAvg: Math.min(96, 70 + Math.round(prog * 18) - (d % 4)),
      },
      subjective: { pain: Math.max(1, 5 - Math.round(prog * 3)), selfReported: true, feeling: ['轻松', '状态不错', '有点酸'][d % 3] },
      safety: d === 9 ? { flag: 'caution', events: [{ t: 66, type: 'angle_over_limit' }] } : { flag: 'none', events: [] },
    }));
  }
  return out.sort((a, b) => new Date(b.tsStart) - new Date(a.tsStart));
}

export function getSessions() {
  return readSafe(K.sessions, Array.isArray, () => {
    const legacy = migrateAirflow();
    const list = demoSessions();
    return legacy ? [legacy, ...list] : list;
  });
}

export function addSession(partial) {
  const list = getSessions();
  const s = makeSession(typeof partial === 'object' ? partial : {});
  list.unshift(s);
  // 200 上限：超限时先丢最旧记录的明细，再截断（保留聚合字段）
  for (let i = SESSION_CAP; i < list.length; i++) if (list[i]) list[i].signals = null;
  store.set(K.sessions, list.slice(0, SESSION_CAP));
  bus.emit('session:end', { session: s });
  return s;
}

// ---- body.regions.v1（七区，D7 kebab 键） ----
function isValidBody(v) { return !!v && typeof v === 'object' && v.regions && typeof v.regions === 'object'; }

function seedBody() {
  return {
    updatedAt: new Date().toISOString(),
    regions: {
      'knee-anterior': { pain: 4, load: 5, note: '演示示例：落地日膝前自评' },
      'knee-medial': { pain: 2, load: 3, note: '' },
      'knee-posterior': { pain: 0, load: 1, note: '' },
      'knee-lateral': { pain: 1, load: 2, note: '' },
      hip: { pain: 1, load: 3, note: '' },
      ankle: { pain: 0, load: 2, note: '' },
      contra: { pain: 1, load: 2, note: '对侧对照基准' },
    },
  };
}

export function getBody() {
  const v = readSafe(K.body, isValidBody, seedBody);
  REGION_KEYS.forEach(k => { if (!v.regions[k]) v.regions[k] = { pain: 0, load: 0, note: '' }; });
  return v;
}

export function setRegion(regionId, patch) {
  if (!REGION_KEYS.includes(regionId)) return null;
  const b = getBody();
  b.regions[regionId] = { ...b.regions[regionId], ...patch };
  b.updatedAt = new Date().toISOString();
  store.set(K.body, b);
  bus.emit('region:update', { regionId, patch: b.regions[regionId] });
  return b;
}

// ---- plan.v1（教练端设定，用户端/游戏读取） ----
export function getPlan() {
  return readSafe(K.plan, v => !!v && typeof v === 'object' && 'sets' in v, () => ({ sets: 3, reps: 12, supportPct: 40 }));
}

export function setPlan(p) {
  const next = { ...getPlan(), ...(p || {}) };
  next.sets = Math.min(6, Math.max(1, Math.round(Number(next.sets) || 1)));
  next.reps = Math.min(20, Math.max(4, Math.round(Number(next.reps) || 4)));
  next.supportPct = Math.min(100, Math.max(0, Math.round(Number(next.supportPct) || 0)));
  store.set(K.plan, next);
  return next;
}
