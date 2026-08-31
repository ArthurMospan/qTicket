import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('custom modals share one complete keyboard and scroll-lock contract', async () => {
  const hook = await read('../src/lib/hooks/useModalFocus.js');

  assert.match(hook, /event\.key === 'Escape'/);
  assert.match(hook, /event\.key !== 'Tab'/);
  assert.match(hook, /modalStack\[modalStack\.length - 1\] !== token/);
  assert.match(hook, /bodyLockCount \+= 1/);
  assert.match(hook, /previouslyFocused\.focus\(\)/);
  assert.match(hook, /\(event\.shiftKey \? last : first\)\.focus\(\)/);
  assert.match(hook, /querySelector\('\[data-qt-floating-overlay\]'\)/);
});

test('shared dialogs own a browser-history entry and protect dirty drafts', async () => {
  const [dialog, historyHook, createTask] = await Promise.all([
    read('../src/components/ui/Dialog.jsx'),
    read('../src/lib/hooks/useOverlayHistory.js'),
    read('../src/components/CreateTaskModal.jsx'),
  ]);

  assert.match(dialog, /useOverlayHistory\(\{ isOpen, onClose, isDirty, closeConfirmation \}\)/);
  assert.match(dialog, /useModalFocus\(\{ isOpen, onClose: requestClose \}\)/);
  assert.match(historyHook, /window\.history\.pushState/);
  assert.match(historyHook, /window\.addEventListener\('popstate'/);
  assert.match(historyHook, /window\.history\.back\(\)/);
  assert.match(historyHook, /window\.confirm\(confirmationRef\.current\)/);
  assert.match(createTask, /isDirty=\{draftTouched\}/);
});

test('Escape closes a floating control, then its form, then the task page', async () => {
  const [select, popover, contextMenu, escapeHook, issueDetail] = await Promise.all([
    read('../src/components/ui/Select.jsx'),
    read('../src/components/ui/Navigation/Popover.jsx'),
    read('../src/components/ui/ContextMenu.jsx'),
    read('../src/lib/hooks/useFloatingOverlayEscape.js'),
    read('../src/components/workspace/IssueDetail.jsx'),
  ]);

  assert.ok((select.match(/event\.stopPropagation\(\)/g) || []).length >= 3);
  assert.match(popover, /useFloatingOverlayEscape\(\{ open: isOpen/);
  assert.match(contextMenu, /useFloatingOverlayEscape\(\{ open: isOpen/);
  assert.match(escapeHook, /event\.stopPropagation\(\)/);
  assert.match(issueDetail, /if \(showLinkInput\) \{ setShowLinkInput\(false\); return; \}/);
  // Escape still leaves edit mode — but a draft that says something the task
  // does not is confirmed away rather than dropped on the floor.
  assert.match(issueDetail, /if \(!draftIsDirty\) \{ setIsEditing\(false\); return; \}/);
  assert.match(issueDetail, /confirmDialog\(UNSAVED_EDIT_PROMPT\)\.then\(discard => \{/);
  assert.match(issueDetail, /router\.push\(`\/\$\{projectId\}`\)/);
});

test('walking off a task mid-edit is confirmed, not silently discarded', async () => {
  const [issueDetail, settings] = await Promise.all([
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/app/(app)/settings/page.js'),
  ]);

  // One wording for the one situation, on both pages that can be dirty.
  for (const source of [issueDetail, settings]) {
    assert.match(source, /title: 'Незбережені зміни'/);
  }

  // The draft is dirty only when it differs from the stored task, so merely
  // opening the editor never prompts.
  assert.match(issueDetail, /const draftIsDirty = Boolean\(isEditing && issue && \(/);
  // `issue?.` rather than `issue.`: every read above the `if (!issue)` guard has
  // to tolerate the request being absent, because that is every first paint —
  // `issues.find(...)` has nothing to find until the stream arrives, and the
  // guard cannot move up to meet it because hooks run in between. One of those
  // reads being unguarded is what threw «can't access property "assigneeIds"»
  // and put the whole workspace behind «qTicket не завантажився» on refresh.
  assert.match(issueDetail, /\(draft\.description \|\| ''\) !== \(issue\?\.description \|\| ''\)/);

  // A reload or a closed tab, and in-app <Link> clicks caught before Next's own
  // handler so the navigation can still be cancelled.
  assert.match(issueDetail, /window\.addEventListener\('beforeunload', onBeforeUnload\)/);
  assert.match(issueDetail, /document\.addEventListener\('click', onClickCapture, true\)/);
  assert.match(issueDetail, /event\.preventDefault\(\);\s*\n\s*event\.stopPropagation\(\);/);
});

test('every product dialog outside the shared shell opts into the modal-focus contract', async () => {
  const paths = [
    '../src/components/MobileNav.jsx',
    '../src/components/OrgSwitcherScreen.jsx',
    '../src/components/workspace/IssueModal.jsx',
    '../src/components/ui/AttachmentViewer.jsx',
  ];

  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /useModalFocus/);
    assert.match(source, /tabIndex=/);
  }
});

// Reading the conversation is what takes the unread line down.
//
// It used to take it down to 70% opacity and no further: `consumeConversation`
// set `read: true`, and `read: true` only faded it. So somebody who opened a
// request, read the two new messages and looked away was still being told they
// had something new — by a marker that already knew they did not.
//
// The trigger is deliberately not a hover. A pointer entering a box is not a
// person reading what is in it, and half the readers of this screen have no
// pointer at all; the signal is the one the read receipt already trusts — the
// end of the conversation in front of the reader for half a second.
test('the unread line goes when the conversation has been read, not when it is clicked', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');
  const divider = await read('../src/components/ui/Chat/UnreadDivider.jsx');

  // The same signal that writes the read receipt marks the boundary read…
  assert.match(timeline, /setBoundary\(current => \(current\.read \? current : \{ \.\.\.current, read: true \}\)\)/);
  // …and being read is what removes it, once the fade has run.
  assert.match(timeline, /if \(!boundary\.read \|\| boundary\.dismissed\) return undefined;/);
  assert.match(timeline, /window\.setTimeout\(dismissBoundary, 320\)/);

  // Not a control: a marker the reader has to dismiss by hand is a marker that
  // has not understood it was read.
  assert.doesNotMatch(divider, /onDismiss|<button/);
  assert.doesNotMatch(timeline, /<UnreadDivider[^/]*onDismiss/);

  // And answering still takes it down immediately, which is the one case where
  // the reader has said so themselves.
  assert.match(timeline, /dismissBoundary\(\);/);
});
