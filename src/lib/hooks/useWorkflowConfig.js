'use client';

// src/lib/hooks/useWorkflowConfig.js
// Reads role-filtered workflow config (statuses, types, priorities) through the
// authenticated API; salary rates never enter the member-readable document.
// Falls back to sensible defaults so the app works out of the box before
// an admin customises anything in Settings.
import { useMemo, useSyncExternalStore } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import { reportLoadError } from '@/lib/utils/errors';
import { fetchWorkflowViaApi } from '@/lib/services/workflow';
import {
  Circle, CircleCheck, CircleDashed, CircleDotDashed, CircleDot,
} from 'lucide-react';
import { TASK_TYPE_ICONS } from '@/lib/design/taskTypeIcons';
import {
  localizeBuiltInWorkflowItems,
  resolveClosedStatusIds,
  resolveDeliveredStatusIds,
} from '@/lib/utils/workflowDefaults.mjs';
import {
  statusCategoryColumns,
  statusCategoryMap,
} from '@/lib/utils/statusCategories.mjs';
import {
  DEFAULT_SYSTEM_PRIORITIES,
  ensureSystemPriorities,
} from '@/lib/utils/priorities.mjs';
import {
  DEFAULT_TASK_TYPES,
  ensureSystemTaskType,
} from '@/lib/utils/taskTypes.mjs';
import { DEFAULT_WORKFLOW_POSITIONS } from '@/lib/utils/workflowPositions.mjs';
import { reliableCompletedAtMillis } from '@/lib/utils/completionDates.mjs';

export const TYPE_ICONS = TASK_TYPE_ICONS;
// One glyph per status category, for the places where a category stands on its
// own: the workflow editor and the columns of a cross-project board. A ring that
// fills in as work moves right — dashed while it is only collected, empty once
// planned, half while it runs, solid once it is handed over, closed at the end.
export const STATUS_CATEGORY_ICONS = {
  backlog: CircleDashed,
  todo: Circle,
  'in-progress': CircleDotDashed,
  review: CircleDot,
  done: CircleCheck,
};
// Canonical default workflow for an org that has never saved
// settings/workflow. Must stay in sync with the id lists in
// src/app/api/issues/route.js (server can't import this client module) and
// must keep a `backlog` category (new issues land there) and a `done` one
// (something has to close a task). Settings imports these too — the board,
// the settings page and the API must always describe the same workflow.
//
// `category` is the shared layer of a status: the label is this organization's
// business, the category is what «Мої завдання», analytics and billing read.
// See src/lib/utils/statusCategories.mjs.
export const DEFAULT_STATUSES = [{
  id: 'backlog',
  label: 'Беклог',
  color: '#9a9a9a',
  category: 'backlog',
}, {
  id: 'todo',
  label: 'До виконання',
  color: '#6366f1',
  category: 'todo',
}, {
  id: 'in-progress',
  label: 'У роботі',
  color: '#f59e0b',
  category: 'in-progress',
}, {
  id: 'review',
  label: 'На перевірці',
  color: '#8b5cf6',
  category: 'review',
}, {
  id: 'done',
  label: 'Готово',
  color: '#10b981',
  category: 'done',
  isDone: true,
}];
// ── The two ends of a task ─────────────────────────────────────────────────────
// "Finished" is two questions, and the app used to answer both with one list.
//
//   closed    — nothing left to do here: category `done`. Overdue, blockers, a
//               parent waiting on its children, reminders and `completedAt`
//               read this. «На перевірці» is not closed — a task waiting on a
//               reviewer can still run past its deadline, and hiding that is
//               how a queue of unreviewed work becomes invisible.
//   delivered — something was produced: category `done` alone. Completion
//               percentage, velocity, "closed in this period" and the invoice
//               preset read this.
//
// Neither is ever compared against a hardcoded id, and the rules live in the
// shared, server-importable module — these used to be a second copy of them,
// free to drift from the one the API enforces.
export function getClosedStatusIds(statuses) {
  const list = Array.isArray(statuses) && statuses.length ? statuses : DEFAULT_STATUSES;
  return resolveClosedStatusIds(list);
}

export function getDeliveredStatusIds(statuses) {
  const list = Array.isArray(statuses) && statuses.length ? statuses : DEFAULT_STATUSES;
  return resolveDeliveredStatusIds(list);
}

// True when `statusId` closes a task in the given config.
export function isClosedStatus(statusId, statuses) {
  return getClosedStatusIds(statuses).includes(statusId);
}

// A period can only claim that work closed when the stored completion date is
// trustworthy. In particular, an edit is not a completion and the migration
// timestamp of a legacy YouTrack task is not its source completion date.
export function getCompletedAtMillis(issue) {
  return reliableCompletedAtMillis(issue);
}

// QUI-130. «Задача» leads because it is the default: most issues are tasks, and
// the list should open on the one you reach for. («Завдання» is the entity —
// what the whole product calls an issue; «Задача» is one of its three types.)
export const DEFAULT_TYPES = DEFAULT_TASK_TYPES.map(type => ({ ...type }));
export const DEFAULT_PRIORITIES = DEFAULT_SYSTEM_PRIORITIES;
// Labels are organization taxonomy, not universal workflow. Existing saved
// labels stay untouched; a new organization starts clean.
export const DEFAULT_LABELS = [];
export const DEFAULT_POSITIONS = DEFAULT_WORKFLOW_POSITIONS;

const WORKFLOW_SERVER_SNAPSHOT = Object.freeze({
  statuses: DEFAULT_STATUSES,
  types: DEFAULT_TYPES,
  priorities: DEFAULT_PRIORITIES,
  labels: DEFAULT_LABELS,
  positions: DEFAULT_POSITIONS,
  loading: true,
  error: null,
});

const EMPTY_WORKFLOW_SNAPSHOT = Object.freeze({
  ...WORKFLOW_SERVER_SNAPSHOT,
  loading: false,
});

const workflowStores = new Map();

function createWorkflowStore(organizationId) {
  let snapshot = WORKFLOW_SERVER_SNAPSHOT;
  let unsubscribe = null;
  let stopTimer = null;
  let focusListener = null;
  let requestVersion = 0;
  let workflowVersion;
  const listeners = new Set();

  const emit = next => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };

  const refresh = async () => {
    const version = ++requestVersion;
    try {
      const data = await fetchWorkflowViaApi(organizationId) || {};
      if (version !== requestVersion) return;
      emit({
        statuses: Array.isArray(data.statuses)
          ? localizeBuiltInWorkflowItems('statuses', data.statuses)
          : DEFAULT_STATUSES,
        types: ensureSystemTaskType(Array.isArray(data.types)
          ? localizeBuiltInWorkflowItems('types', data.types)
          : DEFAULT_TYPES),
        priorities: ensureSystemPriorities(Array.isArray(data.priorities)
          ? localizeBuiltInWorkflowItems('priorities', data.priorities)
          : DEFAULT_PRIORITIES),
        labels: Array.isArray(data.labels)
          ? localizeBuiltInWorkflowItems('labels', data.labels)
          : DEFAULT_LABELS,
        positions: Array.isArray(data.positions)
          ? localizeBuiltInWorkflowItems('positions', data.positions)
          : DEFAULT_POSITIONS,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (version !== requestVersion) return;
      reportLoadError('[useWorkflowConfig]', error);
      // A failed refresh says nothing about the configuration that was already
      // loaded. Replacing it with editable defaults can make the next save
      // overwrite a real custom workflow after a brief network/quota failure.
      emit({ ...snapshot, loading: false, error });
    }
  };

  const start = () => {
    if (unsubscribe) return;
    refresh();
    const ref = doc(db, 'organizations', organizationId);
    unsubscribe = onSnapshot(ref, organizationSnap => {
      const nextVersion = organizationSnap.data()?.workflowVersion || 0;
      if (workflowVersion !== undefined && workflowVersion !== nextVersion) refresh();
      workflowVersion = nextVersion;
    }, error => {
      reportLoadError('[useWorkflowConfig] organization version', error);
    });
    focusListener = () => refresh();
    window.addEventListener('focus', focusListener);
  };

  const subscribe = listener => {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopTimer = setTimeout(() => {
          requestVersion += 1;
          unsubscribe?.();
          if (focusListener) window.removeEventListener('focus', focusListener);
          unsubscribe = null;
          focusListener = null;
          workflowVersion = undefined;
          stopTimer = null;
        }, 1000);
      }
    };
  };

  return {
    subscribe,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => WORKFLOW_SERVER_SNAPSHOT,
    refresh,
  };
}

const emptyWorkflowStore = {
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_WORKFLOW_SNAPSHOT,
  getServerSnapshot: () => EMPTY_WORKFLOW_SNAPSHOT,
};

function getWorkflowStore(organizationId, viewerScope) {
  if (!organizationId || !viewerScope) return emptyWorkflowStore;
  const key = `${organizationId}:${viewerScope}`;
  if (!workflowStores.has(key)) {
    workflowStores.set(key, createWorkflowStore(organizationId));
  }
  return workflowStores.get(key);
}

export function useWorkflowConfig() {
  const { activeOrgId, currentUser, orgRole } = useAppContext();
  const viewerId = currentUser?.uid || currentUser?.id || '';
  const viewerScope = viewerId ? `${viewerId}:${orgRole || 'pending'}` : '';
  const store = useMemo(
    () => getWorkflowStore(activeOrgId, viewerScope),
    [activeOrgId, viewerScope],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  // Both ends of a task, derived from the live config. Ask for the one you mean:
  // `closedStatusIds` for "is there work left", `deliveredStatusIds` for "was
  // anything produced".
  const closedStatusIds = useMemo(() => getClosedStatusIds(snapshot.statuses), [snapshot.statuses]);
  const deliveredStatusIds = useMemo(
    () => getDeliveredStatusIds(snapshot.statuses),
    [snapshot.statuses],
  );
  // The shared layer of the workflow, resolved once per snapshot: which category
  // each status belongs to, and the columns a cross-project view is built from.
  const statusCategoryById = useMemo(
    () => statusCategoryMap(snapshot.statuses),
    [snapshot.statuses],
  );
  const categoryColumns = useMemo(
    () => statusCategoryColumns(snapshot.statuses),
    [snapshot.statuses],
  );
  return {
    ...snapshot,
    closedStatusIds,
    deliveredStatusIds,
    statusCategoryById,
    categoryColumns,
  };
}
