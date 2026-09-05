// pose-engine.js — 姿态计算纯函数（零 DOM 依赖，Node 可测）
// 契约：CONTRACT.md「MediaPipe 契约」段；公式/滞回/平滑：research/R5 §4-§7
// 索引为解剖学命名（人物自己的左右），与摄像头是否镜像无关（R5 §3）。

// MediaPipe Pose 33 点下肢索引（官方核实，勿改动）
export const LM = {
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

// 叠加层连线：肩-肩 / 肩-髋 ×2 / 髋-髋 / 髋-膝-踝 ×2（仅下肢+髋肩，不画全身）
export const LOWER_LIMB_EDGES = [
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
];

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * 膝角 = 髋-膝-踝三点夹角（度），2D 投影角，正/侧面镜头均稳（R5 §4）。
 * kneeAngle(lm[23], lm[25], lm[27]) 左膝；lm[24]/lm[26]/lm[28] 右膝。
 * angle 为旧 demo（meniscus-shield-demo/js/main.js）同名导出。
 */
export function kneeAngle(hip, knee, ankle) {
  const v1x = hip.x - knee.x, v1y = hip.y - knee.y;
  const v2x = ankle.x - knee.x, v2y = ankle.y - knee.y;
  const dot = v1x * v2x + v1y * v2y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m === 0) return 180; // 关键点重合，视为无法判定，给中性值
  return Math.acos(clamp(dot / m, -1, 1)) * 180 / Math.PI;
}

export const angle = kneeAngle;

/** 中位数（照抄旧 demo：取排序后上中位，偶数长度不平均） */
export function median(arr) {
  const s = [...arr].sort((x, y) => x - y);
  return s[s.length >> 1];
}

/**
 * 中值平滑 buffer（照抄旧 demo push/median 滑窗，参数化成类）。
 * push(v) 返回当前窗口中位数；窗口未满时同样输出（demo 启动期可用）。
 */
export class MedianBuffer {
  constructor(n = 5) { this.n = n; this.buf = []; }
  push(v) { this.buf.push(v); if (this.buf.length > this.n) this.buf.shift(); return this.value; }
  get value() { return this.buf.length ? median(this.buf) : null; }
  get filled() { return this.buf.length >= this.n; }
  clear() { this.buf.length = 0; }
}

/**
 * 左右对称度 = clamp(100 − |L−R|/60×100)，分母 60° 为经验满偏差异（R5 §6）。
 */
export function symmetry(l, r) {
  return clamp(100 - Math.abs(l - r) / 60 * 100, 0, 100);
}

/**
 * 单次 rep 质量分（0-100，加权）：
 *   对称度 0.45 + 深度区间命中 0.35 + 节奏稳定 0.20（缺项自动归一化重分配）。
 *   sym    对称度 0-100；
 *   depth  本 rep 谷底角；zone=[lo,hi] 训练目标带，带内满分、出带按距离衰减；
 *   repMs  本 rep 用时；tempoMs 目标节奏，偏差 ≥80% 该项归零。
 * 全部缺项返回 null。
 */
export function qualityScore({ sym, depth, zone = [100, 140], repMs, tempoMs = 3000 } = {}) {
  const parts = [];
  if (sym != null && Number.isFinite(sym)) parts.push([0.45, clamp(sym, 0, 100) / 100]);
  if (depth != null && Number.isFinite(depth)) {
    const [lo, hi] = zone, span = Math.max(1, hi - lo);
    const dist = depth < lo ? lo - depth : depth > hi ? depth - hi : 0;
    parts.push([0.35, clamp(1 - dist / (span * 1.5), 0, 1)]);
  }
  if (repMs != null && Number.isFinite(repMs)) {
    parts.push([0.20, clamp(1 - Math.abs(repMs - tempoMs) / tempoMs / 0.8, 0, 1)]);
  }
  if (!parts.length) return null;
  const w = parts.reduce((s, [wt]) => s + wt, 0);
  return Math.round(parts.reduce((s, [wt, v]) => s + wt * v, 0) / w * 100);
}

/**
 * One Euro 简化版（自适应低通；R5 §7）。
 * minCutoff 起步 0.9 可调：抖则降、迟滞则升 beta。
 */
class LowPass {
  constructor() { this.y = undefined; }
  filter(x, a) { this.y = this.y === undefined ? x : a * x + (1 - a) * this.y; return this.y; }
}
export class OneEuro {
  constructor({ minCutoff = 0.9, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.xF = new LowPass(); this.dxF = new LowPass(); this.tPrev = undefined;
  }
  alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  reset() { this.xF = new LowPass(); this.dxF = new LowPass(); this.tPrev = undefined; }
  filter(x, tMs) {
    let dt = 1 / 30;
    if (this.tPrev !== undefined && tMs > this.tPrev) dt = (tMs - this.tPrev) / 1000;
    const prev = this.xF.y;
    const dx = prev === undefined ? 0 : (x - prev) / dt;
    const edx = this.dxF.filter(dx, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.tPrev = tMs;
    return this.xF.filter(x, this.alpha(cutoff, dt));
  }
}

/**
 * 计数状态机：双阈值滞回（DOWN<100° 进 / UP>160° 出）+ 谷底停留 ≥400ms（R5 §5）。
 * update(angleDeg, nowMs) 每帧调用；合格 rep 时返回事件：
 *   { index, depth: 谷底最深角, dwellMs, ts, durationMs, shallow }
 * shallow=浅蹲标记（照抄旧 demo lastMin>110 阈值，参数化）：
 *   CONTRACT 默认 DOWN<100 时谷底必 <100，标记恒 false；当调用方放宽 downT
 *   （如目标带上沿入环计数）时，谷底 >shallowT 即标浅蹲。
 */
export class RepCounter {
  constructor({ downT = 100, upT = 160, minDwellMs = 400, shallowT = 110 } = {}) {
    this.downT = downT; this.upT = upT; this.minDwellMs = minDwellMs; this.shallowT = shallowT;
    this.phase = 'UP'; this.count = 0;
    this.tEnter = 0; this.valley = 180; this.lastRepTs = undefined;
  }
  reset() { this.phase = 'UP'; this.count = 0; this.tEnter = 0; this.valley = 180; this.lastRepTs = undefined; }
  update(angle, now) {
    if (this.phase === 'UP' && angle < this.downT) {
      this.phase = 'DOWN'; this.tEnter = now; this.valley = angle;
      return null;
    }
    if (this.phase === 'DOWN') {
      if (angle < this.valley) this.valley = angle;
      if (angle > this.upT) {
        const dwellMs = now - this.tEnter;
        const durationMs = this.lastRepTs === undefined ? dwellMs : now - this.lastRepTs;
        const shallow = this.valley > this.shallowT; // 旧 demo lastMin>110 同义
        this.phase = 'UP';
        if (dwellMs >= this.minDwellMs) {
          this.count++;
          this.lastRepTs = now;
          const ev = { index: this.count, depth: this.valley, dwellMs, durationMs, ts: now, shallow };
          this.valley = 180;
          return ev;
        }
        this.valley = 180; // 假动作（快速抖动）被时间窗拒收
      }
    }
    return null;
  }
}
