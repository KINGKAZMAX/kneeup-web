// 身体记录 · 挂载七区身体图（点区域→底部 sheet→确认着色）
import { mountBodymap } from '../body/bodymap.js';

export function render(root) {
  root.innerHTML = `
  <div class="view-head">
    <span class="eyebrow">Body Map · 身体记录</span>
    <h1>七区身体图</h1>
    <p class="view-sub">点击区域记录 0–10 自评与负荷参考 · 非医疗评估 · Not a medical assessment</p>
  </div>

  <div class="body-layout">
    <div class="panel bodymap-panel">
      <div id="bodymap-mount"></div>
    </div>

    <div class="col">
      <div class="panel">
        <h3>色带 Legend</h3>
        <p class="panel-sub">钴蓝（轻微）→ 琥珀（中等）→ 红（明显）· 数值为您自己的 0–10 自评</p>
        <div class="legend-bar" role="img" aria-label="色带从钴蓝到琥珀到红，对应自评 0 到 10"></div>
        <div class="legend-ticks"><span>0</span><span>5</span><span>10</span></div>
        <div class="legend-chips" style="margin-top:14px">
          <span class="ku-chip">主观记录 SUBJECTIVE</span>
          <span class="ku-chip sim">模拟示例 SIMULATED</span>
        </div>
        <p class="plan-note">七区：膝前 / 膝内侧 / 膝外侧 / 膝后 / 髋 / 踝 / 对侧对照；膝后区仅记录不提示；对侧区作自评对比基准。</p>
        <p class="plan-note">保存即写入本地 body.regions.v1，并通过 region:update 事件与 AI 数据屏等视图联动。</p>
      </div>
    </div>
  </div>`;

  const cleanupMap = mountBodymap(root.querySelector('#bodymap-mount'));
  return cleanupMap;
}
