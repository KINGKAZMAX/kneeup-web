// assist-sim.js — Assist Level 决策面板的模拟数据源（SIMULATED 通道，sim-source.js 同风格）
// 五场景按钮驱动：膝角按步态周期振荡、SI 慢漂移、疲劳随活动累积（切场景时快照延续）。
// frame(now) 为纯时间函数（幂等，可注入 now 供测试）；一切输出带 source:'simulated'。

// 确定性噪声：seed × 通道 × 时间桶（50ms）哈希——frame 为纯时间函数（幂等，可注入 now 测试）
function hashNoise(seed, channel, bucket) {
  let h = (seed ^ Math.imul(channel, 0x9E3779B9) ^ Math.imul(bucket, 0x85EBCA6B)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D);
  h = Math.imul(h ^ (h >>> 12), 0x297A2D39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const NOISE_BUCKET_MS = 50;

// 场景参数：膝角区间(°)/步态周期(s)/速度区间(km/h)/SI区间(%)/疲劳初值与累积速率(每秒)
export const ASSIST_SCENARIOS = {
  flat:     { knee: [18, 58],  periodS: 1.2, speed: [3.8, 4.8], si: [3, 8],   fatigue0: 22, fatigueRate: 0.12 },
  standup:  { knee: [58, 172], periodS: 4.0, speed: [0.1, 0.6], si: [5, 12],  fatigue0: 30, fatigueRate: 0.25 },
  uphill:   { knee: [36, 86],  periodS: 1.4, speed: [2.8, 3.6], si: [8, 15],  fatigue0: 42, fatigueRate: 0.50 },
  stairs:   { knee: [48, 96],  periodS: 1.6, speed: [2.0, 2.8], si: [10, 19], fatigue0: 48, fatigueRate: 0.80 },
  downhill: { knee: [24, 68],  periodS: 1.1, speed: [3.4, 4.4], si: [5, 11],  fatigue0: 38, fatigueRate: 0.30 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createAssistSim({ seed = 11, scenario = 'flat' } = {}) {
  let cur = ASSIST_SCENARIOS[scenario] ? scenario : 'flat';
  let t0 = null;          // 当前场景起点（now 时间轴）
  let fatigueBase = ASSIST_SCENARIOS[cur].fatigue0; // 切场景时的疲劳快照（疲劳属人，不随场景重置）
  let fatigueAnchor = null; // 快照对应的 now

  function fatigueAt(now) {
    const from = fatigueAnchor ?? t0 ?? now;
    return clamp(fatigueBase + (now - from) / 1000 * ASSIST_SCENARIOS[cur].fatigueRate, 0, 95);
  }

  return {
    mode: 'simulated',
    get scenario() { return cur; },
    /** 切换场景；now 可注入（测试）。疲劳值在当前值处延续，随后按新场景速率累积。 */
    setScenario(name, now) {
      if (!ASSIST_SCENARIOS[name]) return this;
      const ts = now ?? (performance.now ? performance.now() : Date.now());
      if (t0 !== null) { fatigueBase = fatigueAt(ts); fatigueAnchor = ts; }
      cur = name;
      t0 = ts;
      return this;
    },
    /**
     * 拉取当前帧；未启动（未 setScenario 且未显式 start）时首帧自动建立时钟零点。
     * → { activity, kneeAngle, speed, si, fatigue, source:'simulated' }
     */
    frame(now) {
      const ts = now ?? (performance.now ? performance.now() : Date.now());
      if (t0 === null) { t0 = ts; fatigueAnchor = ts; }
      const scn = ASSIST_SCENARIOS[cur];
      const t = (ts - t0) / 1000;
      const bucket = Math.floor(ts / NOISE_BUCKET_MS);
      const noise = ch => hashNoise(seed, ch, bucket) * 2 - 1;
      const osc = Math.sin((2 * Math.PI * t) / scn.periodS);
      const kneeMid = (scn.knee[0] + scn.knee[1]) / 2, kneeAmp = (scn.knee[1] - scn.knee[0]) / 2;
      const kneeAngle = clamp(kneeMid + kneeAmp * osc + noise(1) * 1.5, 0, 190);
      const speed = clamp(scn.speed[0] + (scn.speed[1] - scn.speed[0]) * (0.5 + 0.5 * Math.sin(t * 0.6 + 1)) + noise(2) * 0.1, 0, 12);
      const si = clamp(scn.si[0] + (scn.si[1] - scn.si[0]) * (0.5 + 0.5 * Math.sin(t / 7)) + noise(3) * 0.6, 0, 100);
      const fatigue = fatigueAt(ts);
      return { activity: cur, kneeAngle, speed, si, fatigue, source: 'simulated' };
    },
  };
}
