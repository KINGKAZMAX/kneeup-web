# MENISCUS SHIELD — Live Knee AI (Web Demo)

> Built during **AIx Origin Summit 2026** (Sep 5–6, Hong Kong Cyberport) by Team 自由意志 (Free Will).
> This is the **software face** of the MENISCUS SHIELD smart knee sleeve: the same analysis engine that will later run on woven strain sensors inside the brace, demonstrated today with camera-based pose estimation.

## What it does

- Real-time **knee-flexion angle** (left / right) from your webcam, 100% on-device
- **Left/right compensation warning** when the angle difference exceeds 10° for 3 consecutive frames
- **Squat rep counting** with hysteresis + shallow-squat detection (min angle > 110°)
- **Hip lateral-shift** warning (front view)
- Dual-channel dashboard: **Channel A (Vision, live)** + **Channel B (Textile sensor, simulated)** — on the real product, Channel B streams from the woven strain sensors over BLE into the same rules engine
- Session report after each rep

## Try it

Online: `https://<your-github>.github.io/meniscus-shield-demo/`

Local (camera requires localhost or HTTPS):

```bash
cd meniscus-shield-demo
python3 -m http.server 8000
# open http://localhost:8000
```

No camera? Use **"upload a squat video"** on the start screen (pre-recorded sideways/full-body squats work with the same pipeline).

## Tech

- [MediaPipe Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) (tasks-vision, WASM, GPU delegate) — runs in-browser, no server
- Vanilla JS + Canvas skeleton overlay + Chart.js
- Rules engine (rep counting / compensation thresholds) is original code; sagittal knee angle via atan2 on hip–knee–ankle landmarks, 5-frame median + EMA smoothing

## Accuracy note (honesty)

Sagittal-plane knee-flexion angles from markerless pose estimation are reasonably reliable; **frontal-plane valgus estimates carry larger error** — this demo therefore focuses on sagittal angle + left/right symmetry, and labels frontal cues as "reference only".

## Privacy

- Video never leaves the browser (no upload, no storage)
- Only skeleton keypoint geometry is used; no face recognition, no identity
- Turn it off by closing the tab

## Compliance positioning

MENISCUS SHIELD is a **consumer sports product**: physical support + movement-quality training feedback. It is **not a medical device** and makes no diagnostic, preventive, or therapeutic claims.

## Repo layout

```
index.html      — single-page app (stage + dashboard)
js/main.js      — MediaPipe init, angle math, rules engine, chart
docs/           — demo-video script, assets
```

## License & attribution

Open-source components: MediaPipe (Apache-2.0), Chart.js (MIT). Original code © 2026 Team 自由意志.
