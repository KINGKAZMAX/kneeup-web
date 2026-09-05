// pose-engine.test.mjs — Node 自测（合成角度序列断言计数/角度/平滑/质量分），零依赖。
// 运行：node js/ai/pose-engine.test.mjs   输出存档：docs/test-output/pose-engine.txt
import { kneeAngle, angle, symmetry, RepCounter, OneEuro, MedianBuffer, qualityScore, clamp } from './pose-engine.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ── 1. 膝角（三点夹角） ─────────────────────────────────────────
assert('kneeAngle 共线直立 = 180°', near(kneeAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }), 180, 1e-6));
assert('kneeAngle 直角 = 90°', near(kneeAngle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 90, 1e-6));
assert('kneeAngle 60° 用例', near(kneeAngle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0.8660254, y: 0.5 }), 60, 1e-4));
const deg = kneeAngle({ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.5 }, { x: 0.7, y: 0.4 });
assert('kneeAngle 一般角在 (0,180]', deg > 0 && deg <= 180, `${deg.toFixed(2)}°`);

// ── 2. MedianBuffer（中值平滑，照抄旧 demo 滑窗） ─────────────
assert('angle 为旧 demo 同名导出', angle === kneeAngle);
{
  const b = new MedianBuffer(5);
  const outs = [170, 171, 169, 1000, 172].map(v => b.push(v)); // 1000=单帧野值
  assert('MedianBuffer 野值被中值剔除', near(outs[4], 171, 1e-9), `out=${outs[4]}`);
  assert('MedianBuffer 滑窗长度受限且已满', b.filled && b.buf.length === 5);
  assert('MedianBuffer 滑窗后中位数（上中位，照抄旧 demo）', near(b.push(170), 171, 1e-9));
  b.clear();
  assert('MedianBuffer clear 后无值', b.value === null && !b.filled);
}
assert('symmetry(170,170) = 100', symmetry(170, 170) === 100);
assert('symmetry 满偏 60° 差 = 0', symmetry(170, 110) === 0);
assert('symmetry(170,140) = 50', symmetry(170, 140) === 50);
assert('symmetry 超 60° 差截断为 0', symmetry(180, 100) === 0);

// ── 3. RepCounter：正弦 90↔170°、3s/rep（与 sim-source 同参数） ───
// angle(t) = 130 + 40·cos(2πt/3000)，60fps 采样 10s → 期望 3 次
const FPS = 60, DT = 1000 / FPS, TOTAL = 10000;
const sineAngle = t => 130 + 40 * Math.cos(2 * Math.PI * t / 3000);
{
  const rc = new RepCounter(); const events = [];
  for (let t = 0; t <= TOTAL; t += DT) {
    const ev = rc.update(sineAngle(t), t);
    if (ev) events.push(ev);
  }
  assert('正弦 3s/rep × 10s → 3 reps', rc.count === 3, `count=${rc.count}`);
  assert('rep 谷底深度 ≈ 90°', events.every(e => near(e.depth, 90, 1.5)), events.map(e => e.depth.toFixed(1)).join(','));
  assert('rep dwell ≥ 400ms', events.every(e => e.dwellMs >= 400), events.map(e => Math.round(e.dwellMs)).join(','));
  assert('首 rep 时刻在 ~2.6-2.7s', events.length > 0 && events[0].ts >= 2600 && events[0].ts <= 2750, `${events[0]?.ts}ms`);
  assert('相位机回 UP', rc.phase === 'UP');
}
// 浅蹲序列（最低 110°，未破 DOWN 阈值 100°）→ 0 reps
{
  const rc = new RepCounter();
  for (let t = 0; t <= 9000; t += DT) rc.update(130 + 20 * Math.cos(2 * Math.PI * t / 3000), t);
  assert('浅蹲未破 100° → 0 reps', rc.count === 0);
}
// 快速抖腿（95↔165 每 100ms）→ 时间窗拒收，0 reps
{
  const rc = new RepCounter(); let t = 0;
  for (let i = 0; i < 40; i++, t += 100) rc.update(i % 2 === 0 ? 95 : 165, t);
  assert('抖动序列 → 0 reps（谷底 <400ms）', rc.count === 0);
}
// 慢速深蹲（单次下蹲停留 800ms）→ 恰 1 rep
{
  const rc = new RepCounter(); const seq = [];
  for (let t = 0; t <= 1000; t += 50) seq.push([t, 170 - t * 0.08]);           // 0-1s 下蹲到 90
  for (let t = 1050; t <= 1850; t += 50) seq.push([t, 90]);                     // 谷底停留 800ms
  for (let t = 1900; t <= 3000; t += 50) seq.push([t, 90 + (t - 1900) * 0.075]); // 回升到 ~172
  const evs = seq.map(([t, a]) => rc.update(a, t)).filter(Boolean);
  assert('慢蹲停留 800ms → 1 rep', rc.count === 1 && evs[0].dwellMs >= 400, `dwell=${evs[0]?.dwellMs}ms`);
  assert('默认阈值 DOWN<100 时浅蹲标记恒 false（谷底必 <100<shallowT110）',
    evs.every(e => e.shallow === false));
}
// 浅蹲标记（放宽 downT=115 的调用方配置：谷底 112 > shallowT 110 → shallow=true）
{
  const rc = new RepCounter({ downT: 115, upT: 160, minDwellMs: 400, shallowT: 110 });
  const seq = [];
  for (let t = 0; t <= 900; t += 50) seq.push([t, 170 - t * 0.064]);            // 下蹲到 ~112
  for (let t = 950; t <= 1750; t += 50) seq.push([t, 112]);                     // 停留 800ms
  for (let t = 1800; t <= 2900; t += 50) seq.push([t, 112 + (t - 1800) * 0.053]); // 回升到 ~170
  const evs = seq.map(([t, a]) => rc.update(a, t)).filter(Boolean);
  assert('谷底 112°>110 → 浅蹲标记', evs.length === 1 && evs[0].shallow === true, `depth=${evs[0]?.depth?.toFixed(1)}`);
}
// 默认参数快照（CONTRACT：DOWN<100 / UP>160 / 谷底≥400ms / shallowT 110）
{
  const rc = new RepCounter();
  assert('RepCounter 默认阈值符合 CONTRACT', rc.downT === 100 && rc.upT === 160 && rc.minDwellMs === 400 && rc.shallowT === 110);
}

// ── 3b. qualityScore（对称+深度带命中+节奏 加权 0-100） ────────
assert('qualityScore 满分=100', qualityScore({ sym: 100, depth: 120, zone: [100, 140], repMs: 3000 }) === 100);
assert('qualityScore 深度出带衰减', near(qualityScore({ sym: 100, depth: 160, zone: [100, 140], repMs: 3000 }), 88, 1));
assert('qualityScore 对称度差拉低（45 分项归零→55）', qualityScore({ sym: 0, depth: 120, zone: [100, 140], repMs: 3000 }) === 55);
assert('qualityScore 节奏偏差≥80% 该项归零（→80）', qualityScore({ sym: 100, depth: 120, zone: [100, 140], repMs: 5400 }) === 80);
assert('qualityScore 带内即满深度分（105°∈[100,140]）', qualityScore({ sym: 100, depth: 105, zone: [100, 140], repMs: 3000 }) === 100);
assert('qualityScore 单项输入归一化满分', qualityScore({ sym: 100 }) === 100);
assert('qualityScore 无输入 → null', qualityScore({}) === null);
assert('qualityScore 结果域 [0,100]', [0, 30, 62, 99].every(v => qualityScore({ sym: v, depth: 70, zone: [100, 140], repMs: 8000 }) >= 0 && qualityScore({ sym: v, depth: 70, zone: [100, 140], repMs: 8000 }) <= 100));

// ── 4. OneEuro 简化平滑 ────────────────────────────────────────
{
  // 常值 170° + ±8° 噪声（确定性伪随机），滤波后方差应显著下降
  let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const f = new OneEuro(); let errRaw = 0, errF = 0, n = 0, lagSum = 0;
  let lastRaw = 170;
  for (let i = 0; i < 300; i++) {
    const t = i * (1000 / 30);
    const raw = 170 + (rnd() * 2 - 1) * 8;
    const out = f.filter(raw, t);
    if (i >= 30) { errRaw += Math.abs(raw - 170); errF += Math.abs(out - 170); n++; lagSum += Math.abs(out - lastRaw); lastRaw = out; }
  }
  const maeRaw = errRaw / n, maeF = errF / n;
  assert('OneEuro 噪声 MAE 下降 ≥60%', maeF <= maeRaw * 0.4, `raw=${maeRaw.toFixed(2)}° → filtered=${maeF.toFixed(2)}°`);
  assert('OneEuro 输出不发散（|out| 有界）', lagSum / n < 8);
  // 阶跃跟踪：150ms 内收敛到新值 ±4°（速度自适应不锁死）
  const g = new OneEuro(); let conv = -1;
  for (let i = 0; i < 60; i++) {
    const t = i * (1000 / 30);
    const out = g.filter(i < 5 ? 170 : 120, t);
    if (i >= 5 && conv < 0 && Math.abs(out - 120) <= 4) conv = (i - 5) * (1000 / 30);
  }
  assert('OneEuro 阶跃 150ms 内收敛', conv >= 0 && conv <= 150, `${conv}ms`);
}
{
  const f = new OneEuro({ minCutoff: 2.5 }); // cutoff 可调
  assert('OneEuro 参数可调且正常出值', near(f.filter(100, 0), 100, 1e-9) && near(f.filter(100, 33), 100, 1e-9));
}

// ── 5. clamp / 边界 ────────────────────────────────────────────
assert('clamp 限幅', clamp(5, 0, 1) === 1 && clamp(-5, 0, 1) === 0 && clamp(0.5, 0, 1) === 0.5);
assert('kneeAngle 重合关键点 → 180（中性）', kneeAngle({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 }) === 180);

console.log('─'.repeat(48));
console.log(`RESULT  ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
