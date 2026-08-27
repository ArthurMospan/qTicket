'use client';
import { Download } from 'lucide-react';
import { downloadMaterial } from '@/lib/portal/downloadMaterial';
import IconAction from '@/components/ui/IconAction';
import AudioPlayer from '@/components/ui/Attachments/AudioPlayer';

// The card is now just the surface around the kit's player. The playback logic
// it used to own — reading state off the element rather than off the clicks,
// the keyboard-seekable track — moved into `AudioPlayer` unchanged, because it
// was the only working audio player in the product and three other screens that
// needed one had none.
export default function AudioCard({ view }) {
  return (
    <div data-ui-surface="compact-bordered-card" data-ui-padding="sm" className="ui-surface group">
      <AudioPlayer
        src={view.url}
        title={view.title}
        actions={view.url ? (
          <IconAction
            onClick={() => downloadMaterial(view.url, view.title)}
            label={`Завантажити ${view.title}`}
            icon={Download}
            size="sm"
            shape="circle"
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          />
        ) : null}
      />
    </div>
  );
}
