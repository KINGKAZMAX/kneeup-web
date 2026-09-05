// sim-source.js — 模拟数据源（SIMULATED 通道，与模型/摄像头完全解耦，C4 §五 洞2）
// 正弦膝角 90↔170°、3s/rep，周期与游戏/计数引擎对齐；带 source:'simulated' 标记。
// 接口：start() / stop() / frame(now?) → { ts, angleL, angleR, visibility, source, landmarks:null }
// 帧为纯时间函数（frame 幂等，可注入 now 供测试），可被 demo 与 game 两个消费者各自拉取。

// 确定性伪随机（可复现，避免噪声偶然击穿阈值）
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSimSource({
  periodMs = 3000,   // rep 节奏：3s/次
  minDeg = 90,       // 谷底（深蹲最低）
  maxDeg = 170,      // 直立
  asymDeg = 3,       // 右膝固定略浅 → 对称度 ≈95%，非满分的真实感
  noiseDeg = 1.2,    // ±噪声
  seed = 7,
} = {}) {
  const center = (minDeg + maxDeg) / 2, amp = (maxDeg - minDeg) / 2;
  const rnd = mulberry(seed);
  let t0 = null, running = false;

  return {
    mode: 'simulated',
    get running() { return running; },
    start() { if (!running) { t0 = performance.now ? performance.now() : Date.now(); running = true; } return this; },
    stop() { running = false; return this; },
    /** 拉取当前帧；未 start 时返回 null（驱动方负责先 start）；now 可注入（测试） */
    getFrame(now) {
      if (!running || t0 === null) return null;
      const ts = now ?? (performance.now ? performance.now() : Date.now());
      const t = ts - t0;
      const base = center + amp * Math.cos((2 * Math.PI * t) / periodMs); // t=0 从直立(170°)出发
      const L = base + (rnd() * 2 - 1) * noiseDeg;
      const R = base + asymDeg + (rnd() * 2 - 1) * noiseDeg;
      return {
        ts,
        angleL: Math.max(60, Math.min(190, L)),
        angleR: Math.max(60, Math.min(190, R)),
        visibility: 1,
        source: 'simulated',   // 模拟数据必带标记（消费方据此挂 .ku-chip.sim）
        landmarks: null,
      };
    },
    /** 任务契约别名：frame(now)（与 getFrame 等价） */
    frame(now) { return this.getFrame(now); },
  };
}
