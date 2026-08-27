'use client';
import { X } from 'lucide-react';
import IconAction from '@/components/ui/IconAction';
import AttachmentViewer from '@/components/ui/AttachmentViewer';
import { useModalFocus } from '@/lib/hooks/useModalFocus';

/**
 * Повноекранний перегляд матеріалу. Тільки читання.
 *
 * Файл сюди більше не потрапляє власним шляхом: його показує `AttachmentViewer`
 * — той самий вьюер, що відкриває вкладення задачі та файл із чату. Тут лишилась
 * єдина річ, якої в тому вьюері немає й бути не може: нотатка, бо вона не файл і
 * не має URL.
 */
function NoteLightbox({ view, onClose }) {
  const dialogRef = useModalFocus({ isOpen: true, onClose });

  return (
    <div
      data-ui-overlay="media-viewer"
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={view.title}
    >
      <IconAction
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        label="Закрити"
        icon={X}
        size="lg"
        shape="circle"
        appearance="inverse"
        className="absolute right-4 top-4"
      />

      <div className="flex max-h-[90vh] max-w-[640px] flex-col items-stretch gap-3" onClick={(e) => e.stopPropagation()}>
        <div
          data-ui-surface="card"
          data-ui-padding="xl"
          className="ui-surface max-h-[80vh] overflow-y-auto"
          style={{ backgroundColor: view.note.color }}
        >
          <p className="whitespace-pre-wrap text-[15px] text-ink">{view.note.content}</p>
          {view.note.source && <p className="mt-3 text-[12px] italic text-muted">Джерело: {view.note.source}</p>}
        </div>
        <p className="text-center text-[13px] text-white/70">{view.title}</p>
      </div>
    </div>
  );
}

export default function MediaLightbox({ view, onClose }) {
  if (!view) return null;
  if (view.kind === 'note') return <NoteLightbox view={view} onClose={onClose} />;
  return <AttachmentViewer attachment={view.attachment} onClose={onClose} />;
}
