'use client';
import { useCallback, useState } from 'react';
import { Download, Play } from 'lucide-react';
import { downloadMaterial } from '@/lib/portal/downloadMaterial';
import { isViewableKind } from '@/lib/utils/attachmentKinds.mjs';
import PdfThumb from '../previews/PdfThumb';
import TextThumb from '../previews/TextThumb';
import OfficeThumb from '../previews/OfficeThumb';
import FileThumb from '@/components/ui/Attachments/FileThumb';
import IconAction from '@/components/ui/IconAction';

// Родини, яким Microsoft-вьювер малює першу сторінку. Це три родини спільного
// словника (doc/sheet/slides), а не одна вигадана тут «office».
const OFFICE_KINDS = ['doc', 'sheet', 'slides'];

export default function FileCard({ view, onOpen }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const handleThumbFailed = useCallback(() => setThumbFailed(true), []);

  const handleDownload = async (e) => {
    e.stopPropagation();
    await downloadMaterial(view.url, view.title);
  };

  const handleClick = () => {
    if (!view.url) return;
    // Те саме правило, що й у вкладеннях задачі: вьюер показує те, що браузер
    // уміє намалювати, решта відкривається як є.
    if (isViewableKind(view.kind)) onOpen(view);
    else window.open(view.url, '_blank', 'noopener,noreferrer');
  };

  // thumb тримає JSX-елемент, а не значення — він завжди truthy, тому провал
  // прев'ю (PdfThumb/TextThumb повертають null усередині себе) не спрацював би
  // через `thumb || <fallback/>` нижче. Тому будь-яка невдача підіймається сюди
  // через onFailed і гейтить сам вибір прев'ю через thumbFailed.
  let thumb = null;
  if (view.url && !thumbFailed) {
    if (view.kind === 'image') {
      // eslint-disable-next-line @next/next/no-img-element -- portal media is served from arbitrary partner hosts, which next/image cannot whitelist
      thumb = <img src={view.url} alt={view.title} onError={handleThumbFailed} className="h-[160px] w-full object-cover" />;
    } else if (view.kind === 'pdf') {
      thumb = <PdfThumb url={view.url} onFailed={handleThumbFailed} />;
    } else if (view.kind === 'video') {
      thumb = (
        <span className="relative block">
          {/* `#t=0.1` — той самий крок повз чорний перший кадр, що й у FileThumb. */}
          <video src={`${view.url}#t=0.1`} className="h-[160px] w-full bg-ink object-cover" preload="metadata" muted playsInline />
          <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
            <Play size={26} fill="currentColor" className="ml-[2px]" />
          </span>
        </span>
      );
    } else if (view.kind === 'text' || view.kind === 'code') {
      thumb = <TextThumb url={view.url} onFailed={handleThumbFailed} />;
    } else if (OFFICE_KINDS.includes(view.kind)) {
      thumb = <OfficeThumb url={view.url} title={view.title} />;
    }
  }

  return (
    <div data-ui-surface="local" className="group overflow-hidden rounded-[12px] border border-line bg-surface transition-shadow hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      <div className="relative">
        {thumb || (
          // Чесна заглушка, а не сірий аркуш: піктограма родини на її ж відтінку,
          // намальована тим самим `FileThumb`, що стоїть у рядку вкладення задачі
          // та в шапці вьюера. Один .xlsx — один зелений значок таблиці всюди.
          <div className="flex h-[160px] w-full items-center justify-center bg-canvas">
            <FileThumb attachment={view.attachment} density="lg" />
          </div>
        )}

        {/* Кнопка «відкрити» лежить ПІД кнопкою скачування: у тієї явний z-10,
            а в оверлея z-index: auto, і додатний z-index завжди виграє в auto
            незалежно від порядку в DOM (CSS 2.1 Appendix E). */}
        {view.url && (
          <button
            type="button"
            onClick={handleClick}
            aria-label={`Відкрити ${view.title}`}
            className="absolute inset-0 cursor-pointer"
          />
        )}

        {view.url && (
          <IconAction
            onClick={handleDownload}
            label={`Завантажити ${view.title}`}
            icon={Download}
            size="sm"
            shape="circle"
            appearance="overlay"
            className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          />
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <FileThumb attachment={view.attachment} density="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{view.title}</span>
          <span className="block truncate text-[11px] text-faint">{view.meta}</span>
        </span>
      </div>
    </div>
  );
}
