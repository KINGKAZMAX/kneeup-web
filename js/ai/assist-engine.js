// assist-engine.js — Assist Level 助力等级决策引擎（纯函数，零 DOM 依赖，Node 可测）
// 蓝本：项目根 21-Web平台设计方案 §4.1 ④助力决策层（可解释规则兜底）。
// 规则（v1 产品定义值）：
//   基准助力 flat:10 / standup:25 / uphill:35 / stairs:30 / downhill:20
//   SI（左右对称指数，%）>10%：每超 5% 加 3pp
//   fatigue（0-100）>60：每超 10 加 2pp
//   硬上限 50%；输出变化速率限制 ≤10pp/秒（AssistEngine.update 注入时钟）

export const BASE_ASSIST = { flat: 10, standup: 25, uphill: 35, stairs: 30, downhill: 20 };
export const ACTIVITY_LABELS = { flat: '平地', standup: '起身', uphill: '上坡', stairs: '上楼', downhill: '下楼' };

export const HARD_CAP = 50;
export const SI_THRESHOLD = 10, SI_STEP = 5, SI_DELTA = 3;
export const FATIGUE_THRESHOLD = 60, FATIGUE_STEP = 10, FATIGUE_DELTA = 2;
export const MAX_RATE_PER_SEC = 10;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function resolveBase(activity, baseline) {
  if (baseline != null && Number.isFinite(baseline)) return clamp(baseline, 0, HARD_CAP);
  if (baseline && typeof baseline === 'object' && Number.isFinite(baseline[activity])) {
    return clamp(baseline[activity], 0, HARD_CAP);
  }
  return BASE_ASSIST[activity] ?? BASE_ASSIST.flat;
}

/**
 * 单帧决策（不含速率限制）。
 * @param {{activity?:string, kneeAngle?:number, speed?:number, si?:number, fatigue?:number, baseline?:number|Object}} input
 *   kneeAngle/speed 为观察输入（当前规则不直接修正，随输出透传供 UI/日志）。
 * @returns {{activity:string, level:number, base:number, modifiers:{reason:string, delta:number}[], capped:boolean, raw:number}}
 */
export function computeAssist(input = {}) {
  const activity = typeof input.activity === 'string' ? input.activity : 'flat';
  const base = resolveBase(activity, input.baseline);
  const si = clamp(Number.isFinite(input.si) ? input.si : 0, 0, 100);
  const fatigue = clamp(Number.isFinite(input.fatigue) ? input.fatigue : 0, 0, 100);

  const modifiers = [];
  const siOver = si - SI_THRESHOLD;
  if (siOver > 0) {
    const delta = Math.floor(siOver / SI_STEP + 1e-9) * SI_DELTA;
    if (delta > 0) modifiers.push({ reason: `左右差过大 SI ${Math.round(si)}%`, delta });
  }
  const fatOver = fatigue - FATIGUE_THRESHOLD;
  if (fatOver > 0) {
    const delta = Math.floor(fatOver / FATIGUE_STEP + 1e-9) * FATIGUE_DELTA;
    if (delta > 0) modifiers.push({ reason: `疲劳上升 指数 ${Math.round(fatigue)}`, delta });
  }

  const raw = base + modifiers.reduce((s, m) => s + m.delta, 0);
  const level = Math.min(raw, HARD_CAP);
  return { activity, level, base, modifiers, capped: raw > HARD_CAP, raw };
}

/**
 * 速率限制（slew-rate）：|输出-prev| ≤ maxRate × dtSec。
 */
export function slewLimit(prev, target, dtSec, maxRate = MAX_RATE_PER_SEC) {
  if (!Number.isFinite(prev)) return target;
  const step = Math.max(0, dtSec) * maxRate;
  return clamp(target, prev - step, prev + step);
}

/**
 * 带速率限制的决策器（有状态：上一帧输出 + 时钟；时钟可注入，Node 可测）。
 * update(input, nowMs) → computeAssist 结果 + { target, level(限速后), rateLimited, ts }
 * 首次调用直接对齐目标（初始建立不算"变化"）；dt 截断 1s 防后台切回跳变。
 */
export class AssistEngine {
  constructor({ maxRate = MAX_RATE_PER_SEC } = {}) {
    this.maxRate = maxRate;
    this.prevLevel = null;
    this.prevTs = null;
  }
  reset() { this.prevLevel = null; this.prevTs = null; }
  update(input, nowMs) {
    const d = computeAssist(input);
    if (this.prevTs == null || !Number.isFinite(nowMs)) {
      this.prevLevel = d.level; this.prevTs = nowMs ?? 0;
      return { ...d, target: d.level, rateLimited: false, ts: this.prevTs };
    }
    const dtSec = clamp((nowMs - this.prevTs) / 1000, 0, 1);
    const level = slewLimit(this.prevLevel, d.level, dtSec, this.maxRate);
    const out = { ...d, target: d.level, level, rateLimited: Math.abs(level - d.level) > 1e-9, ts: nowMs };
    this.prevLevel = level; this.prevTs = nowMs;
    return out;
  }
}
