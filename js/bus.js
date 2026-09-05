// 事件总线（全局单例）——三源联动（bodymap ↔ 3D pins ↔ screen）唯一通道
const listeners = new Map();
export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
  },
  emit(evt, detail) {
    listeners.get(evt)?.forEach(fn => { try { fn(detail); } catch (e) { console.error('[bus]', evt, e); } });
  },
};
// 约定事件：region:update {regionId, patch} / scene:select {sceneId} / session:end {session}
