// 导出——自包含 JSON 文件下载（integrityNote 逐条保留 source，不得抹除）
import { store } from '../store.js';
import { getSessions, getBody } from './repo.js';

export function buildExport() {
  const profile = store.get('profile.v1', null) || {};
  return {
    exportVersion: 1,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: 'kneeup-web',
    appVersion: '1.0.0',
    integrityNote: '含模拟数据，source 字段逐条标注，不得抹除',
    profile: { nicknameHash: null, createdAt: profile.createdAt || null },
    sessions: getSessions(),
    body: getBody(),
  };
}

export function exportAll() {
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const name = `kneeup-data-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  try {
    const blob = new Blob([JSON.stringify(buildExport(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return name;
  } catch (e) {
    console.error('[export]', e);
    return null;
  }
}
