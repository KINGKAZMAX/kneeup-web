// ble-source.js — Web Bluetooth 实机数据源（LIVE 通道;Nordic UART 风格 NUS）
// service 6e400001-…,notify 特征收 JSON 行,字段归一化为 sim-source 同形帧:
//   { ts, angleL, angleR, pressure?, source:'live', visibility:1, landmarks:null }
// 纪律:requestDevice 必须由用户手势触发(start 只在点击里调);断开/不支持 → 消费方回退 sim。
// 可测试:createBleSource({ bluetooth }) 注入假对象;parseBleLine 纯函数。

export const NUS = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  txChar: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',  // notify:外设 → web
  rxChar: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',  // write:web → 外设
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** 特性检测:iOS Safari / 微信 / Firefox 均无 Web Bluetooth */
export function bleSupported() {
  try { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }
  catch { return false; }
}

/**
 * 解析一行 JSON 遥测 → 归一化帧;无法解析/无角度 → null(容忍噪声行)
 * 入参字段(外设固件约定,见 docs/M5-PROTOCOL.md):
 *   { "kneeAngleL": 96.5, "kneeAngleR": 98.1, "pressure": 0.42, "ts": 12345 }
 * 兼容别名 angleL/angleR;ts 缺省用接收时刻。
 */
export function parseBleLine(line, nowMs) {
  if (typeof line !== 'string') return null;
  const t = line.trim();
  if (!t || t[0] !== '{') return null;
  let o;
  try { o = JSON.parse(t); } catch { return null; }
  const L = Number.isFinite(o.kneeAngleL) ? o.kneeAngleL : Number.isFinite(o.angleL) ? o.angleL : null;
  const R = Number.isFinite(o.kneeAngleR) ? o.kneeAngleR : Number.isFinite(o.angleR) ? o.angleR : null;
  if (L == null && R == null) return null;
  const frame = {
    ts: Number.isFinite(o.ts) ? o.ts : (nowMs ?? Date.now()),
    angleL: L == null ? null : clamp(L, 0, 190),
    angleR: R == null ? null : clamp(R, 0, 190),
    visibility: 1,
    source: 'live',
    landmarks: null,
  };
  if (Number.isFinite(o.pressure)) frame.pressure = clamp(o.pressure, 0, 1);
  if (Number.isFinite(o.pressureL)) frame.pressureL = clamp(o.pressureL, 0, 1);
  if (Number.isFinite(o.pressureR)) frame.pressureR = clamp(o.pressureR, 0, 1);
  if (typeof o.activity === 'string') frame.activity = o.activity;
  return frame;
}

/**
 * 创建 BLE 数据源。state 变化经 onState('connecting'|'live'|'closed'|'error', detail?) 上报。
 * getFrame():最新一帧;>1500ms 无新帧 → null(断流,消费方显示中断/回退 sim)。
 */
export function createBleSource({ onState } = {}) {
  let device = null, server = null, tx = null, rx = null;
  let last = null, lastAt = 0, running = false, buffer = '';
  const state = (s, detail) => { try { onState && onState(s, detail); } catch {} };

  function onNotify(ev) {
    const chunk = new TextDecoder().decode(ev.target.value, { stream: true });
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const f = parseBleLine(line);
      if (f) { last = f; lastAt = performance.now(); }
    }
  }
  function onDisconnect() {
    running = false; tx = null; rx = null; server = null;
    state('closed');
  }

  return {
    mode: 'live',
    get running() { return running; },
    get deviceName() { return device && device.name || null; },
    /** 必须在用户手势内调用(浏览器强制)。 */
    async start() {
      if (running) return this;
      if (!bleSupported()) { const e = new Error('Web Bluetooth 不可用'); e.name = 'NotSupported'; state('error', e); throw e; }
      state('connecting');
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS.service] }, { namePrefix: 'KneeUp' }, { namePrefix: 'M5' }],
        optionalServices: [NUS.service],
      });
      device.addEventListener('gattserverdisconnected', onDisconnect);
      server = await device.gatt.connect();
      const svc = await server.getPrimaryService(NUS.service);
      tx = await svc.getCharacteristic(NUS.txChar);
      try { rx = await svc.getCharacteristic(NUS.rxChar); } catch { rx = null; } // RX 可选(单向遥测也成立)
      await tx.startNotifications();
      tx.addEventListener('characteristicvaluechanged', onNotify);
      running = true;
      state('live', device.name);
      return this;
    },
    async stop() {
      running = false;
      try { if (tx) await tx.stopNotifications(); } catch {}
      try { if (device && device.gatt.connected) device.gatt.disconnect(); } catch {}
      tx = null; rx = null; server = null;
      state('closed');
      return this;
    },
    getFrame() {
      if (!running || !last) return null;
      if (performance.now() - lastAt > 1500) return null;   // 断流不假装
      return last;
    },
    frame() { return this.getFrame(); },
    /** web → 外设下行(状态行/指令;无 RX 特征时静默忽略) */
    async send(text) {
      if (!rx || !running) return false;
      try { await rx.writeValue(new TextEncoder().encode(String(text) + '\n')); return true; }
      catch { return false; }
    },
  };
}
