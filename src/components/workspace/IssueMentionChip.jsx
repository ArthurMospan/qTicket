'use client';

// A `#QT-12` in a message: the same chip a mentioned person wears, with the
// task's own name in it.
//
// It used to be a hovercard — the key alone, and you had to point at it and
// wait to find out which task it was. «зробив у #QT-12» is not a sentence.
// The name is shown outright, and the chip is `MENTION_CHIP`, the one shape
// shared with `@name`: a mentioned task and a mentioned person are the same
// kind of thing to read past, so they look the same.

import { useCallback, useEffect, useState } from 'react';
import { TaskIcon } from '@/lib/design/icons';
import { useAppContext } from '@/lib/context/AppContext';
import { auth } from '@/lib/firebase';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import useFittedLabel from '@/lib/hooks/useFittedLabel';
import { MENTION_CHIP_BADGE, mentionChipClass } from './HoverCard';

// One request for the whole page, and one answer per key for the whole session.
//
// Each capsule used to ask the search endpoint on its own, and each of those
// answers cost a full scan of four collections. Eight tasks named in one
// conversation were therefore eight organization-wide scans *per page view* —
// the read budget of a whole day, spent on drawing eight words. It is now one
// batched request against an equality query, and a reload does not repeat it.
const resolved = new Map();
const CACHE_KEY = 'qt.issueMentions.v1';
const CACHE_TTL_MS = 10 * 60 * 1000;

function sessionCache() {
  try {
    if (typeof sessionStorage === 'undefined') return {};
    const stored = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

function rememberInSession(entries) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const stored = sessionCache();
    const now = Date.now();
    for (const [id, issue] of entries) stored[id] = { at: now, issue };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(stored));
  } catch {
    // A full or disabled session store is not a reason to fail a mention.
  }
}

function recallFromSession(id) {
  const entry = sessionCache()[id];
  if (!entry || Date.now() - Number(entry.at || 0) > CACHE_TTL_MS) return undefined;
  return entry.issue ?? null;
}

// Capsules mount in the same commit, so the keys they want are collected within
// one microtask and asked for together.
const pendingKeysByScope = new Map();
const scheduledScopes = new Set();
// The endpoint answers up to twenty keys at a time; a conversation with more
// distinct tasks in it is asked in as many requests, never as many as keys.
const LOOKUP_BATCH = 20;

function mentionScope(userId, organizationId) {
  return `${userId}:${organizationId}`;
}

async function flush(userId, organizationId) {
  const scope = mentionScope(userId, organizationId);
  const batch = pendingKeysByScope.get(scope) || new Map();
  pendingKeysByScope.delete(scope);
  scheduledScopes.delete(scope);
  const allKeys = [...batch.keys()];
  for (let index = 0; index < allKeys.length; index += LOOKUP_BATCH) {
    const slice = allKeys.slice(index, index + LOOKUP_BATCH);
    void askFor(userId, organizationId, slice, new Map(slice.map(key => [key, batch.get(key)])));
  }
}

async function askFor(userId, organizationId, keys, batch) {
  try {
    // A logout/login can happen while capsules are waiting in the microtask
    // batch. Never answer the new account with the old account's request.
    if (auth.currentUser?.uid !== userId) throw new Error('Account changed');
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Not signed in yet');
    const params = new URLSearchParams({ organizationId, keys: keys.join(',') });
    const response = await fetch(`/api/issues/lookup?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Lookup failed');

    const byKey = new Map((payload.results || []).flatMap(issue => [
      [String(issue.issueKey || '').toLocaleUpperCase('uk-UA'), issue],
      [String(issue.storedIssueKey || '').toLocaleUpperCase('uk-UA'), issue],
    ].filter(([key]) => key)));
    const answered = [];
    for (const [key, waiting] of batch) {
      const issue = byKey.get(key) || null;
      answered.push([`${userId}:${organizationId}:${key}`, issue]);
      waiting.forEach(resolve => resolve(issue));
    }
    // Only *answers* are kept. A key that resolves to nothing is an answer; a
    // key that could not be asked about is not, so the next render tries again.
    rememberInSession(answered);
  } catch (error) {
    console.error('[IssueMentionChip] lookup failed', keys, error);
    for (const [key, waiting] of batch) {
      resolved.delete(`${userId}:${organizationId}:${key}`);
      waiting.forEach(resolve => resolve(null));
    }
  }
}

function resolveIssueMention(userId, organizationId, issueKey) {
  const id = `${userId}:${organizationId}:${issueKey}`;
  const cached = resolved.get(id);
  if (cached) return cached;

  const remembered = recallFromSession(id);
  if (remembered !== undefined) {
    const answer = Promise.resolve(remembered);
    resolved.set(id, answer);
    return answer;
  }

  const request = new Promise(resolve => {
    const scope = mentionScope(userId, organizationId);
    const pendingKeys = pendingKeysByScope.get(scope) || new Map();
    pendingKeysByScope.set(scope, pendingKeys);
    const waiting = pendingKeys.get(issueKey) || [];
    waiting.push(resolve);
    pendingKeys.set(issueKey, waiting);
    if (!scheduledScopes.has(scope)) {
      scheduledScopes.add(scope);
      queueMicrotask(() => flush(userId, organizationId));
    }
  });
  resolved.set(id, request);
  return request;
}

/**
 * One `#`-mention of a task inside a message: its name, and a click that opens
 * it in the quick-view panel without leaving the conversation.
 *
 * @param {string} props.issueKey The key written in the message, already uppercased.
 * @param {string} props.title The name the message itself carries, if it has one.
 *   A message written by the current product stores what its composer resolved,
 *   so the overwhelming majority of capsules never ask the server anything.
 * @param {boolean} props.dark On a dark bubble — a task chat message of your own.
 */
export default function IssueMentionChip({ issueKey, title = '', dark = false }) {
  const { activeOrgId, currentUser } = useAppContext();
  const openIssueQuickView = useWorkspaceStore(state => state.openIssueQuickView);
  const [issue, setIssue] = useState(null);
  // A task's name is written by whoever created it and can be a whole sentence.
  // The capsule shows as much of it as it has room for; `title` keeps all of it.
  const fullTitle = issue?.title || title || issueKey;
  const [chipRef, label] = useFittedLabel(fullTitle);
  // Re-run once the session arrives: the first attempt on a cold page has no
  // token, and the chip has to try again rather than stay a bare key forever.
  const signedInAs = currentUser?.uid || currentUser?.id || '';

  useEffect(() => {
    // A message that carries the name has already answered the only question a
    // capsule asks on screen. Opening the task still needs its id, and that is
    // resolved by the click — once, for a task somebody actually went to — not
    // by every message that ever named it.
    if (title || !activeOrgId || !issueKey || !signedInAs) return undefined;
    let cancelled = false;
    resolveIssueMention(signedInAs, activeOrgId, issueKey).then(found => {
      if (!cancelled && found) setIssue(found);
    });
    return () => { cancelled = true; };
  }, [activeOrgId, issueKey, signedInAs, title]);

  // Clicking is never refused. If the name has not arrived — a slow request, a
  // page opened and clicked in the same second — the click resolves it and then
  // opens, instead of the chip sitting there inert.
  const open = useCallback(async () => {
    if (issue) {
      openIssueQuickView(issue);
      return;
    }
    if (!activeOrgId) return;
    if (!signedInAs) return;
    const found = await resolveIssueMention(signedInAs, activeOrgId, issueKey);
    if (found) {
      setIssue(found);
      openIssueQuickView(found);
    }
  }, [activeOrgId, issue, issueKey, openIssueQuickView, signedInAs]);

  return (
    <button
      ref={chipRef}
      type="button"
      onClick={open}
      title={issue ? `${issueKey}: ${issue.title}` : `Завдання ${issueKey}`}
      className={mentionChipClass({ dark })}
      data-mention="issue"
    >
      {/* Exactly where the face sits on a person's mention, at the same size
          and out of the line's way, so the two chips are one shape. */}
      <span className={`${MENTION_CHIP_BADGE} ${dark ? 'text-white/70' : 'text-muted'}`}>
        <TaskIcon size={12} />
      </span>
      {label}
    </button>
  );
}
