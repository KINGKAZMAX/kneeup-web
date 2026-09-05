// mp-loader.js — MediaPipe PoseLandmarker 加载器（vendor 离线，零外部请求）
// 契约：CONTRACT.md「MediaPipe 契约」；降级链 research/R5 §1-§2 + critique/C4 §五（洞3：总预算覆盖首帧前的全部加载段）。
// 本文件位于 js/ai/，vendor 在仓库根 → 相对 import.meta.url 上跳两级（../../vendor/mp/…），
// 最终解析为相对页面的运行时绝对 URL，Pages 子路径部署可用。

const TOTAL_TIMEOUT_MS = 6000; // 总预算：bundle import + wasm + 模型 + createFromOptions（GPU 与 CPU 重试共享）

async function withDeadline(p, deadline, label) {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error(`[mp-loader] ${label} 超时（总预算 ${TOTAL_TIMEOUT_MS}ms 已耗尽）`);
  return await Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`[mp-loader] ${label} 超时（>${TOTAL_TIMEOUT_MS}ms 总预算）`)), left)),
  ]);
}

/**
 * 加载并返回 PoseLandmarker（VIDEO 模式，lite 模型，单人体）。
 * delegate: GPU → 失败重建 CPU → 仍失败/总超时 → reject（由调用方切 sim-source 兜底）。
 */
export async function loadPoseLandmarker() {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const wasmBase = new URL('../../vendor/mp/wasm/', import.meta.url).href;          // 末尾斜杠必须保留
  const modelUrl = new URL('../../vendor/mp/pose_landmarker_lite.task', import.meta.url).href;

  // 动态 import：specifier 相对本模块解析（js/ai/ → ../../vendor/mp/）
  const vision = await withDeadline(import('../../vendor/mp/vision_bundle.mjs'), deadline, 'vision_bundle.mjs 加载');
  if (!vision?.FilesetResolver || !vision?.PoseLandmarker) {
    throw new Error('[mp-loader] vision_bundle 导出缺失（FilesetResolver/PoseLandmarker）');
  }
  const fileset = await withDeadline(
    vision.FilesetResolver.forVisionTasks(wasmBase), deadline, 'wasm fileset 解析');

  const buildOpts = (delegate) => ({
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  try {
    return await withDeadline(
      vision.PoseLandmarker.createFromOptions(fileset, buildOpts('GPU')), deadline, 'GPU delegate 初始化');
  } catch (gpuErr) {
    console.warn('[mp-loader] GPU delegate 失败，降级 CPU：', gpuErr?.message || gpuErr);
    return await withDeadline(
      vision.PoseLandmarker.createFromOptions(fileset, buildOpts('CPU')), deadline, 'CPU delegate 初始化');
  }
}
