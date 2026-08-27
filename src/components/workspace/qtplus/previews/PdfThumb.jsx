'use client';
import { useEffect, useState } from 'react';

/**
 * Мініатюра першої сторінки PDF. pdfjs-dist з npm, не з CDN (портал інжектить
 * <script> з cdnjs у рантаймі — зовнішня точка відмови). Рендер локальний,
 * файл нікуди не надсилається. import() динамічний: воркер важкий, тягнемо
 * лише коли PDF реально є на екрані.
 */
export default function PdfThumb({ url, onFailed }) {
  const [thumb, setThumb] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // ЛОКАЛЬНА змінна, НЕ useRef. Ref спільний для всіх перезапусків ефекту:
    // при зміні url cleanup поставив би canceled=true, а новий ефект одразу
    // скинув би ТОЙ САМИЙ ref назад у false — і стара обіцянка записала б
    // мініатюру чужого файлу. Локальний let приватний для свого виклику,
    // тож скасований виклик уже нічим не «розскасувати». Так само в TextThumb.
    let canceled = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // new URL(..., import.meta.url) — те, що розуміють і Turbopack, і webpack5.
        // НЕ використовувати суфікс '?url': це конвенція Vite, у Next вона не збереться.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        const pdf = await pdfjs.getDocument(url).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (!canceled) setThumb(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        if (!canceled) { setFailed(true); onFailed?.(); }
      }
    })();
    return () => { canceled = true; };
  }, [url, onFailed]);

  if (failed) return null;
  if (!thumb) {
    return (
      <div className="w-full h-[160px] bg-canvas flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-line border-t-muted rounded-full animate-spin" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- rendered client-side into a canvas data: URL, which next/image cannot process
  return <img src={thumb} alt="" className="w-full h-[160px] object-cover object-top" />;
}
