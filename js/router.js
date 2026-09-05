// hash 路由（#/patient|#/coach|#/screen|#/game|#/body）——切页销毁旧视图 + 滚动顶
import { renderPatient } from './views/patient.js';
import { renderCoach } from './views/coach.js';
import { renderScreen } from './views/screen.js';
import { renderGameEmbed } from './views/game-embed.js';
import { renderBody } from './views/body.js';

const routes = {
  patient: { title: '用户端', render: renderPatient },
  coach: { title: '教练端', render: renderCoach },
  screen: { title: 'AI数据屏', render: renderScreen },
  game: { title: '训练游戏', render: renderGameEmbed },
  body: { title: '身体记录', render: renderBody },
};

let cleanup = null;

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[h] ? h : 'patient';
}

function mountView() {
  const el = document.getElementById('app');
  if (!el) return;
  const key = currentRoute();
  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error('[router] cleanup', e); } }
  cleanup = null;
  el.innerHTML = '';
  document.querySelectorAll('#apps-nav .apps-chip').forEach(a =>
    a.classList.toggle('is-active', a.dataset.route === key));
  document.title = `KneeUp Apps · ${routes[key].title}`;
  const ret = routes[key].render(el);
  if (typeof ret === 'function') cleanup = ret;
  window.scrollTo(0, 0);
}

export function initRouter() {
  window.addEventListener('hashchange', mountView);
  mountView();
}

initRouter();
