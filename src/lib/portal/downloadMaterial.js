'use client';

import useWorkspaceStore from '@/store/useWorkspaceStore';

/**
 * Качає матеріал порталу. Патерн порталу (qt/src/components/MaterialsGrid.jsx:1120):
 * fetch -> blob -> <a download> -> revoke. Фолбек критичний: Cloudinary може не
 * віддати CORS-заголовки для деяких типів, тоді fetch падає — і файл усе одно
 * має дістатись користувачеві, хай і в новій вкладці.
 *
 * Фолбек `window.open` викликається ПІСЛЯ `await fetch`, тобто вже поза
 * user-gesture тасков — Chrome/Safari можуть заблокувати попап. Перевіряємо
 * повернене значення й повідомляємо користувача в обох випадках: інакше клік
 * на «Завантажити» іноді не робить рівним рахунком нічого.
 *
 * Повертає: 'downloaded' | 'opened' | 'blocked' | 'skipped'.
 *
 * Нічого не пише — читання плюс DOM.
 */
export async function downloadMaterial(url, filename) {
  if (!url) return 'skipped';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    return 'downloaded';
  } catch {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win) {
      try { useWorkspaceStore.getState().showToast('Відкриваємо у новій вкладці'); } catch { /* тост не критичний */ }
      return 'opened';
    }
    try {
      useWorkspaceStore.getState().showToast('Не вдалося завантажити файл. Дозвольте спливні вікна для цього сайту.', 'error');
    } catch { /* тост не критичний */ }
    return 'blocked';
  }
}
