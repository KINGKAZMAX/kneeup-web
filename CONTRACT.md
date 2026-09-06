# CONTRACT.md — kneeup-web 施工契约（v2 · 2026-09-06 修订）

## v2 修订（2026-09-06）
本轮由单一实现者施工，获授权可越 W1–W4 边界；改动文件清单：
- 修复：`js/router.js`（命名导入失配修复——视图均导出 `render`，改 `import { render as renderX }`；并注册 `#/assist` 路由）、`vendor/three/three.core.js`（补齐 three.module.js@0.185.1 缺失依赖，原 404 致 3D 模块图加载失败）、`js/three/scene.js`（`const e` 重复赋值 TypeError 致恒入兜底，改 `let`）
- 新增：`js/ai/assist-engine.js`、`js/ai/assist-engine.test.mjs`、`js/ai/assist-sim.js`、`js/views/assist.js`
- 样式与移动端巡检修复：`css/apps.css`（assist 面板样式 + 顶栏/chip/fchip/滑杆/输入框 44px 触控 + 顶栏手机折行）、`css/landing.css`（demo 卡 grid minmax + 导航 44px）、`css/game.css`（自评按钮 44px 折行，修手机横向溢出）、`css/three.css`（mode-btn/zc-close 44px）
- 视图小修：`js/views/screen.js`（左轴 1.0 刻度 bug）、`js/views/patient.js`（streak 点阵 button→span 非交互）、`js/body/bodymap.js`（区域隐形命中垫扩大）、`apps.html`（viewport-fit=cover + 导航新增「助力等级」chip）
- 测试资产：`docs/test-output/`（audit-frame.html 巡检框架 + 截图 + 引擎测试输出）
- **术语豁免**：用户明确要求新增「Assist Level 助力等级」功能，assist 面板内（含其导航入口 chip）允许使用「助力等级 / Assist Level」；其余禁词 v3 纪律不变。
- 版本注记由「2026-09-05 冻结」升至 v2。

### v2 增补（同日第二轮）
- 素材：`assets/img/*.webp`（hero-wear/product-water/feat-support/feat-airflow/feat-smart，真图入库）；`index.html`/`css/landing.css` 换真图。
- 3D：`js/three/scene.js`（inner 程序化解剖 + heat 七区部位热力，锚点由结构四锚点替换）、`3d.html`、`css/three.css`。
- 联动：`js/ai/assist-runtime.js`（新键 `assist.v1`，见 schema 节）、`js/game/game.js`、`css/game.css`、`js/views/assist.js`。
- BLE：`js/ai/ble-source.js`；`js/demo-bind.js` + `index.html` 新增 `button#ku-start-ble`（DOM id 契约增补此 id）。
- 语音/M5：`js/ai/voice-commands.js`、`firmware/m5_voice_bridge.ino`、`docs/M5-PROTOCOL.md`。
- 部署：GitHub Pages `kingkazmax.github.io/kneeup-web/`（main 根目录）。

## 模块所有权（谁写哪个文件，禁止越界）
- W1：`index.html`、`css/landing.css`
- W2：`js/ai/mp-loader.js`、`js/ai/pose-engine.js`、`js/ai/sim-source.js`、`js/game/game.js`、`js/demo-bind.js`
- W3：`apps.html`、`css/apps.css`、`js/router.js`、`js/views/*.js`、`js/data/repo.js`、`js/data/export.js`、`js/viz/charts.js`、`js/body/bodymap.js`
- W4：`3d.html`、`css/three.css`、`js/three/*.js`
- 共享（已冻结，勿改）：`css/tokens.css`、`css/base.css`、`js/bus.js`、`js/store.js`

## 数据 schema（localStorage，键前缀 `kneeup:`）
- `sessions.v1`：Session 数组（上限 200）。Session 字段：
  `id, tsStart, tsEnd, exercise("squat"|"seated-ext"), inputMode("live"|"simulated"), source("live"|"simulated"), counts:{target,completed}, metrics:{kneePeakL,kneePeakR,symmetryAvg,qualityAvg}, subjective:{pain:0-10,selfReported:true,feeling}, safety:{flag:"none"|"caution"|"stop",events:[]}`
- `body.regions.v1`：七区 kebab 键 `knee-anterior,knee-medial,knee-lateral,knee-posterior,hip,ankle,contra`，值 `{pain:0-10,load:0-10,note}`（主观记录，UI 显示须带 SUBJECTIVE/SIMULATED 双 chip）
- `plan.v1`：`{sets,reps,supportPct}`（教练端设定，患者端/游戏读取）
- `assist.v1`（v2 新增）：`{level, activity, fatigueBoost, boostTs, updatedAt}`——助力等级跨页共享；`fatigueBoost` 为游戏结算写回的疲劳贡献（0–40，10 分钟线性衰减），assist 面板疲劳指数叠加显示并标注。
- 兼容：旧键 `airflowCompleted` 迁移为一条种子 Session。

## DOM id 契约（W1 写标记，W2 绑定，双方不得改名）
```
#demo 区：video#ku-video、canvas#ku-overlay、button#ku-start-live、button#ku-start-sim、
  span#ku-lk、span#ku-rk、span#ku-sym、span#ku-ql、span#ku-reps、div#ku-cues、span#ku-chip
游戏（demo 区内）：div#ku-game（W2 动态填充 HUD）
```

## 3D 契约（W4）
- importmap：`"three"→./vendor/three/three.module.js`，`"three/addons/"→./vendor/three/addons/`
- DRACO decoder 路径 `./vendor/draco/`；模型 `./assets/models/leg_web.glb`
- 模式四机位：`data-mode="product|wear|inner|heat"`（inner 本轮留位不实现剖切）
- 锚点 v0（手填，模型 Y 轴向上、高约 0.9、膝部约 47.9% 高度带）：气囊阵列/气道/绑带/髌骨开口四锚点，坐标自估并微调
- WebGL 失败/微信 UA → `assets/img/p2-*.jpg` 轮播兜底

## MediaPipe 契约（W2）
- `FilesetResolver.forVisionTasks('./vendor/mp/wasm/')`，模型 `./vendor/mp/pose_landmarker_lite.task`
- 降级链：GPU→CPU→sim-source（正弦膝角脚本，rep 节奏对齐）；四触发器：权限拒绝/加载失败或 6s 超时/10s 无人入镜/设备占用(NotReadable|NotFound)
- 下肢索引（官方核实）：左髋23 右髋24 左膝25 右膝26 左踝27 右踝28；膝角=髋-膝-踝夹角；计数滞回 DOWN<100° UP>160° 谷底≥400ms；对称度=clamp(100−|L−R|/60×100)

## 全局纪律（人人适用）
1. 相对路径（Pages 子路径部署）；零新增依赖、零外部请求（vendor 已离线）。
2. 一切模拟数据必须带 `.ku-chip.sim`（文案 SIMULATED·模拟）或 `.ku-chip.live`；chip 只用 base.css 实现。
3. 禁词 v3（用户可见层零命中，disclaimer/compliance 豁免）：诊断/治疗/康复/预防/保护/处方/术后/理疗师/医生许可/依从性/助力/疼痛(UI 用「负荷/自评」)/患者(用「用户」)/护理端(用「教练端」)/diagnose/rehab/recovery/prevent/prescription/medical advice/certified/passed regulations。
4. 页脚免责声明用 17 号稿原文（W1 落位），3D 解剖区角标「解剖示意 · ANATOMY SCHEMATIC」。
5. 每完成一个可运行状态即 `git add -A && git commit`，message 前缀 `feat|fix|chore(scope):`。
