// assist-runtime.js — Assist Level 跨页共享通道（store 键 assist.v1,新增 schema,CONTRACT v2）
// 面板(apps.html)与游戏(index.html #demo)不同页 → 走 localStorage;同页联动走 bus。
// assist.v1 = { level, activity, fatigueBoost, boostTs, updatedAt }
//   level/activity:assist 面板当前输出(2Hz 快照,供任意页读取)
//   fatigueBoost:游戏 session 结束写回的疲劳贡献(0-40,10 分钟线性衰减归零,面板疲劳指数叠加)
import { store } from '../store.js';

const KEY = 'assist.v1';
const BOOST_CAP = 40;
const BOOST_DECAY_MS = 600000; // 10min 线性衰减

export function readAssist() {
  const v = store.get(KEY, null);
  return v && typeof v === 'object' ? v : null;
}

export function writeAssistSnapshot({ level, activity }) {
  const prev = readAssist() || {};
  const next = { ...prev, level: Math.round(level), activity, updatedAt: Date.now() };
  store.set(KEY, next);
  return next;
}

/** 当前有效疲劳贡献（随时间线性衰减；now 可注入供测试） */
export function getFatigueBoost(now = Date.now()) {
  const v = readAssist();
  if (!v || !Number.isFinite(v.fatigueBoost) || !Number.isFinite(v.boostTs)) return 0;
  const k = 1 - (now - v.boostTs) / BOOST_DECAY_MS;
  return k <= 0 ? 0 : Math.round(v.fatigueBoost * k * 10) / 10;
}

/** 累加疲劳贡献并封顶 40；返回写入后的有效值 */
export function addFatigueBoost(amount, now = Date.now()) {
  const prev = readAssist() || {};
  const cur = getFatigueBoost(now);
  const next = Math.min(BOOST_CAP, Math.round((cur + Math.max(0, amount)) * 10) / 10);
  const out = { ...prev, fatigueBoost: next, boostTs: now, updatedAt: now };
  store.set(KEY, out);
  return next;
}

export const ASSIST_KEY = KEY;
export const BOOST_RULES = { BOOST_CAP, BOOST_DECAY_MS };
