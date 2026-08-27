'use client';
import { toMaterialView } from '@/lib/portal/qtplusMaterialView.mjs';
import FileCard from './cards/FileCard';
import AudioCard from './cards/AudioCard';
import LinkCard from './cards/LinkCard';
import NoteCard from './cards/NoteCard';
import ChecklistCard from './cards/ChecklistCard';
import PollCard from './cards/PollCard';

/** Єдина точка, де сирий док стає view і обирається картка. */
export default function MaterialCard({ raw, onOpen }) {
  const view = toMaterialView(raw);

  if (view.kind === 'audio') return <AudioCard view={view} />;
  if (view.kind === 'link') return <LinkCard view={view} />;
  if (view.kind === 'note') return <NoteCard view={view} onOpen={onOpen} />;
  if (view.kind === 'checklist') return <ChecklistCard view={view} />;
  if (view.kind === 'poll') return <PollCard view={view} />;
  return <FileCard view={view} onOpen={onOpen} />;
}
