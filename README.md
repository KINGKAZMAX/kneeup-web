# KneeUp 膝望 · Web（kneeup-web）

AIx Origin 2026 参赛演示站：落地页 + 应用壳（用户/教练/AI 数据屏/游戏/身体图）+ 3D 旗舰页。
- 纯 vanilla ES-Modules，零构建；`python3 -m http.server 8000` 本地即跑。
- 局域网预览（手机同 Wi-Fi 扫码/输入网址即可）：`./start-preview.sh`，手机打开 `http://<电脑IP>:8000`。
- 应用壳入口 `apps.html`（含 `#/assist` 助力等级决策面板）；3D 页 `3d.html`。
- 零外部依赖：three / MediaPipe tasks-vision / Draco / 模型全部 vendor 入库（断网可跑）。
- 设计正本：`../设计方案-agent集群/critique/C5-终审.md` + `../设计方案-agent集群/v2/critique/`（C6-C11）；数据契约：`CONTRACT.md`。
- 诚信纪律：模拟数据一律 `SIMULATED` chip；禁词表见 CONTRACT §全局纪律 3；git 每里程碑提交（比赛期间新变化证据）。
