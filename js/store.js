// 轻量状态（localStorage 持久化，kneeup: 前缀）——与 data/repo.js 共用键名
const NS = 'kneeup:';
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch { /* 隐私模式等 */ }
  },
  del(key) { try { localStorage.removeItem(NS + key); } catch {} },
};
