// assist-engine.test.mjs — Node 自测（规则表/修正项/硬上限/速率限制），零依赖。
// 运行：node js/ai/assist-engine.test.mjs   输出存档：docs/test-output/assist-engine.txt
import {
  computeAssist, slewLimit, AssistEngine,
  BASE_ASSIST, HARD_CAP, MAX_RATE_PER_SEC,
} from './assist-engine.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ── 1. 基准助力（五场景规则表） ────────────────────────────────
assert('基准 flat=10', computeAssist({ activity: 'flat' }).level === 10);
assert('基准 standup=25', computeAssist({ activity: 'standup' }).level === 25);
assert('基准 uphill=35', computeAssist({ activity: 'uphill' }).level === 35);
assert('基准 stairs=30', computeAssist({ activity: 'stairs' }).level === 30);
assert('基准 downhill=20', computeAssist({ activity: 'downhill' }).level === 20);
assert('未知动作回退 flat 基准', computeAssist({ activity: 'moonwalk' }).level === 10);
assert('缺省输入 → flat 基准且无修正', (() => { const d = computeAssist(); return d.level === 10 && d.modifiers.length === 0 && !d.capped; })());

// ── 2. SI 修正：>10% 每超 5% 加 3pp ────────────────────────────
assert('SI=10% 不加', computeAssist({ activity: 'flat', si: 10 }).level === 10);
assert('SI=14% 不满一档不加', computeAssist({ activity: 'flat', si: 14 }).level === 10);
assert('SI=15% +3pp', computeAssist({ activity: 'flat', si: 15 }).level === 13);
assert('SI=20% +6pp', computeAssist({ activity: 'flat', si: 20 }).level === 16);
assert('SI=26% +9pp（向下取档）', computeAssist({ activity: 'flat', si: 26 }).level === 19);
assert('SI 修正原因文案携带', computeAssist({ activity: 'flat', si: 15 }).modifiers[0].reason.includes('SI'));

// ── 3. 疲劳修正：>60 每超 10 加 2pp ────────────────────────────
assert('fatigue=60 不加', computeAssist({ activity: 'flat', fatigue: 60 }).level === 10);
assert('fatigue=69 不满一档不加', computeAssist({ activity: 'flat', fatigue: 69 }).level === 10);
assert('fatigue=70 +2pp', computeAssist({ activity: 'flat', fatigue: 70 }).level === 12);
assert('fatigue=90 +6pp', computeAssist({ activity: 'flat', fatigue: 90 }).level === 16);
assert('fatigue=100 +8pp', computeAssist({ activity: 'flat', fatigue: 100 }).level === 18);

// ── 4. 组合 / 硬上限 / capped ──────────────────────────────────
{
  const d = computeAssist({ activity: 'uphill', si: 20, fatigue: 80 }); // 35+6+4
  assert('组合修正 35+6+4=45', d.level === 45 && d.modifiers.length === 2 && !d.capped, `level=${d.level}`);
}
{
  const d = computeAssist({ activity: 'stairs', si: 40, fatigue: 100 }); // 30+18+8=56→50
  assert('硬上限 56→50 且 capped', d.level === 50 && d.capped === true && d.raw === 56, `level=${d.level} raw=${d.raw}`);
  assert('cap 不丢修正明细', d.modifiers.length === 2);
}
assert('level 恒在 [0,50]', [[0, 0], [100, 100], [55, 99]].every(([si, f]) => {
  const d = computeAssist({ activity: 'stairs', si, fatigue: f });
  return d.level >= 0 && d.level <= HARD_CAP;
}));

// ── 5. baseline 个性化基准 ─────────────────────────────────────
assert('baseline 数字覆盖', computeAssist({ activity: 'flat', baseline: 18 }).level === 18);
assert('baseline 按动作映射', computeAssist({ activity: 'uphill', baseline: { uphill: 40 } }).level === 40);
assert('baseline 映射缺键回退规则表', computeAssist({ activity: 'flat', baseline: { uphill: 40 } }).level === 10);
assert('baseline 仍受硬上限约束', computeAssist({ activity: 'flat', baseline: 99 }).level === HARD_CAP);
assert('baseline 之上仍叠加修正', computeAssist({ activity: 'flat', baseline: 12, si: 15 }).level === 15);

// ── 6. 观察输入透传不崩（kneeAngle/speed 不参与 v1 规则） ──────
assert('带膝角/速度输入不崩', (() => {
  const d = computeAssist({ activity: 'stairs', kneeAngle: 62, speed: 2.4, si: 8, fatigue: 40 });
  return d.level === 30 && d.activity === 'stairs';
})());
assert('kneeAngle/speed 缺失不影响', computeAssist({ activity: 'stairs' }).level === 30);

// ── 7. slewLimit 纯函数 ────────────────────────────────────────
assert('slew 上行 1s 内 ≤10pp', slewLimit(10, 30, 1) === 20);
assert('slew 0.5s 只走 5pp', slewLimit(10, 30, 0.5) === 15);
assert('slew 下行同样限速', slewLimit(30, 5, 1) === 20);
assert('slew 步长大于差值时直达', slewLimit(10, 12, 1) === 12);
assert('slew prev 无效时直达目标', slewLimit(NaN, 25, 1) === 25);
assert('slew dt=0 不动', slewLimit(10, 40, 0) === 10);

// ── 8. AssistEngine（速率限制集成，注入时钟） ──────────────────
{
  const eng = new AssistEngine();
  const d0 = eng.update({ activity: 'flat' }, 0);
  assert('首次调用直接建立基准', d0.level === 10 && d0.rateLimited === false, `level=${d0.level}`);
  const d1 = eng.update({ activity: 'uphill' }, 100); // 目标 35,100ms → +1pp
  assert('100ms 内仅 +1pp（限速）', near(d1.level, 11, 1e-9) && d1.rateLimited === true && d1.target === 35, `level=${d1.level}`);
  const d2 = eng.update({ activity: 'uphill' }, 2600); // dt 2.5s 截断 1s → +10pp
  assert('dt>1s 截断为 +10pp', near(d2.level, 21, 1e-9), `level=${d2.level}`);
  const d2b = eng.update({ activity: 'uphill' }, 3600);
  const d2c = eng.update({ activity: 'uphill' }, 4600); // 31→35 差 4pp 内一步直达
  assert('分段爬升后到达目标 35', near(d2b.level, 31, 1e-9) && near(d2c.level, 35, 1e-9) && d2c.rateLimited === false, `d2b=${d2b.level} d2c=${d2c.level}`);
  const d3 = eng.update({ activity: 'flat' }, 4800); // 35→10 下行 0.2s → -2pp
  assert('下行 0.2s 仅 -2pp', near(d3.level, 33, 1e-9) && d3.target === 10, `level=${d3.level}`);
}
{
  // 1s 以上间隔截断（防后台切回大跳）
  const eng = new AssistEngine();
  eng.update({ activity: 'flat' }, 0);
  const d = eng.update({ activity: 'stairs' }, 60000); // dt 截断 1s → +10pp
  assert('dt 截断 1s（+10pp）', near(d.level, 20, 1e-9), `level=${d.level}`);
}
{
  const eng = new AssistEngine({ maxRate: 4 });
  eng.update({ activity: 'flat' }, 0);
  const d = eng.update({ activity: 'stairs' }, 500); // 自定义 4pp/s × 0.5s = +2pp
  assert('maxRate 可配（4pp/s）', near(d.level, 12, 1e-9), `level=${d.level}`);
}
{
  const eng = new AssistEngine();
  eng.update({ activity: 'flat', si: 20 }, 0);
  const d = eng.update({ activity: 'flat', si: 20 }, 100);
  assert('修正明细随 update 输出', d.modifiers.length === 1 && d.modifiers[0].delta === 6 && d.base === 10);
}
assert('默认速率常量 10pp/s', MAX_RATE_PER_SEC === 10);
assert('规则表快照', JSON.stringify(BASE_ASSIST) === JSON.stringify({ flat: 10, standup: 25, uphill: 35, stairs: 30, downhill: 20 }));

// ── 9. assist-sim 模拟源（五场景，纯时间函数） ─────────────────
{
  const { createAssistSim, ASSIST_SCENARIOS } = await import('./assist-sim.js');
  const sim = createAssistSim({ seed: 5 });
  const f0 = sim.frame(1000);
  assert('sim 帧结构', f0.activity === 'flat' && f0.source === 'simulated' && Number.isFinite(f0.kneeAngle) && Number.isFinite(f0.si) && Number.isFinite(f0.fatigue));
  assert('sim 同 now 幂等', JSON.stringify(sim.frame(2000)) === JSON.stringify(sim.frame(2000)));
  assert('sim 膝角在场景区间内', (() => {
    for (let t = 1000; t < 12000; t += 50) {
      const f = sim.frame(t);
      if (f.kneeAngle < ASSIST_SCENARIOS.flat.knee[0] - 3 || f.kneeAngle > ASSIST_SCENARIOS.flat.knee[1] + 3) return false;
    }
    return true;
  })());
  sim.setScenario('stairs', 12000);
  const f1 = sim.frame(12500);
  assert('切场景后活动切换', f1.activity === 'stairs');
  assert('疲劳跨场景延续不重置', f1.fatigue > 20, `fatigue=${f1.fatigue.toFixed(1)}`);
  assert('疲劳随时间累积', sim.frame(40000).fatigue > f1.fatigue);
  assert('未知场景名忽略', sim.setScenario('fly', 50000).scenario === 'stairs');
  // 引擎 × sim 端到端：上坡 + 高 SI + 高疲劳 → 触发修正并限速爬升
  const eng = new AssistEngine();
  const sim2 = createAssistSim({ seed: 5 });
  sim2.setScenario('uphill', 0);
  const e0 = eng.update(sim2.frame(0), 0);
  const e1 = eng.update(sim2.frame(300), 300);
  assert('端到端：上坡基准 35 建立', e0.base === 35 && e0.level <= HARD_CAP);
  assert('端到端：输出被速率限制平滑', Math.abs(e1.level - e0.level) <= 3 + 1e-9, `Δ=${(e1.level - e0.level).toFixed(2)}`);
}

// ── 10. assist-runtime 疲劳贡献（衰减数学,Node 无 localStorage → 空通道安全） ──
{
  const { getFatigueBoost, BOOST_RULES } = await import('./assist-runtime.js');
  assert('无存储通道时 boost=0(不炸)', getFatigueBoost() === 0);
  // 衰减曲线纯数学:注入假通道
  const fake = { fatigueBoost: 20, boostTs: 1000000 };
  globalThis.localStorage = {
    getItem: k => k === 'kneeup:assist.v1' ? JSON.stringify(fake) : null,
    setItem() {}, removeItem() {},
  };
  const at0 = getFatigueBoost(1000000);                       // t=0 → 20
  const atHalf = getFatigueBoost(1000000 + BOOST_RULES.BOOST_DECAY_MS / 2); // 半衰 → 10
  const atEnd = getFatigueBoost(1000000 + BOOST_RULES.BOOST_DECAY_MS + 1);  // 过期 → 0
  assert('boost 衰减:0/半衰/过期', at0 === 20 && atHalf === 10 && atEnd === 0, `${at0}/${atHalf}/${atEnd}`);
  delete globalThis.localStorage;
}

// ── 11. ble-source 行解析（Nordic UART JSON 行 → 同形帧） ─────
{
  const { parseBleLine, NUS } = await import('./ble-source.js');
  const f = parseBleLine('{"kneeAngleL":96.5,"kneeAngleR":98.1,"pressure":0.42,"ts":12345}');
  assert('BLE 标准行解析', f && f.angleL === 96.5 && f.angleR === 98.1 && f.pressure === 0.42 && f.ts === 12345 && f.source === 'live' && f.visibility === 1);
  assert('BLE 别名 angleL/angleR 兼容', (() => { const g = parseBleLine('{"angleL":100}'); return g && g.angleL === 100 && g.angleR === null; })());
  assert('BLE 角度钳位 0-190', parseBleLine('{"kneeAngleL":250}').angleL === 190);
  assert('BLE 噪声行容忍', parseBleLine('garbage') === null && parseBleLine('{broken') === null && parseBleLine('{"pressure":0.5}') === null);
  assert('BLE ts 缺省用接收时刻', (() => { const g = parseBleLine('{"kneeAngleL":90}', 555); return g.ts === 555; })());
  assert('BLE activity 字符串透传', parseBleLine('{"kneeAngleL":90,"activity":"stairs"}').activity === 'stairs');
  assert('NUS UUID 快照', NUS.service === '6e400001-b5a3-f393-e0a9-e50e24dcca9e' && NUS.txChar === '6e400003-b5a3-f393-e0a9-e50e24dcca9e' && NUS.rxChar === '6e400002-b5a3-f393-e0a9-e50e24dcca9e');
}

// ── 12. voice-commands 指令解析 ────────────────────────────────
{
  const { parseVoiceCommand } = await import('./voice-commands.js');
  assert('场景词:上坡', parseVoiceCommand('切换到上坡').action === 'set-scene' && parseVoiceCommand('切换到上坡').scene === 'uphill');
  assert('场景词:楼梯→stairs', parseVoiceCommand('帮我换成楼梯模式').scene === 'stairs');
  assert('场景词:下楼', parseVoiceCommand('下楼').scene === 'downhill');
  assert('场景词:起身', parseVoiceCommand('起身').scene === 'standup');
  assert('报告助力', parseVoiceCommand('报告当前助力').action === 'report-assist');
  assert('报告助力(英文 assist)', parseVoiceCommand('现在 assist 多少').action === 'report-assist');
  assert('开始训练', parseVoiceCommand('开始训练').action === 'start-training');
  assert('停止', parseVoiceCommand('停止').action === 'stop-training');
  assert('未命中 → null', parseVoiceCommand('今天天气怎么样') === null && parseVoiceCommand('') === null);
}

console.log('─'.repeat(48));
console.log(`RESULT  ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
