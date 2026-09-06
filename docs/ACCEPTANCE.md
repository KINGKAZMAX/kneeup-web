# ACCEPTANCE — kneeup-web 线上正式验收（2026-09-06）

- 对象：**https://kingkazmax.github.io/kneeup-web/**（GitHub Pages，main 根目录；验收基线 commit `5e5fb38`）
- 工具：curl（可用性/计时）、ego-browser（线上实站截图 + 控制台捕获，desktop 1280 / mobile 390 双视口）
- 截图证据目录：`docs/test-output/acceptance-*.png`（另含冒烟 `acceptance-smoke-*.png`）

## 结果总览：21/21 项通过（无阻断问题，无需修复项）

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 1.1 | `/` HTTP 200 | ✅ 200, 20649B | curl |
| 1.2 | `/apps.html` | ✅ 200, 2132B | curl |
| 1.3 | `/3d.html` | ✅ 200, 3051B | curl |
| 1.4 | `assets/models/leg_web.glb` | ✅ 200, 4.40MB | curl |
| 1.5 | `assets/img/hero-wear.webp` | ✅ 200, 40KB | curl |
| 1.6 | `vendor/three/three.core.js` | ✅ 200, 1.44MB | curl |
| 1.7 | `vendor/mp/pose_landmarker_lite.task` | ✅ 200, 5.78MB | curl |
| 1.8 | `vendor/mp/wasm/vision_wasm_internal.wasm`（+loader .js / draco 两件） | ✅ 全 200 | curl |
| 2.1 | 落地页 hero/product/demo 区（1280+390） | ✅ 无破版/无横向溢出/无破图/控制台零报错 | `acceptance-landing-{desktop,mobile}-*.png` |
| 2.2 | apps 六视图 ×2 视口（用户/教练/AI数据屏/助力等级/训练游戏/身体记录） | ✅ 全部 overflowX=0，视图挂载正常，控制台零报错 | `acceptance-apps-{view}-{desktop,mobile}.png` |
| 2.3 | 3d.html 四模式 ×2 视口（product/wear/inner/heat） | ✅ 模型加载成功（fallback 未触发），四模式均可切换，控制台零报错 | `acceptance-3d-{mode}-{desktop,mobile}.png` |
| 3.1 | 助力面板场景按钮：上坡 → 基准 35% | ✅ readout「基准 35% ＋ 修正 +0% ＝ 目标 35%」，徽章「上坡 UPHILL」 | `acceptance-smoke-assist-uphill.png` |
| 3.2 | 游戏 HUD ASSIST chip | ✅ demo 区 sim 启动后显示「ASSIST 25%」，目标带 95-145°（联动加宽） | `acceptance-smoke-game-hud.png` |
| 3.3 | 3D heat 热力点 + 点击卡片 | ✅ 七区热点着色（膝前 4/10 呈琥珀）；点击膝前 → 卡片「自评 4/10 · 负荷参考 5/10」+ SIMULATED chip | `acceptance-smoke-heat-card.png` |
| 3.4 | 语音助手区 | ✅ 面板与 LOCAL chip 在位；Chromium 下 SR/串口 API 存在，按钮启用（降级路径见遗留 L3） | `acceptance-smoke-voice.png` |
| 4.1 | 首屏总传输 <2.5MB 纪律 | ✅ 落地页首屏 17 个资源合计 **149,565B ≈ 146KB**（未压缩口径；Pages 另有 gzip/br） | curl 逐项求和 |
| 4.2 | 大资产按懒加载 | ✅ MediaPipe/three/GLB 仅按需加载（不进首屏） | 资源清单比对 |

## 验收中发现的问题与处置

1. **ego 截图管线工件（非站点缺陷）**：iframe 内 `position:fixed` 的 3D HUD（模式胶囊/右下卡片）在 CDP clip 截图中合成到外窗口底部或缺失。DOM 探针实测：390 视口内 `#corner` right=376(=390−14)、`#modes` y 720-828、`#title` 正常——**布局与可见性全部正确**；直开页面截图亦证明 HUD 渲染正常。判定：不构成站点问题，不修。
2. curl 大文件传输时间（glb 2.0s / wasm 2.5s）属 GitHub Pages 正常水平；且均为懒加载，不影响首屏。

## 遗留清单（不阻断验收）

- **L1** BLE 实机连接、M5 串口桥接、M5 固件：无硬件在环，未实测（UI/文档均标 UNTESTED）。
- **L2** 语音识别的麦克风实收：需真人权限与语音输入，未实测；指令解析器 9 项 Node 测试覆盖。
- **L3** 语音/串口/BLE 的降级提示路径（iOS Safari/微信/Firefox）：需相应真机浏览器复核；代码路径为特性检测置灰+提示文案。
- **L4** 3D heat 模式部分热点标签在极端边缘视口可能轻微裁切（引线标签设计如此，锚点本体可点）。
- **L5** 本地预览脚本 `/tmp/ku-static-server.mjs` 为临时进程（重启失效）；线上 Pages 为正式入口，不受影响。

## 线上 URL 清单

| 页面 | URL |
|---|---|
| 落地页 | https://kingkazmax.github.io/kneeup-web/ |
| 应用壳（六视图） | https://kingkazmax.github.io/kneeup-web/apps.html （`#/patient` `#/coach` `#/screen` `#/assist` `#/game` `#/body`） |
| 助力等级决策面板 | https://kingkazmax.github.io/kneeup-web/apps.html#/assist |
| 3D 实验室（四模式） | https://kingkazmax.github.io/kneeup-web/3d.html |
| M5 协议文档 | https://kingkazmax.github.io/kneeup-web/docs/M5-PROTOCOL.md |
