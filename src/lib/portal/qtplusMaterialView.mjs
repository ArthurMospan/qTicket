/**
 * Чисті view-model хелпери матеріалів QuickTeam+ (Фаза 4a′).
 * Без `server-only` / Firebase — виконується під `node --test`.
 *
 * Схема матеріалу — з РЕАЛЬНОГО порталу (qt/src/components/MaterialsGrid.jsx,
 * qt/src/lib/hooks/useMaterials.js):
 *   previewUrl — файли/зображення/відео/PDF/документи (Cloudinary)
 *   audioUrl   — аудіо (Cloudinary)
 *   url        — ТІЛЬКИ type='link'
 *   fileType   — MIME браузера (file.type) для завантажених файлів
 * Фаза 4a читала `url` для всього й тому рендерила файли без посилання.
 *
 * Що таке файл, вирішує НЕ цей модуль. `attachmentKinds.mjs` — єдине місце в
 * продукті, яке відповідає на це питання: вкладення задачі, файл у чаті та
 * матеріал порталу тепер дають однакову родину, однакову піктограму й однаковий
 * підпис. Раніше тут жив власний словник із п'ятьма родинами й власною
 * палітрою бейджів, тому .xlsx у задачі був «Таблиця», а той самий .xlsx у
 * QuickTeam+ — синій «DOC».
 */

// Відносний шлях, а не аліас `@/…`: цей модуль читає `node --test` напряму, а
// про jsconfig-аліаси Node не знає. Так само в решті `.mjs` під src/lib.
import { attachmentKind, attachmentKindLabel } from '../utils/attachmentKinds.mjs';

const PASSTHROUGH_KINDS = ['link', 'checklist', 'poll', 'note'];

// Портальний скетч не їде в сховище: полотно зберігається як base64-PNG прямо в
// документі матеріалу (qt FunctionalModals.jsx — canvas.toDataURL('image/png')).
// Тому суцільна заборона `data:` означала «намальоване від руки не існує»: URL
// відкидався, картка лишалась без прев'ю й без дії. Пропускаємо лише РАСТРОВІ
// зображення — саме те, що пише полотно. SVG свідомо поза списком: він виконує
// скрипт, якщо його відкрити як документ, а решта схем (`javascript:`,
// `data:text/html`) не проходить взагалі.
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/;

/** Розширення з назви: 'logo.PNG' -> 'png'. */
export function extOf(title) {
  if (typeof title !== 'string') return '';
  const i = title.lastIndexOf('.');
  if (i <= 0 || i === title.length - 1) return '';
  return title.slice(i + 1).toLowerCase();
}

/**
 * URL матеріалу за правилами порталу. Пропускаємо http(s) і растровий
 * `data:image/*` (скетч) — решта схем у href дала б XSS через дані порталу.
 */
export function resolveMaterialUrl(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const candidate = [m.audioUrl, m.previewUrl, m.url].find((v) => typeof v === 'string' && v);
  if (!candidate) return null;
  if (candidate.startsWith('data:')) return DATA_IMAGE.test(candidate) ? candidate : null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : null;
}

/**
 * Вкладенняподібна форма матеріалу — те, що `attachmentKinds.mjs` уміє читати.
 * Одна форма і для визначення родини, і для перегляду у вьюері, тому картка та
 * вьюер не можуть розійтись у тому, що це за файл.
 */
export function toAttachmentShape(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    name: (typeof m.title === 'string' && m.title.trim()) || 'Без назви',
    previewUrl: resolveMaterialUrl(m),
    mimeType: typeof m.fileType === 'string' ? m.fileType : undefined,
  };
}

/**
 * Вид матеріалу: або власний тип порталу (нотатка, чеклист, опитування,
 * посилання), або родина файлу зі спільного словника вкладень.
 */
export function kindOf(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  if (PASSTHROUGH_KINDS.includes(m.type)) return m.type;
  // Явний сигнал аудіо перемагає розширення й мусить стояти ПЕРЕД усім іншим:
  // диктофон порталу кодує запис через MediaRecorder у audio/webm або audio/mp4
  // і зберігає title='audio-recording-*.webm' — а webm/mp4 читаються як відео.
  // Тому на розширення покладатись не можна; type:'audio' та audioUrl однозначні
  // (у відео їх немає — воно приходить як type:'file' з previewUrl).
  if (m.type === 'audio' || (typeof m.audioUrl === 'string' && m.audioUrl)) return 'audio';
  return attachmentKind(toAttachmentShape(m));
}

/** Як називається ця родина в інтерфейсі — той самий підпис, що й у задачі. */
export function kindLabelOf(raw) {
  return attachmentKindLabel(kindOf(raw));
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Сирий док матеріалу -> готова до рендеру модель. */
export function toMaterialView(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const kind = kindOf(m);
  const url = resolveMaterialUrl(m);
  const title = (typeof m.title === 'string' && m.title.trim()) || 'Без назви';

  let checklist = null;
  if (kind === 'checklist') {
    const items = Array.isArray(m.items) ? m.items : [];
    const checkedItems = Array.isArray(m.checkedItems) ? m.checkedItems : [];
    const total = items.length;
    const done = checkedItems.length;
    checklist = { items, checkedItems, done, total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  let poll = null;
  if (kind === 'poll') {
    const options = Array.isArray(m.options) ? m.options : [];
    const votes = Array.isArray(m.votes) ? m.votes : [];
    const total = votes.reduce((a, b) => a + (Number(b) || 0), 0);
    poll = {
      total,
      results: options.map((option, i) => {
        const count = Number(votes[i]) || 0;
        return { option, count, percent: total ? Math.round((count / total) * 100) : 0 };
      }),
    };
  }

  // `color` — колір стікера, який ставить портал (за замовчуванням #fff3cd).
  // Без нього нотатка в нас була білим прямокутником серед білих карток файлів,
  // хоч у клієнта вона жовта; це те саме, що показувати чужу нотатку.
  const note = kind === 'note'
    ? {
        content: typeof m.content === 'string' ? m.content : '',
        source: m.source || null,
        color: typeof m.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(m.color) ? m.color : '#fff3cd',
      }
    : null;

  const link = kind === 'link'
    ? {
        domain: domainOf(typeof m.url === 'string' ? m.url : ''),
        image: m.ogImage || null,
        title: m.ogTitle || title,
        description: m.ogDescription || null,
      }
    : null;

  // `meta` — рядок під назвою: «PDF · 1.2 MB». Рівно та сама конструкція, що й
  // `attachmentMetaLabel` у вкладеннях задачі; розмір беремо з `desc`, бо портал
  // кладе туди готовий рядок розміру й байтів у нас немає.
  const isFileKind = !PASSTHROUGH_KINDS.includes(kind);
  const subtitle = m.desc || m.source || null;

  return {
    id: m.id || null,
    kind,
    title,
    subtitle,
    meta: isFileKind ? [attachmentKindLabel(kind), subtitle].filter(Boolean).join(' · ') : null,
    url,
    // Форма, яку читають FileThumb та AttachmentViewer — щоб картка й вьюер
    // визначали родину файлу одним і тим самим кодом.
    attachment: isFileKind ? toAttachmentShape(m) : null,
    checklist,
    poll,
    note,
    link,
  };
}
