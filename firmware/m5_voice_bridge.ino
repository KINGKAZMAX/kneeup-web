// m5_voice_bridge.ino — KneeUp × M5 串口桥接示例（M5Atom / M5StickC 通用）
// 风格参照 ZY_Knee_sketch.ino（setup/loop + Serial 115200 + 简洁状态机）。
// 功能：① 收 web 下行状态行「ASSIST:33;SCENE:stairs;FATIGUE:47」→ 串口回显 + LED 蓝色呼吸
//       ② 按键单击上行「BTN:A」（web 语音报告当前助力等级）；双击上行「BTN:B」（web 切下一场景）
// 注意：本草图为协议示例，未实机联调（UNTESTED）——引脚/LED 通道按手头条件核对后再烧录。
// 协议详见 docs/M5-PROTOCOL.md。

#define BAUD_RATE 115200
#define LED_BLUE  27   // M5Atom 板载 RGB 引脚示例;M5StickC 请改用自己的 LED/蜂鸣器引脚
#define BTN_PIN   39   // M5Atom 面键 / M5StickC BtnA

char lineBuf[96];
uint8_t lineLen = 0;

// 双击判定（400ms 窗口）
unsigned long lastBtnDown = 0;
bool pendingClick = false;
uint8_t clickCount = 0;

void setup()
{
  Serial.begin(BAUD_RATE);
  pinMode(LED_BLUE, OUTPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);
  digitalWrite(LED_BLUE, LOW);
  Serial.println("M5 VOICE BRIDGE READY · 115200 8N1");
}

void loop()
{
  readSerialLines();
  handleButton();
  flushClicks();
  delay(5);
}

/* ---- 下行：web → M5 状态行（以 \n 结尾；格式 ASSIST:33;SCENE:uphill;FATIGUE:47） ---- */
void readSerialLines()
{
  while (Serial.available() > 0)
  {
    char c = (char)Serial.read();
    if (c == '\n' || lineLen >= sizeof(lineBuf) - 1)
    {
      lineBuf[lineLen] = '\0';
      if (lineLen > 0) onStatusLine(lineBuf);
      lineLen = 0;
    }
    else lineBuf[lineLen++] = c;
  }
}

void onStatusLine(const char *line)
{
  // 回显 + LED 指示：收到 ASSIST 字段 → 蓝灯闪 120ms
  Serial.print("RX> ");
  Serial.println(line);
  if (strncmp(line, "ASSIST:", 7) == 0)
  {
    digitalWrite(LED_BLUE, HIGH);
    delay(120);
    digitalWrite(LED_BLUE, LOW);
  }
}

/* ---- 上行：M5 → web 按键事件 ---- */
void handleButton()
{
  static bool lastLevel = HIGH;
  bool level = digitalRead(BTN_PIN);
  if (lastLevel == HIGH && level == LOW)   // 按下沿
  {
    clickCount++;
    pendingClick = true;
    lastBtnDown = millis();
  }
  lastLevel = level;
}

void flushClicks()
{
  if (!pendingClick) return;
  if (millis() - lastBtnDown < 400) return; // 等双击窗口
  Serial.println(clickCount >= 2 ? "BTN:B" : "BTN:A");
  pendingClick = false;
  clickCount = 0;
}
