#!/bin/sh
# 局域网预览：电脑与手机同一 Wi-Fi 下，手机浏览器打开 http://<电脑IP>:8000
cd "$(dirname "$0")"
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
echo "桌面预览:  http://localhost:8000"
echo "手机预览:  http://$IP:8000"
exec python3 -m http.server 8000 --bind 0.0.0.0
