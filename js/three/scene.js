// js/three/scene.js —— KneeUp 护具 3D 实验室（W4，合并 layers/pins/cameras/fallback 单文件）
// 依据：CONTRACT 3D 契约 + D2/C3/K6/C6 裁决；灯光/自动扶正/材质照抄 ../kneeup-3d-preview 已验证配方。
// 主角=护具整机 leg_web.glb（主角反转，per K6）；四模式 product/wear/inner/heat：
// inner=程序化解剖示意（股骨/胫骨/腓骨/髌骨/半月板，基础几何体；护具半透明；角标 ANATOMY SCHEMATIC 常驻）；
// heat=七区部位热力（读 kneeup:body.regions.v1，钴蓝→warn→danger 梯度；演示种子数据→SIMULATED chip）；
// WebGL 失败/微信 UA/模型失败 → p2 轮播兜底。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { getBody } from '../data/repo.js';
import { bus } from '../bus.js';
import { painToColor, REGION_META } from '../body/bodymap.js';

/* ---------------- 常量与数据 ---------------- */
const BG = '#0B0C0E', ACCENT = '#4376EB', PRIMARY = '#2144B2', GHOST = '#4376EB';
const MODEL_H = 2.0;                 // 归一化模型高（K6 四机位按 2.0 高度系标定）
const KNEE_Y = MODEL_H * 0.479;      // 膝部 47.9% 高度带（K6 §一沿轴半径实测）
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const SPIN_SPEED = 0.35;             // rad/s（CONTRACT/预览页同值）

// 七区热力锚点（body.regions.v1 kebab 键；off=相对膝中心手填偏移，视觉校准）
const HEAT_ANCHORS = [
  { id: 'knee-anterior',  off: [0, .02, .165],   r: .06 },  // 膝前（髌面）
  { id: 'knee-medial',    off: [-.15, -.01, .02],  r: .05 },  // 膝内侧
  { id: 'knee-lateral',   off: [.15, -.01, .02],   r: .05 },  // 膝外侧
  { id: 'knee-posterior', off: [0, -.08, -.155],  r: .05 },  // 膝后（略下移，投影与膝前错开）
  { id: 'hip',            off: [.18, .56, .02],   r: .055 }, // 髋（大腿上段旁）
  { id: 'ankle',          off: [.10, -.55, .03],  r: .045 }, // 踝
  { id: 'contra',         off: [-.34, .02, 0],    r: .05 },  // 对侧对照（无护具侧悬浮点）
];

// 四模式机位与图层目标（K6 §二机位表扩展：inner 解剖 / heat 部位热力）
const MODES = {
  product: { cam: [1.9, 1.25, 2.6], tgt: [0, 1.0, 0], brace: 1, ghost: 0, bones: 0, pins: 0, spin: true,
             hint: '自动缓旋 · 拖拽旋转 / 滚轮缩放' },
  wear:    { cam: [0, 1.15, 3.1], tgt: [0, 1.05, 0], brace: .85, ghost: 1, bones: 0, pins: 0, spin: false,
             hint: '胶囊腿为比例示意 · 护具半透明展示佩戴关系' },
  inner:   { cam: [.55, 1.1, 2.15], tgt: [0, .95, 0], brace: .24, ghost: 0, bones: 1, pins: 0, spin: false,
             hint: '解剖示意 · 护具半透明，内部为程序化示意骨骼（非医学模型）' },
  heat:    { cam: [.4, 1.2, 2.7], tgt: [0, 1.0, 0], brace: .5, ghost: .85, bones: 0, pins: 1, spin: false,
             hint: '部位热力 · 钴蓝→琥珀→红 = 自评 0→10 · 点击热点查看记录' },
};

/* ---------------- DOM ---------------- */
const $ = (s) => document.querySelector(s);
const canvas = $('#stage'), pinsBox = $('#pins'), hintEl = $('#hint'), loadingEl = $('#loading');
const cardEl = $('#zone-card'), cardTitle = $('#zc-title'), cardEn = $('#zc-en'),
      cardCn = $('#zc-cn'), cardEnCopy = $('#zc-en-copy');

/* ---------------- 兜底（fallback 先行，任何翻车都只是少一个彩蛋，per C3） ---------------- */
let fbTimer = null;
function showFallback(reason) {
  if (document.body.classList.contains('is-fallback')) return;
  document.body.classList.add('is-fallback');
  if (renderer) renderer.setAnimationLoop(null);
  canvas.style.display = 'none';
  pinsBox.style.display = 'none';
  $('#modes').style.display = 'none';
  hintEl.style.display = 'none';
  $('#fb-reason').textContent = reason;
  $('#fallback').hidden = false;
  loadingEl.classList.add('off');
  const imgs = document.querySelectorAll('.fb-frame img');
  let i = 0;
  clearInterval(fbTimer);
  fbTimer = setInterval(() => {           // 4s 淡入淡出轮播
    imgs[i].classList.remove('is-on'); i = (i + 1) % imgs.length;
    imgs[i].classList.add('is-on');
  }, 4000);
}

/* ---------------- 引导：微信 UA / WebGL 检测先行 ---------------- */
if (/MicroMessenger/i.test(navigator.userAgent)) {
  showFallback('当前处于微信内嵌浏览器，已切换为产品渲染图轮播。如需 3D 交互，请在系统浏览器（Safari / Chrome）中打开本页。');
} else {
  let ok = true;
  try { var renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { ok = false; }
  if (ok && !(canvas.getContext('webgl2') || canvas.getContext('webgl'))) ok = false;
  if (!ok) {
    showFallback('当前浏览器不支持 WebGL，已切换为产品渲染图轮播。建议用较新的 Safari / Chrome 打开完整 3D 版。');
  } else {
    boot(renderer);
  }
}

/* ================================================================ 主路径 ================================================================ */
function boot(renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.5 : 2));   // 移动端 pixelRatio≤1.5
  renderer.setSize(innerWidth, innerHeight);

  /* ---- 场景 / 相机 / 控制器 ---- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 4.5, 12);

  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .01, 50);
  camera.position.set(...MODES.product.cam);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.2; controls.maxDistance = 6;
  controls.target.set(...MODES.product.tgt);

  /* ---- 灯光（照抄预览页已验证配方：半球 + 白主光 + 双钴蓝 rim） ---- */
  scene.add(new THREE.HemisphereLight('#3a4a6b', BG, 1.1));
  const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(2, 3, 2); scene.add(key);
  const rimA = new THREE.DirectionalLight(ACCENT, 2.2); rimA.position.set(-2.5, 1, -2); scene.add(rimA);
  const rimB = new THREE.DirectionalLight(PRIMARY, 1.4); rimB.position.set(2, -1, -2.5); scene.add(rimB);

  /* ---- 网格地台（模型归一化后脚底 y=0） ---- */
  const grid = new THREE.GridHelper(6, 60, 0x22315c, 0x151a26);
  grid.material.transparent = true; grid.material.opacity = .5; grid.position.y = 0;
  scene.add(grid);

  const pivot = new THREE.Group();      // 自动旋转作用层（主角+幽灵+锚点随之转动，佩戴关系不散架）
  scene.add(pivot);

  /* ---- 图层透明度渐隐系统（300ms lerp；<1 时 depthWrite=false 防排序黑块，per D2§②） ---- */
  const layers = { brace: { mats: [], f: 1, t: 1, group: pivot }, ghost: null, bones: null, pins: null };
  const LERP_K = 10;                    // 1-e^(-10dt) ≈ 300ms 到 95%
  function makeLayer(group, baseMap) {  // baseMap: Map<material, baseOpacity>
    const mats = [...baseMap.entries()].map(([m, base]) => (m.userData.base = base, m.transparent = true, m));
    return { mats, f: 0, t: 0, group };
  }
  function tickFades(dt) {
    const k = 1 - Math.exp(-LERP_K * dt);
    for (const key of ['brace', 'ghost', 'bones', 'pins']) {
      const L = layers[key]; if (!L) continue;
      L.f += (L.t - L.f) * k;
      const on = L.f > .015;
      L.group.visible = on;
      if (!on) continue;
      for (const m of L.mats) {
        m.opacity = m.userData.base * L.f;
        m.depthWrite = L.f > .985 && m.userData.base >= 1;   // 全显且本体不透明时恢复写深度
      }
    }
  }

  /* ---- 主角：护具整机 GLB（自动扶正 + 居中 + 归一化，扶正逻辑照抄预览页） ---- */
  let modelReady = false;
  const draco = new DRACOLoader().setDecoderPath('./vendor/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  loader.load('./assets/models/leg_web.glb', (g) => {
    const model = g.scene;
    const braceMats = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone ? o.material.clone() : o.material;
      o.material.color = new THREE.Color('#9aa4b8');   // 中性材质（预览页同款）
      o.material.roughness = .55; o.material.metalness = .15;
      braceMats.set(o.material, 1);
    });
    // 自动扶正：包围盒长轴 → Y 向上（预览页已验证）
    let b = new THREE.Box3().setFromObject(model);
    let e = b.getSize(new THREE.Vector3());
    if (e.x > e.y && e.x >= e.z) model.rotation.z = Math.PI / 2;
    else if (e.z > e.y) model.rotation.x = -Math.PI / 2;
    // 居中 + 缩放至高 2.0 + 脚底落地
    const wrap = new THREE.Group(); wrap.add(model);
    b = new THREE.Box3().setFromObject(wrap);
    e = b.getSize(new THREE.Vector3());
    wrap.scale.setScalar(MODEL_H / e.y);
    b = new THREE.Box3().setFromObject(wrap);
    const c = b.getCenter(new THREE.Vector3());
    wrap.position.set(-c.x, -b.min.y, -c.z);
    pivot.add(wrap);
    layers.brace = makeLayer(wrap, braceMats);
    layers.brace.f = 0; layers.brace.t = MODES[mode].brace;   // 载入即按当前模式淡入
    modelReady = true;
    loadingEl.classList.add('off');
  }, undefined, () => showFallback('模型载入失败，已切换为产品渲染图轮播。请刷新重试，或返回落地页查看产品渲染图。'));

  /* ---- 幽灵层：胶囊腿（K6 §四裁决，仅 wear 模式淡入，accent 色 0.2） ---- */
  const ghostGroup = new THREE.Group();
  const ghostMat = () => new THREE.MeshStandardMaterial({
    color: GHOST, emissive: PRIMARY, emissiveIntensity: .35, roughness: .6, metalness: 0,
  });
  const gm = ghostMat();
  const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(.115, .9, 6, 18), gm);   // 大腿
  thigh.position.set(0, KNEE_Y + .62, .02);
  const gm2 = ghostMat();
  const calf = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .7, 6, 18), gm2);    // 小腿
  calf.position.set(0, KNEE_Y - .52, .02);
  const gm3 = ghostMat();
  const knee = new THREE.Mesh(new THREE.SphereGeometry(.1, 20, 14), gm3);         // 膝
  knee.position.set(0, KNEE_Y, .02);
  ghostGroup.add(thigh, calf, knee);
  ghostGroup.visible = false;
  pivot.add(ghostGroup);
  layers.ghost = makeLayer(ghostGroup, new Map([[gm, .2], [gm2, .2], [gm3, .2]]));

  /* ---- 解剖示意层（inner 模式）：程序化骨骼——股骨/胫骨/腓骨/髌骨/半月板 ---- */
  const bonesGroup = new THREE.Group();
  bonesGroup.visible = false;
  pivot.add(bonesGroup);
  {
    const boneMat = new THREE.MeshStandardMaterial({ color: '#C7CAD1', roughness: .62, metalness: .05, transparent: true });
    const cartMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: .85 }); // 半月板自发光示意（暗处可见）
    const femur = new THREE.Mesh(new THREE.CapsuleGeometry(.115, .72, 6, 18), boneMat);   // 股骨骨干
    femur.position.set(0, KNEE_Y + .47, .02);
    const condL = new THREE.Mesh(new THREE.SphereGeometry(.092, 18, 14), boneMat);        // 股骨内髁
    condL.position.set(-.078, KNEE_Y + .03, .035); condL.scale.set(1, 1.15, 1.1);
    const condR = new THREE.Mesh(new THREE.SphereGeometry(.092, 18, 14), boneMat);        // 股骨外髁
    condR.position.set(.078, KNEE_Y + .03, .035); condR.scale.set(1, 1.15, 1.1);
    const tibia = new THREE.Mesh(new THREE.CapsuleGeometry(.082, .62, 6, 18), boneMat);   // 胫骨
    tibia.position.set(0, KNEE_Y - .42, .02);
    const fibula = new THREE.Mesh(new THREE.CapsuleGeometry(.028, .56, 4, 10), boneMat);  // 腓骨（外侧细骨）
    fibula.position.set(.115, KNEE_Y - .40, 0);
    const patella = new THREE.Mesh(new THREE.SphereGeometry(.062, 18, 14), boneMat);      // 髌骨
    patella.scale.set(1, 1.18, .55); patella.position.set(0, KNEE_Y + .03, .145);
    const menL = new THREE.Mesh(new THREE.TorusGeometry(.068, .026, 10, 22, Math.PI * 1.3), cartMat); // 内侧半月板
    menL.rotation.x = Math.PI / 2; menL.rotation.z = .4; menL.position.set(-.072, KNEE_Y - .01, .035);
    const menR = new THREE.Mesh(new THREE.TorusGeometry(.068, .026, 10, 22, Math.PI * 1.3), cartMat); // 外侧半月板
    menR.rotation.x = Math.PI / 2; menR.rotation.z = -.4 + Math.PI; menR.position.set(.072, KNEE_Y - .01, .035);
    bonesGroup.add(femur, condL, condR, tibia, fibula, patella, menL, menR);
    layers.bones = makeLayer(bonesGroup, new Map([[boneMat, 1], [cartMat, .85]]));
  }

  /* ---- 部位热力层（heat 模式）：七区热点 + DOM 引线标签，颜色读 body.regions.v1 ---- */
  const pinsGroup = new THREE.Group();
  pinsGroup.visible = false;
  pivot.add(pinsGroup);
  const anchors = HEAT_ANCHORS.map((def) => {
    const g = new THREE.Group();
    g.position.set(def.off[0], KNEE_Y + def.off[1], def.off[2]);
    const core = new THREE.Mesh(new THREE.SphereGeometry(def.r, 24, 16),
      new THREE.MeshBasicMaterial({ color: ACCENT }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(def.r * 1.9, 20, 12),
      new THREE.MeshBasicMaterial({ color: ACCENT }));
    g.add(core, halo); g.userData = { def, core, halo, h: 0, screen: { x: 0, y: 0, vis: false } };
    pinsGroup.add(g);
    // DOM 引线标签：蓝点 + 白虚线 + 标签（含数值）
    const pin = document.createElement('button');
    pin.className = 'pin pin-heat'; pin.dataset.zone = def.id;
    pin.innerHTML = `<span class="pp"><i class="dot"></i><i class="lead"></i><span class="lbl"><b>${REGION_META[def.id].cn}</b><em class="val"></em></span></span>`;
    pin.addEventListener('click', (ev) => { ev.stopPropagation(); openCard(g); });
    pinsBox.appendChild(pin);
    g.userData.pin = pin;
    return g;
  });
  layers.pins = makeLayer(pinsGroup, new Map(anchors.flatMap((a) => [[a.userData.core.material, .95], [a.userData.halo.material, .16]])));

  /* 热力数据：读 body.regions.v1；演示种子（note 以「演示示例」开头）→ SIMULATED chip */
  let heatDemo = true;
  function updateHeat() {
    const { regions } = getBody();
    heatDemo = (regions['knee-anterior']?.note || '').startsWith('演示示例');
    for (const a of anchors) {
      const id = a.userData.def.id;
      const r = regions[id] || { pain: 0, load: 0 };
      const v = Math.min(10, Math.max(0, Number(r.pain) || 0));
      const color = painToColor(v) || '#8B909A';        // 0 值中性灰（无色阶处）
      a.userData.core.material.color.set(color);
      a.userData.halo.material.color.set(color);
      a.userData.val = v; a.userData.load = r.load ?? 0; a.userData.note = r.note || '';
      const dot = a.userData.pin.querySelector('.dot');
      dot.style.background = color; dot.style.boxShadow = `0 0 0 3px ${color}38, 0 0 16px ${color}b3`;
      a.userData.pin.querySelector('.val').textContent = ` ${v}/10`;
    }
    const chip = $('#heat-chip');
    if (chip) {
      chip.className = 'ku-chip ' + (heatDemo ? 'sim' : '');
      chip.textContent = heatDemo ? 'SIMULATED · 演示占位' : 'SUBJECTIVE · 主观记录';
    }
  }
  updateHeat();
  bus.on('region:update', updateHeat);

  /* ---- 模式切换 ---- */
  let mode = 'product', spinOn = MODES.product.spin && !REDUCED;
  const btns = [...document.querySelectorAll('#modes .mode-btn')];
  function setMode(name) {
    if (!MODES[name]) return;
    mode = name;
    const m = MODES[name];
    layers.brace.t = m.brace; layers.ghost.t = m.ghost; layers.bones.t = m.bones; layers.pins.t = m.pins;
    spinOn = m.spin && !REDUCED;
    tweenCam(m.cam, m.tgt);
    if (!m.spin) tweenPivot0();          // 离开缓旋模式时把模型缓转回正脸
    pinsBox.classList.toggle('is-on', name === 'heat');
    const hc = $('#heat-chip');
    if (hc) hc.style.display = name === 'heat' ? '' : 'none';
    hintEl.textContent = m.hint;
    btns.forEach((b) => b.classList.toggle('is-on', b.dataset.mode === name));
    closeCard();
  }
  btns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /* ---- 相机补间（lerp 不跳切） ---- */
  let camTween = null;
  controls.addEventListener('start', () => { camTween = null; });
  function tweenCam(pos, tgt, dur = 900) {
    camTween = { t0: performance.now(), dur,
      fp: camera.position.clone(), tp: new THREE.Vector3(...pos),
      ft: controls.target.clone(), tt: new THREE.Vector3(...tgt) };
  }
  function tickCamTween() {
    if (!camTween) return;
    const s = Math.min(1, (performance.now() - camTween.t0) / camTween.dur);
    const e = s < .5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
    camera.position.lerpVectors(camTween.fp, camTween.tp, e);
    controls.target.lerpVectors(camTween.ft, camTween.tt, e);
    if (s >= 1) camTween = null;
  }

  /* ---- pivot 缓旋归零补间 ---- */
  let pivotTween = null;
  function tweenPivot0() {
    const from = pivot.rotation.y;
    const to = Math.round(from / (Math.PI * 2)) * Math.PI * 2;
    if (Math.abs(to - from) < .01) return;
    pivotTween = { t0: performance.now(), dur: 700, from, to };
  }
  function tickPivotTween() {
    if (!pivotTween) return;
    const s = Math.min(1, (performance.now() - pivotTween.t0) / pivotTween.dur);
    pivot.rotation.y = pivotTween.from + (pivotTween.to - pivotTween.from) * (1 - Math.pow(1 - s, 3));
    if (s >= 1) pivotTween = null;
  }

  /* ---- 锚点交互：hover 放大 + 点击卡片（raycaster，仅 heat） ---- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null, cardAnchor = null, downPos = null;

  function pick(ev) {
    ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(anchors.map((a) => a.userData.core), false)[0];
    return hit ? hit.object.parent : null;
  }
  canvas.addEventListener('pointermove', (ev) => {
    if (mode !== 'heat') { setHover(null); return; }
    setHover(pick(ev));
  });
  canvas.addEventListener('pointerdown', (ev) => { downPos = [ev.clientX, ev.clientY]; });
  canvas.addEventListener('pointerup', (ev) => {
    if (!downPos) return;
    const moved = Math.hypot(ev.clientX - downPos[0], ev.clientY - downPos[1]); downPos = null;
    if (moved > 7 || mode !== 'heat') return;
    const a = pick(ev);
    a ? openCard(a) : closeCard();
  });
  canvas.addEventListener('pointerleave', () => setHover(null));
  function setHover(a) {
    if (hovered === a) return;
    hovered?.userData.pin.classList.remove('is-hot');
    hovered = a;
    a?.userData.pin.classList.add('is-hot');
    canvas.style.cursor = a ? 'pointer' : '';
  }

  function openCard(a) {
    const u = a.userData, id = u.def.id;
    const m = REGION_META[id];
    cardTitle.textContent = `${m.cn}区`; cardEn.textContent = m.en.toUpperCase();
    cardCn.textContent = `自评 ${u.val ?? 0}/10 · 负荷参考 ${u.load ?? 0}/10（主动记录）`;
    cardEnCopy.textContent = u.note ? `备注:${u.note}` : '色带:钴蓝(轻微)→琥珀(中等)→红(明显)';
    cardEl.querySelector('.ku-chip').className = 'ku-chip ' + (heatDemo ? 'sim' : '');
    cardEl.querySelector('.ku-chip').textContent = heatDemo ? 'SIMULATED · 演示占位' : 'SUBJECTIVE · 主观记录';
    cardAnchor = a;
    cardEl.hidden = false;
    setHover(a);
  }
  function closeCard() { cardAnchor = null; cardEl.hidden = true; }
  $('#zc-close').addEventListener('click', closeCard);

  /* ---- 投影：锚点 → DOM 图钉/卡片坐标 ---- */
  const v3 = new THREE.Vector3();
  function projectAnchors() {
    if (mode !== 'heat' && layers.pins.f < .02) return;
    for (const a of anchors) {
      a.getWorldPosition(v3).project(camera);
      const u = a.userData;
      u.screen.vis = v3.z < 1;
      if (u.screen.vis) {
        u.screen.x = (v3.x * .5 + .5) * innerWidth;
        u.screen.y = (-v3.y * .5 + .5) * innerHeight;
      }
      u.pin.style.transform = `translate(${u.screen.x}px, ${u.screen.y}px)`;
      u.pin.style.visibility = u.screen.vis ? 'visible' : 'hidden';
    }
    if (cardAnchor && !cardEl.hidden) {
      const s = cardAnchor.userData.screen;
      const w = cardEl.offsetWidth || 292, h = cardEl.offsetHeight || 200;
      cardEl.style.left = Math.max(12, Math.min(innerWidth - w - 12, s.x - w / 2)) + 'px';
      cardEl.style.top = Math.max(60, Math.min(innerHeight - h - 84, s.y - h - 26)) + 'px';
    }
  }

  /* ---- resize ---- */
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  /* ---- 上下文丢失 → 兜底（iOS 回归雷区，per C3） ---- */
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showFallback('3D 渲染上下文丢失，已切换为产品渲染图轮播。刷新页面可重试 3D 版。');
  });

  /* ---- 主循环 ---- */
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), .05);
    if (spinOn && modelReady) pivot.rotation.y += dt * SPIN_SPEED;   // 产品特写自动缓旋
    tickFades(dt);
    tickPivotTween();
    tickCamTween();
    for (const a of anchors) {                                        // hover/选中放大
      const t = (a === hovered || a === cardAnchor) ? 1 : 0;
      a.userData.h += (t - a.userData.h) * (1 - Math.exp(-dt * 12));
      const s = 1 + .85 * a.userData.h;
      a.userData.core.scale.setScalar(s);
      a.userData.halo.scale.setScalar(1 + .45 * a.userData.h);
    }
    controls.update();
    projectAnchors();
    renderer.render(scene, camera);
  });
}
