# KneeUp 膝望 · Web（kneeup-web）

[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-2144B2)](https://kingkazmax.github.io/kneeup-web/)

**线上地址：https://kingkazmax.github.io/kneeup-web/**（GitHub Pages，`main` 分支根目录自动部署）

## 正式入口（手机/电脑直接打开）

| 页面 | 地址 |
|---|---|
| 落地页 | https://kingkazmax.github.io/kneeup-web/ |
| 应用壳（用户/教练/AI 数据屏/**助力等级**/训练游戏/身体记录） | https://kingkazmax.github.io/kneeup-web/apps.html |
| 3D 实验室（product/wear/inner/heat 四模式） | https://kingkazmax.github.io/kneeup-web/3d.html |
| 线上验收报告（21/21 通过） | https://kingkazmax.github.io/kneeup-web/docs/ACCEPTANCE.md |
| M5 语音桥接协议 | https://kingkazmax.github.io/kneeup-web/docs/M5-PROTOCOL.md |

AIx Origin 2026 参赛演示站：落地页 + 应用壳（用户/教练/AI 数据屏/助力等级/游戏/身体图）+ 3D 旗舰页。
- 纯 vanilla ES-Modules，零构建；`python3 -m http.server 8000` 本地即跑。
- 应用壳入口 `apps.html`（含 `#/assist` 助力等级决策面板：规则引擎 + BLE/Web Serial/语音/M5 桥接）；3D 页 `3d.html`（product/wear/inner 解剖/heat 部位热力四模式）。
- 零外部依赖：three / MediaPipe tasks-vision / Draco / 模型全部 vendor 入库（断网可跑）。
- 数据层 localStorage(`kneeup:` 前缀）；M5 桥接协议见 `docs/M5-PROTOCOL.md`（固件 `firmware/m5_voice_bridge.ino`，未实机联调）。
- 设计正本：`../设计方案-agent集群/critique/C5-终审.md` + `../设计方案-agent集群/v2/critique/`（C6-C11）；数据契约：`CONTRACT.md`。
- 诚信纪律：模拟数据一律 `SIMULATED` chip；禁词表见 CONTRACT §全局纪律 3；git 每里程碑提交（比赛期间新变化证据）。
- 测试：`node js/ai/pose-engine.test.mjs`、`node js/ai/assist-engine.test.mjs`；巡检截图存档 `docs/test-output/`。
