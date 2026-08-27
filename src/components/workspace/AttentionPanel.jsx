'use client';

// «Що потребує уваги», and the way through it.
//
// Both analytics screens found the same five things — blocked work, missed
// deadlines, critical priority, nobody assigned, no estimate — and both stopped
// at the number. «Без виконавця 14» told the reader there was a problem, told
// them exactly how big it was, and left them to go and rebuild the same filter
// by hand somewhere else. A finding you cannot act on is a decoration.
//
// So the row opens. The panel swaps its list of findings for the tasks behind
// the one that was picked, with a way back — the same move the help centre
// makes when an article opens over its own index. Nothing new is invented for
// it: `SignalList` learnt `onSelect`, `TaskListCard` already bounds a long list
// and already carries a control beside its title.
//
// It lives here rather than in the kit because it is a composition of two kit
// components with a product decision between them (which findings, and what
// their tasks are), not a new shape.

import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Info, OctagonAlert } from 'lucide-react';
import { ChartCard, IconAction, SignalList, TaskListCard } from '@/components/ui';

// The glyph the opened finding keeps, so the panel does not change species
// between the row and the list behind it.
const TONE_ICONS = {
  critical: OctagonAlert,
  warning: AlertTriangle,
  info: Info,
};

/**
 * @param {object[]} props.signals Findings, each carrying the `issues` it counted.
 * @param {object[]} props.allIssues Every task in scope, for parents and blockers.
 * @param {object[]} props.members Workspace members, for the avatars on a row.
 * @param {object[]} props.projects Projects, for naming each row's project.
 * @param {object[]} props.issueLinks Relations, for the blocked marker.
 * @param {string} props.emptyText The one line a workspace with nothing wrong gets.
 * @param {string} props.className Placement in the parent only.
 */
export default function AttentionPanel({
  signals = [],
  allIssues,
  members = [],
  projects = [],
  issueLinks = [],
  emptyText = 'Нічого термінового — усе під контролем',
  className = '',
}) {
  const [openId, setOpenId] = useState(null);
  const open = signals.find(signal => signal.id === openId);

  // What is open is derived, never mirrored: a finding that empties while it is
  // being read — somebody assigned the last unassigned task — simply stops
  // being found, and the panel falls back to the list instead of holding a
  // heading that promises fourteen over nothing. If the finding comes back, so
  // does the reader's place in it, which is what they asked for.

  if (open) {
    return (
      <TaskListCard
        title={open.title}
        icon={TONE_ICONS[open.tone] || AlertTriangle}
        count={open.issues?.length || 0}
        issues={open.issues || []}
        allIssues={allIssues}
        members={members}
        projects={projects}
        issueLinks={issueLinks}
        emptyText={open.description}
        className={className}
        back={(
          <IconAction
            label="Усі знахідки"
            tooltip
            icon={ArrowLeft}
            size="sm"
            appearance="soft"
            onClick={() => setOpenId(null)}
          />
        )}
      />
    );
  }

  return (
    <ChartCard icon={AlertTriangle} title="Що потребує уваги" className={className}>
      <SignalList signals={signals} onSelect={signal => setOpenId(signal.id)} emptyText={emptyText} />
    </ChartCard>
  );
}
