// 自绘 SVG 前视人体轮廓 + 七区可点（D7 区域表）· 三步交互：点区域→底部 sheet（自评/负荷滑杆）→确认着色
// 色带 钴蓝→琥珀→红；写 body.regions.v1；每区状态显示带 SUBJECTIVE+SIMULATED 双 chip；bus.emit('region:update')
import { getBody, setRegion } from '../data/repo.js';
import { bus } from '../bus.js';
import { tok } from '../viz/charts.js';

export const REGION_META = {
  'knee-anterior': { cn: '膝前', en: 'Anterior Knee' },
  'knee-medial': { cn: '膝内侧', en: 'Inner Knee' },
  'knee-lateral': { cn: '膝外侧', en: 'Outer Knee' },
  'knee-posterior': { cn: '膝后', en: 'Back of Knee' },
  hip: { cn: '髋', en: 'Hip' },
  ankle: { cn: '踝', en: 'Ankle' },
  contra: { cn: '对侧对照', en: 'Other Side' },
};

// ---- 色带：accent(0) → warn(5) → danger(10) ----
function hex2rgb(h) {
  h = h.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function painToColor(v) {
  if (!v || v <= 0) return null;
  const stops = [
    [0, hex2rgb(tok('--accent'))],
    [5, hex2rgb(tok('--warn'))],
    [10, hex2rgb(tok('--danger'))],
  ];
  const x = Math.min(10, Math.max(0, v));
  let a = stops[0], b = stops[1];
  if (x >= 5) { a = stops[1]; b = stops[2]; }
  const t = (x - a[0]) / (b[0] - a[0] || 1);
  const c = a[1].map((ch, i) => Math.round(ch + (b[1][i] - ch) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const LIMB_OUT = 'M102,112 C84,150 80,210 88,298 M198,112 C216,150 220,210 212,298 M124,306 C120,360 118,420 122,480 C124,530 126,560 126,586 M176,306 C180,360 182,420 178,480 C176,530 174,560 174,586';

function regionSvg(id, inner, label, lx, ly, vx, vy) {
  const m = REGION_META[id];
  return `<g class="bm-region" data-region="${id}" tabindex="0" role="button" aria-label="${m.cn} ${m.en}，点击记录">
    <title>${m.cn} · ${m.en}</title>
    ${inner}
    ${label ? `<text class="bm-label" x="${lx}" y="${ly}" text-anchor="middle">${label}</text>` : ''}
    <text class="bm-val" x="${vx}" y="${vy}" text-anchor="middle"></text>
  </g>`;
}

function buildSvg() {
  return `
  <svg class="bodymap-svg" viewBox="0 0 300 640" xmlns="http://www.w3.org/2000/svg" aria-label="前视身体图，七个可点区域">
    <defs>
      <pattern id="ku-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="${tok('--muted')}" stroke-width="1" opacity=".45"/>
      </pattern>
    </defs>

    <!-- 简笔轮廓：头/颈/躯干 -->
    <g class="bm-body" stroke="${tok('--line')}" fill="${tok('--panel-2')}">
      <circle cx="150" cy="52" r="26"/>
      <rect x="141" y="74" width="18" height="24" rx="7"/>
      <path d="M100,102 C122,95 178,95 200,102 C205,140 197,200 190,250 L186,308 L114,308 L110,250 C103,200 95,140 100,102 Z"/>
    </g>
    <!-- 双臂/双腿：外描边 + 内填充 -->
    <path d="${LIMB_OUT}" fill="none" stroke="${tok('--line')}" stroke-width="18" stroke-linecap="round"/>
    <path d="${LIMB_OUT}" fill="none" stroke="${tok('--panel-2')}" stroke-width="14" stroke-linecap="round"/>
    <circle cx="88" cy="306" r="9" fill="${tok('--panel-2')}" stroke="${tok('--line')}"/>
    <circle cx="212" cy="306" r="9" fill="${tok('--panel-2')}" stroke="${tok('--line')}"/>

    <!-- 对侧对照（左腿整段覆盖） -->
    ${regionSvg('contra',
      `<rect x="102" y="306" width="42" height="288" rx="21" fill="transparent" pointer-events="all"/>
       <rect class="hit" data-dfill="transparent" x="106" y="306" width="34" height="288" rx="17" fill="transparent" stroke="${tok('--muted')}" stroke-dasharray="4 4"/>`,
      '对侧对照', 123, 616, 123, 380)}

    <!-- 膝后（背面示意：斜纹虚线椭圆，垫在膝前点组之下） -->
    ${regionSvg('knee-posterior',
      `<ellipse cx="122" cy="432" rx="18" ry="30" fill="transparent" pointer-events="all"/>
       <ellipse cx="178" cy="432" rx="18" ry="30" fill="transparent" pointer-events="all"/>
       <ellipse class="hit" data-dfill="url(#ku-hatch)" cx="122" cy="432" rx="14" ry="26" fill="url(#ku-hatch)" stroke="${tok('--muted')}" stroke-dasharray="3 3"/>
       <ellipse class="hit" data-dfill="url(#ku-hatch)" cx="178" cy="432" rx="14" ry="26" fill="url(#ku-hatch)" stroke="${tok('--muted')}" stroke-dasharray="3 3"/>`,
      '膝后·背面', 150, 478, 150, 390)}

    <!-- 髋（双侧大转子） -->
    ${regionSvg('hip',
      `<circle cx="111" cy="298" r="17" fill="transparent" pointer-events="all"/>
       <circle cx="189" cy="298" r="17" fill="transparent" pointer-events="all"/>
       <circle class="hit" data-dfill="transparent" cx="111" cy="298" r="11" fill="transparent" stroke="${tok('--line')}"/>
       <circle class="hit" data-dfill="transparent" cx="189" cy="298" r="11" fill="transparent" stroke="${tok('--line')}"/>`,
      '髋', 70, 302, 70, 322)}

    <!-- 膝外侧（双膝外缘） -->
    ${regionSvg('knee-lateral',
      `<ellipse cx="110" cy="432" rx="11" ry="20" fill="transparent" pointer-events="all"/>
       <ellipse cx="190" cy="432" rx="11" ry="20" fill="transparent" pointer-events="all"/>
       <ellipse class="hit" data-dfill="transparent" cx="110" cy="432" rx="8" ry="17" fill="transparent" stroke="${tok('--line')}"/>
       <ellipse class="hit" data-dfill="transparent" cx="190" cy="432" rx="8" ry="17" fill="transparent" stroke="${tok('--line')}"/>`,
      '膝外侧', 62, 436, 62, 456)}

    <!-- 膝内侧（双膝内缘） -->
    ${regionSvg('knee-medial',
      `<ellipse cx="135" cy="432" rx="11" ry="20" fill="transparent" pointer-events="all"/>
       <ellipse cx="165" cy="432" rx="11" ry="20" fill="transparent" pointer-events="all"/>
       <ellipse class="hit" data-dfill="transparent" cx="135" cy="432" rx="8" ry="17" fill="transparent" stroke="${tok('--line')}"/>
       <ellipse class="hit" data-dfill="transparent" cx="165" cy="432" rx="8" ry="17" fill="transparent" stroke="${tok('--line')}"/>`,
      '膝内侧', 150, 520, 150, 540)}

    <!-- 膝前（髌面圆点组） -->
    ${regionSvg('knee-anterior',
      `<circle class="hit" data-dfill="transparent" cx="122" cy="416" r="9" fill="transparent" stroke="${tok('--line')}"/>
       <circle class="hit" data-dfill="transparent" cx="122" cy="433" r="9" fill="transparent" stroke="${tok('--line')}"/>
       <circle class="hit" data-dfill="transparent" cx="122" cy="450" r="9" fill="transparent" stroke="${tok('--line')}"/>
       <circle class="hit" data-dfill="transparent" cx="178" cy="416" r="9" fill="transparent" stroke="${tok('--line')}"/>
       <circle class="hit" data-dfill="transparent" cx="178" cy="433" r="9" fill="transparent" stroke="${tok('--line')}"/>
       <circle class="hit" data-dfill="transparent" cx="178" cy="450" r="9" fill="transparent" stroke="${tok('--line')}"/>`,
      '膝前', 150, 500, 150, 500)}

    <!-- 踝（双外踝上方） -->
    ${regionSvg('ankle',
      `<ellipse cx="126" cy="568" rx="13" ry="18" fill="transparent" pointer-events="all"/>
       <ellipse cx="174" cy="568" rx="13" ry="18" fill="transparent" pointer-events="all"/>
       <ellipse class="hit" data-dfill="transparent" cx="126" cy="568" rx="9" ry="13" fill="transparent" stroke="${tok('--line')}"/>
       <ellipse class="hit" data-dfill="transparent" cx="174" cy="568" rx="9" ry="13" fill="transparent" stroke="${tok('--line')}"/>`,
      '踝', 62, 572, 62, 592)}
  </svg>`;
}

export function mountBodymap(container) {
  container.innerHTML = buildSvg();

  // 底部 sheet（三步交互第二步）
  const sheet = document.createElement('div');
  sheet.className = 'bm-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', '区域记录');
  sheet.innerHTML = `
    <div class="sheet-head">
      <strong id="bm-sheet-name"></strong>
      <span class="ku-chip">主观记录 SUBJECTIVE</span>
      <span class="ku-chip sim">模拟示例 SIMULATED</span>
      <button class="sheet-close" id="bm-close" aria-label="关闭">×</button>
    </div>
    <p class="sheet-sub">0–10 自评，仅您自己可见 · 非医疗评估 · Not a medical assessment</p>
    <div class="slider-row">
      <label for="bm-pain">自评 Subjective <output id="bm-pain-out">0/10</output></label>
      <input type="range" id="bm-pain" min="0" max="10" step="1" value="0">
    </div>
    <div class="slider-row">
      <label for="bm-load">负荷参考 Load（模拟） <output id="bm-load-out">0/10</output></label>
      <input type="range" id="bm-load" min="0" max="10" step="1" value="0">
    </div>
    <div class="slider-row">
      <label for="bm-note">备注 Note</label>
      <input type="text" id="bm-note" maxlength="60" placeholder="可留一句备注（可选）">
    </div>
    <div class="sheet-actions">
      <button class="btn" id="bm-save">保存记录 Save entry</button>
      <button class="btn ghost" id="bm-cancel">取消</button>
    </div>`;
  document.body.appendChild(sheet);

  let activeRegion = null;

  function applyColors() {
    const { regions } = getBody();
    container.querySelectorAll('.bm-region').forEach(g => {
      const id = g.dataset.region;
      const r = regions[id] || { pain: 0, load: 0, note: '' };
      const color = painToColor(r.pain);
      g.querySelectorAll('.hit').forEach(el => {
        if (color) { el.setAttribute('fill', color); el.setAttribute('fill-opacity', '0.85'); }
        else { el.setAttribute('fill', el.dataset.dfill || 'transparent'); el.setAttribute('fill-opacity', '1'); }
      });
      const val = g.querySelector('.bm-val');
      if (val) val.textContent = r.pain > 0 ? `${r.pain}/10` : '';
      g.classList.toggle('has-val', r.pain > 0);
    });
  }

  function openSheet(id) {
    activeRegion = id;
    const m = REGION_META[id];
    const cur = getBody().regions[id] || { pain: 0, load: 0, note: '' };
    sheet.querySelector('#bm-sheet-name').textContent = `${m.cn} ${m.en}`;
    const p = sheet.querySelector('#bm-pain'), l = sheet.querySelector('#bm-load'), n = sheet.querySelector('#bm-note');
    p.value = cur.pain; l.value = cur.load; n.value = cur.note || '';
    sheet.querySelector('#bm-pain-out').textContent = `${cur.pain}/10`;
    sheet.querySelector('#bm-load-out').textContent = `${cur.load}/10`;
    sheet.classList.add('open');
    container.querySelectorAll('.bm-region').forEach(g => g.classList.toggle('is-active', g.dataset.region === id));
  }

  function closeSheet() {
    sheet.classList.remove('open');
    activeRegion = null;
    container.querySelectorAll('.bm-region').forEach(g => g.classList.remove('is-active'));
  }

  container.querySelectorAll('.bm-region').forEach(g => {
    g.addEventListener('click', () => openSheet(g.dataset.region));
    g.addEventListener('keydown', e => { if (e.key === 'Enter') openSheet(g.dataset.region); });
  });

  sheet.querySelector('#bm-pain').addEventListener('input', e => { sheet.querySelector('#bm-pain-out').textContent = `${e.target.value}/10`; });
  sheet.querySelector('#bm-load').addEventListener('input', e => { sheet.querySelector('#bm-load-out').textContent = `${e.target.value}/10`; });
  sheet.querySelector('#bm-close').addEventListener('click', closeSheet);
  sheet.querySelector('#bm-cancel').addEventListener('click', closeSheet);
  sheet.querySelector('#bm-save').addEventListener('click', () => {
    if (!activeRegion) return;
    setRegion(activeRegion, {
      pain: +sheet.querySelector('#bm-pain').value,
      load: +sheet.querySelector('#bm-load').value,
      note: sheet.querySelector('#bm-note').value.trim(),
    });
    applyColors(); // repo 已 emit region:update（三源联动通道）
    closeSheet();
  });

  const offBus = bus.on('region:update', () => applyColors());
  const onKey = e => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);

  applyColors();

  return () => {
    offBus();
    document.removeEventListener('keydown', onKey);
    sheet.remove();
  };
}
