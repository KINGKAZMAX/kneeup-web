# M5-PROTOCOL — KneeUp × M5 串口桥接协议（v0 · 未实机联调 UNTESTED）

> 状态声明：本协议与 `firmware/m5_voice_bridge.ino` 为设计示例，**尚未在真实 M5 硬件上联调验证**
>（无硬件在环）。Web 端实现在 `js/views/assist.js`（语音助手 × M5 桥接区块），UI 与固件注释中
> 均如实标注 UNTESTED。

## 链路

- Web Serial,115200 8N1,文本行协议（`\n` 结尾，UTF-8）。
- Web 端入口：apps.html `#/assist` →「语音助手 × M5 桥接」→「连接 M5(串口)」。
  需桌面或 Android Chrome（iOS Safari / 微信 / Firefox 无 Web Serial，按钮自动隐藏并提示）。

## 下行（web → M5）：状态行

```
ASSIST:33;SCENE:stairs;FATIGUE:47\n
```

| 字段 | 含义 | 取值 |
|---|---|---|
| `ASSIST` | 当前助力等级（Assist Level 引擎输出，限速后） | 0–50 整数（%） |
| `SCENE` | 当前场景 | `flat` / `standup` / `uphill` / `stairs` / `downhill` |
| `FATIGUE` | 疲劳指数（含训练回写） | 0–100 整数 |

- 节流：≤1Hz，且仅当内容变化时发送。

## 上行（M5 → web）：事件行

| 行 | 含义 | web 侧动作 |
|---|---|---|
| `BTN:A` | 按键单击 | 语音报告当前助力等级（speechSynthesis 本地合成） |
| `BTN:B` | 按键双击（400ms 窗口） | 切换到下一场景（flat→standup→uphill→stairs→downhill 循环） |
| 其他任意行 | 调试回显 | 显示在面板日志行 |

## 固件（示例）

`firmware/m5_voice_bridge.ino`（M5Atom / M5StickC 通用，风格参照 AIR-FLOW `ZY_Knee_sketch.ino`）：
- `Serial.begin(115200)`；下行状态行回显 `RX> ...` 并闪蓝色 LED；
- 按键消抖窗口 400ms：单击发 `BTN:A`，双击发 `BTN:B`。
- 引脚常量 `LED_BLUE=27`、`BTN_PIN=39` 为示例值，**烧录前按手头板型核对**。

## 与 BLE 通道的关系

- 本协议是「web ↔ M5 显示/按键桥」；护具遥测（膝角/压力）走 BLE NUS，见 `js/ai/ble-source.js`
  （service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`，notify JSON 行：
  `{"kneeAngleL":96.5,"kneeAngleR":98.1,"pressure":0.42,"ts":12345}`）。
- 两条通道相互独立，可同时连接；BLE 断开会自动回退模拟通道（SIMULATED chip 亮起）。
