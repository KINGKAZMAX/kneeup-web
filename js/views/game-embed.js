// 训练游戏 · 占位卡——完整游戏在落地页 #demo 区体验（与 #demo tab2 同一模块，此处为全屏位预留）
export function render(root) {
  root.innerHTML = `
  <div class="view-head">
    <span class="eyebrow">Training Game · 训练游戏</span>
    <h1>深蹲充能 · 全屏位</h1>
    <p class="view-sub">本路由为展位大屏全屏形态预留；当前完整版本部署在落地页演示区</p>
  </div>

  <div class="panel game-ph">
    <div class="game-ph-icon" aria-hidden="true">◉</div>
    <h3>在落地页 #demo 体验完整训练游戏</h3>
    <p class="lead">摄像头姿态驱动「深蹲充能」：膝角驱动充能条与连击分，无摄像头自动回放样例，全部识别在设备本地完成。</p>
    <div class="quick-links">
      <a class="btn" href="demo.html#demo">前往体验完整训练游戏</a>
      <a class="btn ghost" href="#/screen">先看 AI 数据屏</a>
    </div>
    <p class="plan-note">游戏模块与 #demo 共用同一 MediaPipe 管线（on-device），本页不重复加载模型以保持轻量。</p>
  </div>`;
  return null;
}
