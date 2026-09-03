'use client';

// src/app/workspace/settings/page.js — Redesigned Settings (clean, no emoji, QT-style)
import { Children, createContext, isValidElement, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAppContext }  from '@/lib/context/AppContext';
import useWorkspaceStore  from '@/store/useWorkspaceStore';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useMobilePaneBack } from '@/lib/hooks/useMobilePaneBack';
import { restoreProject } from '@/lib/services/projects';
import { fetchWorkflowViaApi, updateWorkflowViaApi } from '@/lib/services/workflow';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';
import { deleteAccount, fetchAccountDeletionImpact } from '@/lib/services/account';
import { plural } from '@/lib/utils/plural.mjs';
import { can, isClientRole } from '@/lib/utils/can';
import { archivedIssuesOf } from '@/lib/utils/issueArchive.mjs';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { useWorkspaceAnalytics } from '@/lib/hooks/useWorkspaceAnalytics';
import { useLocalization } from '@/lib/hooks/useLocalization';
import {
  fetchDeletedIssues,
  restoreDeletedIssue,
  setIssueArchived,
  setIssueCancelled,
} from '@/lib/services/issues';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import { useAccountSessions } from '@/lib/hooks/useAccountSessions';
import { describeSignInMethods } from '@/lib/utils/accountSessions.mjs';
import { auth, createGitHubProvider, db, googleProvider } from '@/lib/firebase';
import { linkWithPopup, unlink } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  User, Bell, GitBranch,
  Shapes, Check, Plus, Trash2, Edit2, X, Save,
  Building, LogOut, RefreshCw, Mail,
  ExternalLink, AlertTriangle,
  Globe, Tag as TagIcon, GripVertical,
  Archive, ArchiveRestore, Lock,
  UserRoundX, ShieldCheck, MonitorSmartphone, Smartphone, Tablet, Monitor, Undo2,
  Send
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Button, Card, ColorSwatch, IconAction, InnerNavigation, Input, Label, LoadingSpinner, MobilePaneBack, PageHeader, Pill, PriorityBadge, Select, SidebarLayout, Tabs, Textarea, ToggleSwitch, UserAvatar, useConfirm } from '@/components/ui';
import ImageUpload from '@/components/ui/ImageUpload';
import {
  CHANNEL_DEFAULTS,
  EVENT_DEFAULTS,
  QTICKET_NOTIFICATION_EVENT_KEYS,
  resolveNotificationMatrix,
} from '@/lib/utils/notificationChannels.mjs';
import {
  organizationPortalBackground,
  resolveOrganizationPortalBrand,
} from '@/lib/utils/organizationBranding.mjs';
import {
  DEFAULT_STATUSES,
  DEFAULT_TYPES,
  DEFAULT_PRIORITIES,
  DEFAULT_LABELS,
  DEFAULT_POSITIONS,
  STATUS_CATEGORY_ICONS,
} from '@/lib/hooks/useWorkflowConfig';
import { hydrateWorkflowSettings } from '@/lib/utils/workflowSettingsHydration.mjs';
import { navigateToSameOrigin } from '@/lib/utils/browserNavigation.mjs';
import {
  createUkrainianDndAnnouncements,
  UKRAINIAN_DRAG_HANDLE_USAGE_INSTRUCTIONS,
} from '@/lib/utils/dndAnnouncements.mjs';
import {
  flattenStatusGroups,
  groupStatusesByCategory,
  isClosingCategory,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_IDS,
} from '@/lib/utils/statusCategories.mjs';
import {
  planOrphanStatusMigrations,
  planStatusMigrations,
  statusMigrationTarget,
} from '@/lib/utils/statusMigrationPlan.mjs';
import {
  taskTypeIcon,
  taskTypeIconKey,
} from '@/lib/design/taskTypeIcons';
import {
  isSystemPriorityId,
  priorityPresentation,
} from '@/lib/utils/priorities.mjs';
import { isSystemTaskTypeId } from '@/lib/utils/taskTypes.mjs';
import { CLIENT_LOGIN_PROVIDERS } from '@/lib/utils/loginProviders.mjs';

// ── Constants ────────────────────────────────────────────────────────
const NOOP = () => {};
// Workflow defaults live in useWorkflowConfig (single source of truth for
// the board, this page and every other consumer) — never redeclare them here:
// a local copy is exactly the bug where Settings showed one set of statuses
// and the kanban another.
const COLOR_PALETTE = [
  '#dc2626','#f97316','#eab308','#22c55e','#10b981',
  '#0891b2','#6366f1','#8b5cf6','#db2777','#1f1f1f',
  '#9a9a9a','#059669','#7c3aed','#d97706','#0284c7',
];
const DEFAULT_WORKFLOW_SETTINGS = Object.freeze({
  statuses: DEFAULT_STATUSES,
  types: DEFAULT_TYPES,
  priorities: DEFAULT_PRIORITIES,
  labels: DEFAULT_LABELS,
  positions: DEFAULT_POSITIONS,
});

const CLIENT_SETTINGS_SECTIONS = new Set([
  'profile',
  'notifications',
  'localization',
  'account',
]);

// A staff seat is a copy of a QuickTeam account: QuickTeam owns the person's
// name, avatar, language and role, and re-sends all of it on the next sync. A
// personal profile editor and a locale editor inside qTicket are therefore a
// second place to change one setting, and the qTicket copy is the one that
// loses. Сповіщення goes with them by the owner's decision — see
// docs/ROADMAP.md for what internal staff can no longer reach because of it.
// These stay whole for `client_admin`/`client_member`, whose account belongs to
// qTicket and to nobody else.
// «Команда підтримки» went the same way, for the same reason twice over: the
// staff roster is QuickTeam's, and qTicket already draws it on «Команда», which
// answers what a support screen is for — which clients a person is on and what
// they have open. Two doors into one read-only list is one door too many.
//
// «Співробітники клієнта» — the `client_admin` half of that same section —
// followed it on 2026-08-31, and for the same reason a third time: the rail
// entry a client saw already said «Співробітники», and the section it opened
// said it again under a group of its own. The roster is «Команда» for both
// audiences now; there is no `team` section left for any role to reach.
// «Сповіщення» is deliberately NOT here, and it is the one of the three that
// never belonged. `users/{uid}/settings/notifications` is qTicket's own
// document: it decides whether the bell records `assigned`, `commented`,
// `mentioned`, `statusChanged`, `incident_created` and `deadline`, plus the
// sound and the pop-up, and QuickTeam holds no copy of any of it. Removing the
// panel therefore did not stop a second editor from losing to a sync — there was
// no second editor. It pinned every internal seat to whatever their document
// already held, with no way for anybody to change it, on a product whose whole
// job is telling support that something arrived.
//
// Nothing is client-only any more, and the two entries that were tell two
// different stories.
//
// **«Особистий профіль»** really is QuickTeam's: name, email and avatar arrive
// in the signed provisioning snapshot and are re-written on every sync, so a
// qTicket editor for them is a copy that loses. Removing the section was the
// right conclusion from that and the wrong control — an internal seat then had
// nowhere to *see* their own name, and the product answered «this screen does
// not exist for you» to a question that has a perfectly good answer. It is back,
// read-only, saying where the values come from. A locked field is an answer; a
// missing screen is not.
//
// **«Локалізація»** was removed alongside it on the same reasoning, and the
// reasoning was simply not true of it. The provisioning contract carries `name`,
// `email` and `avatar` and nothing else — there is no QuickTeam copy of a time
// zone or a date format to lose to. Every internal seat has therefore been
// pinned to whatever their document happened to hold, with nobody anywhere able
// to change it. That is the same defect «Сповіщення» was brought back for on
// 2026-08-31, one section further down the same rail. It returns editable.
const CLIENT_ONLY_SETTINGS_SECTIONS = new Set([]);

const NAV = [
  { id: 'profile',       label: 'Особистий профіль',icon: User,          group: 'Особисте' },
  // «Способи входу» is not a section of its own any more. It answers half of
  // «хто може зайти в мій акаунт», and the other half — who already did, and
  // from where — was on «Безпека», with a row on one linking to the other.
  // `?section=auth-methods` still resolves, so every OAuth callback keeps
  // landing where it always did.
  { id: 'notifications', label: 'Сповіщення',       icon: Bell,          group: 'Особисте' },
  { id: 'localization',  label: 'Локалізація',      icon: Globe,         group: 'Особисте' },
  // Signing out, leaving an organization and deleting your account are things a
  // person does about themselves. They used to live inside «Видалення даних»,
  // which is `adminOnly` — so a plain member had no way to reach any of them.
  { id: 'account',       label: 'Безпека',          icon: ShieldCheck,   group: 'Особисте' },
  // «Організація і бренд» is gone, and it is the same argument that took
  // «Доступ qTicket» into it one slice earlier, applied one step further. That
  // section was five read-only rows — назва, лого, колір, стан доповнення,
  // джерело — about an organization QuickTeam owns and qTicket may not touch. A
  // rail entry is a promise that there is something to do behind it, and behind
  // this one there was nothing but a description of somewhere else. The fact it
  // carried lives on as one row in «Безпека», next to the other things this
  // account cannot change here; `?section=workspace` and `?section=billing`
  // both land there. Whoever needs to edit the brand needs QuickTeam, and the
  // row says so.
  { id: 'statuses',      label: 'Статуси звернень', icon: GitBranch,     group: 'Процес підтримки', adminOnly: true },
  { id: 'types',         label: 'Типи звернень',    icon: Shapes,        group: 'Процес підтримки', adminOnly: true },
  { id: 'priorities',    label: 'Пріоритети',       icon: AlertTriangle, group: 'Процес підтримки', adminOnly: true },
  { id: 'labels',        label: 'Мітки',            icon: TagIcon,       group: 'Процес підтримки', adminOnly: true },
  { id: 'archives',      label: 'Архів і видалене', icon: Archive,       group: 'Інше' },
];

// Whether this deployment can actually put a letter in the post.
//
// The real answer lives in `emailConfigured()`, which reads `RESEND_API_KEY` /
// `BREVO_API_KEY` — secrets a browser must never see. So the deployment mirrors
// the answer into a public flag, and its absence means «no», which is the
// truthful default for a beta with transactional email switched off.
//
// The card is drawn either way. Hiding it until a provider exists is how «а
// куди мені шле листи?» became a question with no screen to answer it; a
// disabled switch that says why is an answer.
const emailDeliveryConfigured = process.env.NEXT_PUBLIC_EMAIL_DELIVERY_ENABLED === 'true';

// ── Primitives ───────────────────────────────────────────────────────
// Toggle removed - using ToggleSwitch from UI Kit

function ArchiveEmpty({ title, hint }) {
  return (
    <div className="py-12 flex flex-col items-center justify-center text-center">
      <div className="w-12 h-12 rounded-full bg-canvas flex items-center justify-center mb-3">
        <Archive size={20} className="text-muted" />
      </div>
      <p className="text-[14px] font-bold text-ink">{title}</p>
      <p className="text-[12px] text-muted mt-1 max-w-[420px]">{hint}</p>
    </div>
  );
}

/**
 * The task lists of «Архів». Archived and cancelled tasks are the same row —
 * a key, a title, the project and when it was put aside — so they are one
 * component rather than two copies free to drift apart.
 */
function ArchiveIssueRows({ issues, projectNameById, since, onOpen, restore }) {
  return (
    <div className="flex flex-col divide-y divide-canvas -my-3">
      {issues.map(issue => (
        <div key={issue.id} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Pill size="md" className="shrink-0">{issue.issueKey || '—'}</Pill>
              <p className="truncate text-[13px] font-semibold text-ink">{issue.title || 'Без назви'}</p>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-muted">
              {projectNameById(issue.projectId)}
              {since(issue)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button style="ghost" size="sm" icon={ExternalLink} onClick={() => onOpen(issue)}>
              Відкрити
            </Button>
            <Button
              style="secondary"
              size="sm"
              icon={restore.icon}
              onClick={() => restore.onClick(issue)}
            >
              {restore.label}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// «за 4 години» is the only thing worth saying about a deleted task: how long
// is left before it goes for good.
function remainingTrashTime(purgeAfterMs) {
  const left = Number(purgeAfterMs) - Date.now();
  if (!Number.isFinite(left) || left <= 0) return 'зникає зараз';
  const hours = Math.floor(left / 3_600_000);
  if (hours >= 1) return `зникає за ${hours} ${plural(hours, ['годину', 'години', 'годин'])}`;
  const minutes = Math.max(1, Math.round(left / 60_000));
  return `зникає за ${minutes} ${plural(minutes, ['хвилину', 'хвилини', 'хвилин'])}`;
}

// A settings row stacks its control under the label on a phone, because a
// select or an input needs the whole width to be usable. A switch does not: it
// is 44px wide at its largest, it fits beside any label on any screen, and
// giving it a line of its own is what made every toggle in Settings jump to the
// left margin under its own caption. So the row asks what it is holding — the
// same static-marker trick PageHeader uses to find a FilterBar — and keeps a
// switch on the right where it reads as an on/off for the line beside it.
// Whether a row is governed by a switch. A switch is the smallest control in
// the product, so its row stays one line on a phone while a row holding a
// select or a text field stacks.
//
// Through a plain wrapper, not direct children only. «Брендинг у сайдбарі»
// keeps its logo preview beside the toggle, so the pair lives in a `div` — and
// a `div` is not a switch, which read as "this row holds something big" and
// dropped the toggle onto a line of its own on every phone.
const isSwitchNode = node => {
  if (!isValidElement(node)) return false;
  if (node.type?.isSwitch) return true;
  if (node.type !== 'div' && node.type !== 'span') return false;
  return Children.toArray(node.props?.children).some(isSwitchNode);
};

// The label above a group of settings inside a card.
//
// «Загальні» has spelled this by hand from the beginning — `text-[11px]
// font-bold text-muted uppercase tracking-wider` — which is exactly what the
// `ui-type-eyebrow` composition already renders, so the utilities go and the
// name stays. «Безпека» used `Row` for the same job, and `Row` is built for a
// setting: a label on the left with its control on the right. Handed a section
// name it reads as a setting nobody can change.
//
// The optional action sits on the label's own line rather than in a row of its
// own, which is what keeps the block's top edge one line tall instead of three.
function GroupLabel({ label, action = null }) {
  return (
    <div className="flex min-h-[24px] items-center justify-between gap-3 pb-2">
      <p className="ui-type-eyebrow">{label}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// The header of a channel card in «Сповіщення»: an icon, a name, the address it
// delivers to, and the switch that governs every row beneath it. A different
// thing from the label above, and named for the one it is.
function CardHeading({ icon: Icon, title, caption, action = null }) {
  return (
    <div className="flex items-start justify-between gap-4 pb-1">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-canvas">
          <Icon size={16} className="text-ink" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-ink leading-none">{title}</p>
          {caption && <p className="mt-[5px] text-[12px] text-muted truncate">{caption}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 pt-[2px]">{action}</div>}
    </div>
  );
}

function Row({ label, desc, children, danger = false }) {
  const items = Children.toArray(children);
  const switchOnly = items.length > 0 && items.every(isSwitchNode);
  return (
    <div className={`flex justify-between gap-3 py-[12px] sm:flex-row sm:items-center sm:gap-6 ${
      switchOnly ? 'flex-row items-center' : 'flex-col items-stretch'
    }`}>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-medium leading-snug ${danger ? 'text-danger' : 'text-ink'}`}>{label}</p>
        {desc && <p className={`text-[12px] mt-[2px] leading-relaxed ${danger ? 'text-danger' : 'text-muted'}`}>{desc}</p>}
      </div>
      <div className={switchOnly ? 'shrink-0' : 'w-full sm:w-auto sm:shrink-0'}>{children}</div>
    </div>
  );
}

// The one way back, published to every Section on the screen rather than
// threaded through fifteen call sites — see `mobileBack` below. Every settings
// section is one level deep now, so the arrow always means "out of the pane",
// which only a phone has.
const SectionBackContext = createContext(null);

function Section({ title, desc, rightAction, children }) {
  const mobileBack = useContext(SectionBackContext);
  // QuickTeam стакає цю шапку нижче md — заголовок з описом ідуть окремим
  // рядком на всю ширину, — бо там опис ділить рядок із кнопкою праворуч і йому
  // лишається колонка завширшки з півтора слова.
  //
  // Тут та поправка не застосовна, і портована умова (`desc && rightAction`)
  // не могла спрацювати жодного разу: `rightAction` не передає жоден із
  // викликів <Section> у цьому форку, а `icon`, на який QuickTeam має запасний
  // варіант, тут узагалі немає такого пропа. Єдине, що справді ділить рядок, —
  // MobilePaneBack: 26px стрілки з полями, мінус її власні -4px, плюс проміжок
  // 10px. Це 32px із 361px, які телефон завширшки 393px дає цій колонці, і
  // забирає вона їх однаково в заголовка й опису — обидва лежать у тому самому
  // `min-w-0 flex-1` нижче. Заголовок із відступом на стрілку — не той дефект,
  // який лагодив QuickTeam: щоб повернути ті 9% ширини, довелося б додати
  // рядок і лишити стрілку саму на лінії.
  return (
    <div className="flex flex-col">
      {/* One control, one place, at every width. */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-[10px]">
          {mobileBack && (
            <MobilePaneBack
              onClick={mobileBack}
              label="Назад"
              context="pane"
              className="mt-[2px]"
            />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="ui-type-detail-title text-ink tracking-tight">{title}</h2>
            {desc && <p className="text-[13px] text-muted mt-[4px] leading-relaxed">{desc}</p>}
          </div>
        </div>
        {rightAction && <div className="shrink-0 flex items-center gap-2">{rightAction}</div>}
      </div>
      <div className="flex flex-col gap-[24px]">
        {children}
      </div>
    </div>
  );
}

// Inline-editable field: save/cancel icons live INSIDE the field on the right,
// shown only while the value differs from what's saved (no reserved gap, no
// layout shift). Enter saves, Escape cancels.
function InlineEditField({ value, onChange, saved, onSave, placeholder = '', type = 'text', className = 'w-[240px]' }) {
  const dirty = (value ?? '') !== (saved ?? '');
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  };
  return (
    <div className={`relative max-sm:w-full ${className}`}>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape' && dirty) onChange(saved ?? '');
        }}
        composition={dirty ? 'inline-edit' : undefined}
      />
      {dirty && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
          <IconAction onClick={commit} disabled={saving} label="Зберегти" icon={Check} size="xs" appearance="primary" />
          <IconAction onClick={() => onChange(saved ?? '')} label="Скасувати" icon={X} size="xs" appearance="soft" />
        </div>
      )}
    </div>
  );
}

function GitHubLogo({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function GoogleLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function OneBMark() {
  return <Image src="/oneb-logo.png" alt="OneB" width={18} height={18} className="object-contain rounded-[4px]" />;
}

// One switch per method, like every other settings row. Connect/disconnect was
// a pair of buttons next to a status pill that repeated what the switch
// position and the detail line already say.
function LoginMethodItem({
  icon,
  title,
  detail,
  connected,
  primary,
  loading,
  disabled,
  soon = false,
  staticMethod = false,
  onConnect,
  onDisconnect,
}) {
  // The primary method cannot be switched off — losing it would leave the
  // account with no way back in. Same rule the disconnect button carried.
  const locked = staticMethod || soon || primary || Boolean(loading) || Boolean(disabled);

  // One line at every width. The switch is the smallest control in the product;
  // stacking it under the method it belongs to only made the row twice as tall
  // and left the toggle floating on the left margin.
  return (
    <div className="flex flex-row items-center justify-between gap-3 py-[14px] sm:gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div data-ui-surface="local" className="w-[36px] h-[36px] rounded-[10px] bg-canvas flex items-center justify-center shrink-0 text-ink">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-ink leading-snug">{title}</p>
          <p className="text-[12px] text-muted mt-[2px] leading-snug truncate">{detail}</p>
        </div>
      </div>
      <ToggleSwitch
        checked={connected || primary}
        disabled={locked}
        onChange={next => (next ? onConnect?.() : onDisconnect?.())}
        ariaLabel={`${connected ? 'Відключити' : 'Підключити'} ${title}`}
      />
    </div>
  );
}

// Note: Card component replaced with UI Kit Card from @/components/ui/Layout/Card

// ── WorkflowItem ─────────────────────────────────────────────────────

function WorkflowItem({ item, onSave, onDelete, canDelete = true, locked = false, readOnly = false, variant = 'status', provided, priorityItems = [], typeSuggestions = [], onChooseTypeSuggestion = NOOP }) {
  const [editing,     setEditing]     = useState(item.isNew || false);
  const [label,       setLabel]       = useState(item.label);
  const [color,       setColor]       = useState(item.color);
  const [showPalette, setShowPalette] = useState(false);

  const save = () => {
    if (label.trim()) {
      const { isNew, ...rest } = item;
      onSave({
        ...rest,
        label: label.trim(),
        color,
        ...(variant === 'type' ? { icon: taskTypeIconKey(item) } : {}),
      });
      setEditing(false);
      setShowPalette(false);
    } else {
      if (item.isNew) onDelete(item.id);
      else {
        setEditing(false);
        setLabel(item.label);
        setColor(item.color);
      }
    }
  };

  const priorityConfig = variant === 'priority'
    ? priorityPresentation(item, priorityItems)
    : null;
  const normalizedTypeQuery = label.trim().toLocaleLowerCase('uk');
  const visibleTypeSuggestions = variant === 'type' && item.isNew
    ? typeSuggestions.filter(type => (
      !normalizedTypeQuery
      || type.label.toLocaleLowerCase('uk').includes(normalizedTypeQuery)
    ))
    : [];

  return (
    <div
      ref={provided?.innerRef}
      {...provided?.draggableProps}
      data-ui-surface="local" className="flex items-center gap-3 max-md:gap-2 py-[8px] px-[8px] -mx-[8px] rounded-[12px] hover:bg-canvas transition-colors group bg-white"
    >
      {provided?.dragHandleProps && (
        <div {...provided.dragHandleProps} className="shrink-0 text-faint hover:text-ink cursor-grab active:cursor-grabbing">
          <GripVertical size={14} />
        </div>
      )}
      {/* Color */}
      <div className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <ColorSwatch
          size="trigger"
          color={color}
          label={readOnly ? `Колір ${label}` : 'Обрати колір'}
          aria-expanded={readOnly ? undefined : showPalette}
          onClick={readOnly ? undefined : () => setShowPalette(v => !v)}
        />
        {!readOnly && showPalette && (
          <div data-ui-surface="local" className="absolute left-0 top-[22px] z-20 bg-white border border-line rounded-[10px] p-[10px] shadow-lg grid grid-cols-5 gap-[6px] w-[148px]">
            {COLOR_PALETTE.map(c => (
              <ColorSwatch
                key={c}
                size="choice"
                color={c}
                selected={c === color}
                label={`Колір ${c}`}
                onClick={() => {
                  setColor(c);
                  setShowPalette(false);
                  if (!editing) {
                    const { isNew, ...rest } = item;
                    onSave({ ...rest, label: label.trim(), color: c });
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Label */}
      {editing ? (
        <div className="relative flex-1">
          <Input
            autoFocus
            size="sm"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={variant === 'type' && item.isNew ? 'Назва типу' : undefined}
            onKeyDown={e => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') {
                if (item.isNew) onDelete(item.id);
                else {
                  setEditing(false);
                  setLabel(item.label);
                  setColor(item.color);
                }
              }
            }}
          />
          {visibleTypeSuggestions.length > 0 && (
            <div
              data-ui-surface="local"
              className="absolute left-0 right-0 top-[36px] z-30 rounded-[10px] border border-line bg-white p-1 shadow-lg"
            >
              <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
                Стандартні типи
              </p>
              {visibleTypeSuggestions.map(type => (
                <Button
                  key={type.id}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => onChooseTypeSuggestion(type)}
                  style="ghost"
                  size="sm"
                  icon={taskTypeIcon(type)}
                  className="w-full justify-start"
                >
                  {type.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : (
        // Назва двічі в одному рядку — і на телефоні за це платить кнопка.
        //
        // Праворуч стоїть пігулка, яка друкує рівно цей самий рядок, і вона не
        // стискається. На 393px довга назва разом із власною копією не влазила
        // в картку, і зайве виштовхувало останній нестисливий блок — олівець із
        // урною — за білий край, на сіре тло. Нижче 768px лишається одна назва,
        // та, що в пігулці: у ній ще й іконка та колір.
        <span className="flex-1 text-[13px] font-semibold text-ink max-md:hidden">{item.label}</span>
      )}

      {/* Badge preview — `workflow-preview` is the kit preset that lets a pill
          wrap below md; the wrapping itself is declared in globals.css beside
          the rest of the pill family, not spelled out here. */}
      {!editing && variant === 'type' && (
        <Pill
          label={label}
          icon={taskTypeIcon(item)}
          color={color}
          colorAlpha="14"
          size="lg"
          shape="badge"
          weight="medium"
          preset="workflow-preview"
          className="backdrop-blur-[2px]"
        />
      )}
      {!editing && variant === 'priority' && (
        <PriorityBadge
          priority={{ ...priorityConfig, label, color }}
          priorities={priorityItems}
          preset="workflow-preview"
        />
      )}
      {!editing && variant !== 'type' && variant !== 'priority' && (
        <Pill
          label={label}
          icon={variant === 'label' ? TagIcon : undefined}
          color={color}
          colorAlpha="14"
          size="lg"
          shape="badge"
          weight="medium"
          preset="workflow-preview"
          className="backdrop-blur-[2px]"
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 shrink-0 w-[64px]">
        {editing ? (
          <>
            <Button onClick={save} aria-label="Зберегти" style="ghost" size="icon" icon={Check} />
            <Button
              onClick={() => {
                if (item.isNew) { onDelete(item.id); }
                else { setEditing(false); setLabel(item.label); setColor(item.color); }
              }}
              aria-label="Скасувати"
              style="ghost" size="icon" icon={X}
            />
          </>
        ) : (
          <>
            {readOnly ? (
              <div className="w-[32px]" />
            ) : (
              <Button onClick={() => setEditing(true)}
                aria-label="Редагувати"
                style="ghost" size="icon" icon={Edit2}
              />
            )}
            {locked ? (
              <Button
                disabled
                aria-label={variant === 'type' ? 'Системний тип' : 'Системний пріоритет'}
                title={variant === 'type' ? 'Системний тип не можна видалити' : 'Системний пріоритет не можна видалити'}
                style="ghost" size="icon" icon={Lock}
              />
            ) : canDelete ? (
              <Button onClick={() => onDelete(item.id)}
                aria-label="Видалити"
                style="ghost" color="red" size="icon" icon={Trash2}
              />
            ) : (
              <div className="w-[28px]" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Draft rows exist only in the editor. Persisting one before the person enters
// a label makes the server correctly reject the entire workflow as malformed.
const cleanWorkflowItems = arr => (arr || [])
  .filter(item => !item?.isNew)
  .map(({ isNew, ...rest }) => rest);

// ── MAIN PAGE ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const settingsQuery = searchParams.toString();
  const { currentUser, signOut, activeOrgId, projects, orgRole } = useAppContext();
  const showToast = useWorkspaceStore(s => s.showToast);
  const confirmDialog = useConfirm();
  const {
    org,
    members,
    deactivateMember,
  } = useOrganization();

  // Role resolution
  const myMemberInfo = members.find(m => m.id === (currentUser?.uid || currentUser?.id));
  // What the product actually knows, before the guess below fills the gap.
  const resolvedRole = orgRole || myMemberInfo?.role || null;
  const myRole = resolvedRole || 'member';
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';
  const clientViewer = isClientRole(myRole);

  // Which sections this role may open — one answer for all three doors into a
  // section: the rail, the `?section=` address and the body that renders. A
  // section removed from the list but still reachable by URL is not removed.
  const reachableSections = useMemo(() => new Set(
    NAV
      .filter(item => (clientViewer
        ? CLIENT_SETTINGS_SECTIONS.has(item.id)
        : !CLIENT_ONLY_SETTINGS_SECTIONS.has(item.id) && (!item.adminOnly || isAdmin)))
      .map(item => item.id),
  ), [clientViewer, isAdmin]);
  // The first entry of this role's own rail, so «Налаштування» always opens on
  // something this person can actually see — with one exception. Removing the
  // personal group left «Безпека» first for staff, and a support manager who
  // opens «Налаштування» is not asking which browsers they signed in from. For
  // them the screen opens on the first section that is about the product; a
  // client keeps their own order, where personal settings genuinely lead.
  const defaultSection = [...reachableSections]
    .find(sectionId => clientViewer || sectionId !== 'account')
    || reachableSections.values().next().value
    || 'account';

  // `chosenSection` is what somebody last asked for; `activeSection` is what the
  // screen is on. They differ for one reason: the role is read from Firestore
  // after the first paint, so the opening guess can name a section this person
  // may not reach — and a removed screen that draws itself even once is not
  // removed.
  const [chosenSection, setChosenSection] = useState('profile');
  const activeSection = reachableSections.has(chosenSection) ? chosenSection : defaultSection;
  // Whether this person may delete themselves, and what it would touch. Loaded
  // when «Безпека» opens rather than on every settings visit — it is three
  // collection queries for a screen most people never reach.
  const [accountDeletion, setAccountDeletion] = useState({
    loading: false,
    busy: false,
    ownedOrganizations: [],
    organizationCount: 0,
    projectCount: 0,
    assignedIssueCount: 0,
  });
  const [leavingOrganization, setLeavingOrganization] = useState(false);

  // Mobile single-pane mode: 'sidebar' (список розділів) або 'content' (розділ)
  const [mobilePane, setMobilePane] = useState('sidebar');

  // ── «Архів» ──────────────────────────────────────────────────
  // Four lists, one section: everything that is out of the way, grouped by what
  // put it there. The task streams only start once the section is open: an
  // archive nobody is looking at must not cost a subscription — the whole
  // workspace shares one read budget.
  const [archiveTab, setArchiveTab] = useState('projects');
  const archiveSectionOpen = activeSection === 'archives';
  // Scoped to the section, not to the tab. The four counts are drawn on the
  // strip itself, so a tab that loads its own list only once you stand on it
  // has no count until you do — which is why the numbers used to appear, and
  // then vanish again when you moved on. The whole section is one subscription
  // for as long as somebody is reading it.
  const archiveProjectIds = useMemo(() => (
    archiveSectionOpen ? (projects || []).map(project => project.id) : []
  ), [archiveSectionOpen, projects]);
  const {
    allIssues: archiveScopedIssues,
    cancelledIssues: cancelledIssueList,
    loading: archivedIssuesLoading,
  } = useWorkspaceAnalytics(archiveProjectIds, { includeLinks: false });
  const archivedIssueList = useMemo(
    () => archivedIssuesOf(archiveScopedIssues),
    [archiveScopedIssues],
  );
  const [deletedIssues, setDeletedIssues] = useState({ items: [], loading: false });
  const { formatDate, timeFormat: savedTimeFormat } = useLocalization();
  const projectNameById = useCallback(id => (
    (projects || []).find(project => project.id === id)?.name || 'Проєкт видалено'
  ), [projects]);

  const loadDeletedIssues = useCallback(async () => {
    if (!activeOrgId) return;
    setDeletedIssues(current => ({ ...current, loading: true }));
    try {
      const items = await fetchDeletedIssues(activeOrgId);
      setDeletedIssues({ items, loading: false });
    } catch (error) {
      setDeletedIssues({ items: [], loading: false });
      showToast(userFacingErrorMessage(error, 'Не вдалося прочитати нещодавно видалене'), 'error');
    }
  }, [activeOrgId, showToast]);

  // A one-time read rather than a subscription: this list changes when somebody
  // deletes a task, and nobody sits on this tab waiting for that to happen. It
  // is read when the section opens rather than when its tab does, for the same
  // reason the streams above are: «Нещодавно видалене» carries a count on the
  // strip, and a count nobody has opened the tab for is not a count.
  useEffect(() => {
    if (!archiveSectionOpen) return;
    void loadDeletedIssues();
  }, [archiveSectionOpen, loadDeletedIssues]);

  const handleUnarchiveIssue = async (issue) => {
    try {
      await setIssueArchived(issue.id, false);
      showToast(`${issue.issueKey || 'Звернення'} повернуто з архіву`);
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося повернути звернення'), 'error');
    }
  };

  const handleUncancelIssue = async (issue) => {
    try {
      await setIssueCancelled(issue.id, false);
      showToast(`${issue.issueKey || 'Звернення'} повернуто в роботу`);
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося повернути звернення'), 'error');
    }
  };

  const handleRestoreDeletedIssue = async (item) => {
    try {
      await restoreDeletedIssue(item.issueId, activeOrgId);
      showToast(`${item.issueKey} відновлено`);
      await loadDeletedIssues();
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося відновити звернення'), 'error');
    }
  };
  // Системний «назад» на телефоні повертає до списку розділів
  const requestPaneClose = useMobilePaneBack(mobilePane === 'content', () => setMobilePane('sidebar'));

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const currentSearchParams = new URLSearchParams(settingsQuery);
      // Sections that were merged into another one. An old link, a bookmark and
      // every OAuth callback still name them.
      const MERGED_SECTIONS = { 'auth-methods': 'account', billing: 'account', workspace: 'account' };
      const rawSection = currentSearchParams.get('section');
      const requestedSection = MERGED_SECTIONS[rawSection] || rawSection;
      // «Команда підтримки» did not go away, it moved: the roster is «Команда»,
      // for the support team and for a client administrator's own employees
      // alike. A bookmark lands on the screen that now holds the answer rather
      // than on whatever happens to be first in this rail.
      // The role is read after the first paint and `myRole` guesses «member»
      // until it arrives, so the raw one is what may be trusted here: guessing
      // wrong sends a `client_member` to a screen their own layout would then
      // bounce. Unknown means wait — the effect runs again with the answer.
      // A `client_member` is the one role with no roster to be sent to, so the
      // address falls through to this rail's own first section.
      const knownTeamReader = Boolean(resolvedRole) && resolvedRole !== 'client_member';
      if (requestedSection === 'team' && knownTeamReader) {
        router.replace('/team');
        return;
      }
      // The address is the second door into a section and it has to be the same
      // door. An old link to a section this role no longer has — «Особистий
      // профіль» and «Локалізація» for staff — lands on the first section of
      // that role's own rail instead of opening a screen the product took away.
      const sec = requestedSection
        ? (reachableSections.has(requestedSection) ? requestedSection : defaultSection)
        : '';
      const authSuccess = currentSearchParams.get('auth');
      const authError = currentSearchParams.get('authError');
      if (sec) {
        queueMicrotask(() => {
          setChosenSection(sec);
          setMobilePane('content'); // deep link opens the section directly on mobile
        });
      }
      if (authSuccess === 'oneb_connected') {
        queueMicrotask(() => showToast('OneB підключено'));
      }
      if (authError) {
        const message = authError === 'oneb_already_linked'
          ? 'Цей OneB акаунт уже підключений до іншого користувача'
          : authError === 'oneb_session'
            ? 'Не вдалося підтвердити сесію. Увійдіть ще раз і повторіть підключення OneB'
            : authError === 'oneb_state'
              ? 'Термін дії посилання минув або воно відкрите не в тому браузері. Спробуйте підключити OneB заново'
              : 'Не вдалося підключити OneB';
        queueMicrotask(() => showToast(message, 'error'));
      }
    }
  }, [defaultSection, reachableSections, resolvedRole, router, settingsQuery, showToast]);

  // ── Workflow ──
  const [statuses,   setStatuses]   = useState(DEFAULT_STATUSES);
  const [types,      setTypes]      = useState(DEFAULT_TYPES);
  const [priorities, setPriorities] = useState(DEFAULT_PRIORITIES);
  const [labels,     setLabels]     = useState(DEFAULT_LABELS);
  const [positions,  setPositions]  = useState(DEFAULT_POSITIONS);
  const [wfLoading,  setWfLoading]  = useState(true);
  const applyWorkflowPayload = useCallback(payload => {
    // React batches these setters into one commit. Keeping this as one
    // complete payload prevents a mixed A/B workflow during org switches.
    setStatuses(payload.statuses);
    setTypes(payload.types);
    setPriorities(payload.priorities);
    setLabels(payload.labels);
    setPositions(payload.positions);
  }, []);


  // ── Profile ──
  //
  // Three of these exist only on a customer's half, and they are the answer to
  // «як з цією людиною звʼязатись, коли порталу мало». A support desk needs a
  // number and a handle far more often than it needs a colleague's biography —
  // the mood line, the «Про себе» paragraph and the city went out with the task
  // manager this product was forked from, and they stay out.
  const [displayName,   setDisplayName]   = useState('');
  const [jobTitle,      setJobTitle]      = useState('');
  const [phone,         setPhone]         = useState('');
  const [telegram,      setTelegram]      = useState('');
  const [customAvatar,  setCustomAvatar]  = useState('');
  const [customAvatarStoragePath, setCustomAvatarStoragePath] = useState('');
  const [customAvatarResourceType, setCustomAvatarResourceType] = useState('image');

  // Whether any profile field is unsaved (for the leave guard).
  const profileDirty =
    displayName !== (currentUser?.name || '') ||
    jobTitle !== (currentUser?.title || '') ||
    phone !== (currentUser?.phone || '') ||
    telegram !== (currentUser?.telegram || '') ||
    customAvatar !== (currentUser?.customAvatar || '');

  // Discard unsaved profile edits (used when the user chooses to leave without
  // saving — otherwise the derived profileDirty stays true and the guard would
  // re-prompt on every navigation).
  const revertProfile = useCallback(() => {
    setDisplayName(currentUser?.name || '');
    setJobTitle(currentUser?.title || '');
    setPhone(currentUser?.phone || '');
    setTelegram(currentUser?.telegram || '');
    setCustomAvatar(currentUser?.customAvatar || '');
    setCustomAvatarStoragePath(currentUser?.customAvatarStoragePath || '');
    setCustomAvatarResourceType(currentUser?.customAvatarResourceType || 'image');
  }, [currentUser]);

  // ── Workspace ──
  // Nothing to hold: «Організація і бренд» reads the QuickTeam snapshot off the
  // organization document and writes nothing back, so there is no draft name,
  // no draft logo, no draft rail colour — and no live preview to push into the
  // sidebar, because nothing on this screen can change what the sidebar shows.

  // ── Notifications ──
  // `channels` is the event × channel matrix; the flat per-event flags beside it
  // are the pre-matrix shape, still written in step with the in-app column so a
  // deploy that is mid-rollout keeps behaving. Defaults and the delivery rules
  // both live in lib/utils/notificationChannels.mjs.
  const [notif, setNotif] = useState({
    ...CHANNEL_DEFAULTS,
    ...EVENT_DEFAULTS,
    channels: resolveNotificationMatrix({}),
  });
  const notifMatrix = useMemo(() => resolveNotificationMatrix(notif), [notif]);

  // Ticking a cell. The in-app column also mirrors into the legacy flat flag.
  const setChannelEvent = (channel, key, enabled) => {
    setNotif(previous => {
      const matrix = resolveNotificationMatrix(previous);
      const next = {
        ...previous,
        channels: { ...matrix, [channel]: { ...matrix[channel], [key]: enabled } },
      };
      if (channel === 'inapp') next[key] = enabled;
      return next;
    });
  };

  // ── Telegram, as a delivery channel and nothing else ────────────────────
  //
  // Ported from QuickTeam, including the part that matters most: the switch
  // *is* the connection. There is no «Підключити» button beside a separate
  // «Увімкнути» toggle, because a channel that is linked but silent, or enabled
  // but unlinked, are two states nobody wants and everybody creates by accident.
  const [telegramBotStatus, setTelegramBotStatus] = useState({ configured: false, connected: false, chatTitle: '' });
  const [telegramBotLoading, setTelegramBotLoading] = useState(false);
  // True between opening the bot deep link and the webhook confirming it.
  const [telegramAwaitingLink, setTelegramAwaitingLink] = useState(false);

  const telegramRequest = useCallback(async (method = 'GET', body = null) => authenticatedRequest(
    '/api/integrations/telegram',
    { method, ...(body ? { body: JSON.stringify(body) } : {}) },
    'Не вдалося виконати запит до Telegram',
  ), []);

  const refreshTelegram = useCallback(async () => {
    if (!currentUser) return;
    setTelegramBotStatus(await telegramRequest());
  }, [currentUser, telegramRequest]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => refreshTelegram().catch(() => {}), 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshTelegram]);

  const connectTelegram = async () => {
    setTelegramBotLoading(true);
    try {
      const result = await telegramRequest('POST', {});
      window.open(result.link, '_blank', 'noopener,noreferrer');
      setTelegramAwaitingLink(true);
      showToast('Натисніть «Старт» у Telegram — далі підключиться саме');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setTelegramBotLoading(false);
    }
  };

  const disconnectTelegram = async () => {
    setTelegramBotLoading(true);
    try {
      await telegramRequest('DELETE');
      setTelegramBotStatus(previous => ({ ...previous, connected: false, chatTitle: '' }));
      setNotif(previous => ({ ...previous, telegramEnabled: false }));
      showToast('Telegram відключено');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setTelegramBotLoading(false);
    }
  };

  const toggleTelegram = async enabled => {
    if (!enabled) {
      if (telegramBotStatus.connected) {
        await disconnectTelegram();
        return;
      }
      setNotif(previous => ({ ...previous, telegramEnabled: false }));
      return;
    }
    if (telegramBotStatus.connected) {
      setNotif(previous => ({ ...previous, telegramEnabled: true }));
      return;
    }
    await connectTelegram();
  };

  // Nobody should have to press «Перевірити» after coming back from Telegram —
  // that is our webhook's plumbing, put in front of the person who used it. The
  // row polls for the answer, and re-asks whenever the tab regains focus, which
  // is exactly the moment somebody returns from the bot.
  useEffect(() => {
    if (!telegramAwaitingLink) return undefined;
    const pollMs = 3000;
    const maxTicks = 60; // three minutes; the connect token itself lasts fifteen
    let ticks = 0;
    const check = async () => {
      try {
        const status = await telegramRequest();
        setTelegramBotStatus(status);
        if (!status.connected) return;
        setTelegramAwaitingLink(false);
        setNotif(previous => ({ ...previous, telegramEnabled: true }));
        showToast('Telegram підключено');
      } catch {
        // Transient: the next tick retries, and the token is valid either way.
      }
    };
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > maxTicks) {
        setTelegramAwaitingLink(false);
        return;
      }
      check();
    }, pollMs);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [telegramAwaitingLink, telegramRequest, showToast]);

  // Last notif/localization value known to match Firestore (JSON) — see the
  // auto-save effects below. null until the first render establishes it.
  const notifBaseline = useRef(null);
  const locBaseline = useRef(null);
  // Last workflow value known to match the server — process settings auto-save
  // (no manual button), so this guards against re-writing freshly hydrated data.
  const wfBaseline = useRef(null);
  const wfPersistedPayload = useRef(null);
  const wfLatestPayload = useRef(null);
  const wfLatestJson = useRef(null);
  const wfQueuedJson = useRef(null);
  const wfSaveQueue = useRef(Promise.resolve());
  const wfOrgId = useRef(activeOrgId);
  const wfLoadGeneration = useRef(0);
  // ── Localization ──
  const [dateFormat, setDateFormat] = useState('DD.MM.YYYY');
  const [firstDayOfWeek, setFirstDayOfWeek] = useState('Monday');
  const [timeFormat, setTimeFormat] = useState('24h');
  const [timezone, setTimezone] = useState('Europe/Kyiv');
  const [language, setLanguage] = useState('ua');

  // ─── Auth methods ───
  const [authProviderIds, setAuthProviderIds] = useState([]);
  const [authMethodLoading, setAuthMethodLoading] = useState(null);
  const hasGithubAuth = authProviderIds.includes('github.com');
  const hasGoogleAuth = authProviderIds.includes('google.com');
  const hasOneBAuth = Boolean(currentUser?.onebId && currentUser?.onebConnected !== false);
  const isPrimaryGitHub = hasGithubAuth && !hasGoogleAuth && !hasOneBAuth;
  const isPrimaryGoogle = hasGoogleAuth && !hasGithubAuth && !hasOneBAuth;
  const isPrimaryOneB = hasOneBAuth && !hasGithubAuth && !hasGoogleAuth;
  const isPrimaryEmail = false;

  const refreshAuthProviders = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      setAuthProviderIds([]);
      return [];
    }
    await firebaseUser.reload().catch(() => {});
    const providerIds = firebaseUser.providerData.map(provider => provider.providerId);
    setAuthProviderIds(providerIds);
    return providerIds;
  };

  // Sync from Firestore (initial only)
  useEffect(() => {
    if (currentUser) {
      queueMicrotask(() => {
        if (currentUser.name && !displayName) setDisplayName(currentUser.name);
        if (currentUser.title && !jobTitle) setJobTitle(currentUser.title);
        if (currentUser.phone && !phone) setPhone(currentUser.phone);
        if (currentUser.telegram && !telegram) setTelegram(currentUser.telegram);
        if (currentUser.customAvatar && !customAvatar) setCustomAvatar(currentUser.customAvatar);
        setCustomAvatarStoragePath(currentUser.customAvatarStoragePath || '');
        setCustomAvatarResourceType(currentUser.customAvatarResourceType || 'image');
        if (currentUser.localization) {
          const loc = {
            dateFormat: currentUser.localization.dateFormat || 'DD.MM.YYYY',
            firstDayOfWeek: currentUser.localization.firstDayOfWeek || 'Monday',
            timeFormat: currentUser.localization.timeFormat || '24h',
            timezone: currentUser.localization.timezone || 'Europe/Kyiv',
            language: currentUser.localization.language || 'ua',
          };
          locBaseline.current = JSON.stringify(loc);
          setDateFormat(loc.dateFormat);
          setFirstDayOfWeek(loc.firstDayOfWeek);
          setTimeFormat(loc.timeFormat);
          setTimezone(loc.timezone);
          setLanguage(loc.language);
        }
      });
    }
  }, [currentUser]); // eslint-disable-line

  useEffect(() => {
    queueMicrotask(() => refreshAuthProviders());
  }, [currentUser?.id, currentUser?.uid]);

  // ── Breadcrumbs ──
  // Removed breadcrumbs to avoid duplicate 'Налаштування' in WorkspaceHeader
  useEffect(() => {
    const organizationId = activeOrgId;
    const generation = wfLoadGeneration.current + 1;
    wfLoadGeneration.current = generation;
    let cancelled = false;
    const isCurrentWorkflowLoad = () => (
      !cancelled
      && wfLoadGeneration.current === generation
      && wfOrgId.current === organizationId
    );
    const applyHydratedWorkflow = storedWorkflow => {
      const payload = hydrateWorkflowSettings(
        storedWorkflow,
        DEFAULT_WORKFLOW_SETTINGS,
      );
      const json = JSON.stringify(payload);
      wfBaseline.current = json;
      wfPersistedPayload.current = payload;
      wfLatestPayload.current = payload;
      wfLatestJson.current = json;
      wfQueuedJson.current = null;
      applyWorkflowPayload(payload);
    };

    wfOrgId.current = organizationId;
    wfBaseline.current = null;
    wfPersistedPayload.current = null;
    wfLatestPayload.current = null;
    wfLatestJson.current = null;
    wfQueuedJson.current = null;

    // Clear every section as one defaults payload before any request can
    // resolve. This removes org A's custom values while org B is loading.
    queueMicrotask(() => {
      if (!isCurrentWorkflowLoad()) return;
      applyHydratedWorkflow(null);
      setWfLoading(Boolean(organizationId));
    });

    if (!organizationId) {
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      try {
        const storedWorkflow = await fetchWorkflowViaApi(organizationId);
        if (!isCurrentWorkflowLoad()) return;
        applyHydratedWorkflow(storedWorkflow);

        const uid = currentUser?.uid || currentUser?.id;
        if (uid) {
          const notifSnap = await getDoc(doc(db, 'users', uid, 'settings', 'notifications'));
          if (!isCurrentWorkflowLoad()) return;
          if (notifSnap.exists()) {
            const stored = notifSnap.data();
            setNotif(p => {
              // The matrix is resolved from the stored document, never from the
              // merged object: a pre-matrix document has no `channels`, and
              // merging would leave the defaults sitting there as if they had
              // been chosen, overriding what the account was actually getting.
              const merged = { ...p, ...stored, channels: resolveNotificationMatrix(stored) };
              notifBaseline.current = JSON.stringify(merged);
              return merged;
            });
          }
        }
      } catch (error) {
        if (isCurrentWorkflowLoad()) {
          showToast(error?.message || 'Не вдалося завантажити налаштування', 'error');
        }
      }
      if (isCurrentWorkflowLoad()) setWfLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, currentUser?.uid, isAdmin, applyWorkflowPayload]); // eslint-disable-line

  // ── Handlers ─────────────────────────────────────────────────────

  // Auto-save saves what the USER changed — but hydration from Firestore also
  // lands in the same state, so a "skip first render" guard was not enough:
  // loading saved prefs re-saved them and toasted «Налаштування оновлено» the
  // moment the page opened. The baseline refs hold the last value known to
  // match Firestore (updated on hydration and after each save); the effects
  // only write when the state actually differs from that baseline.
  useEffect(() => {
    const json = JSON.stringify(notif);
    if (notifBaseline.current === null || notifBaseline.current === json) {
      notifBaseline.current = json;
      return;
    }
    const saveNotifEffect = async () => {
      const uid = currentUser?.uid || currentUser?.id;
      if (!uid) return;
      try {
        await setDoc(doc(db, 'users', uid, 'settings', 'notifications'), { ...notif, updatedAt: serverTimestamp() });
        notifBaseline.current = json;
        showToast('Налаштування оновлено');
      } catch { showToast('Помилка збереження', 'error'); }
    };
    saveNotifEffect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notif, showToast]);

  useEffect(() => {
    const json = JSON.stringify({ dateFormat, firstDayOfWeek, timeFormat, timezone, language });
    if (locBaseline.current === null || locBaseline.current === json) {
      locBaseline.current = json;
      return;
    }
    const saveLocEffect = async () => {
      const uid = currentUser?.uid || currentUser?.id;
      if (!uid) return;
      try {
        await updateDoc(doc(db, 'users', uid), {
          localization: { dateFormat, firstDayOfWeek, timeFormat, timezone, language },
          updatedAt: serverTimestamp()
        });
        locBaseline.current = json;
        showToast('Налаштування оновлено');
      } catch { showToast('Помилка збереження', 'error'); }
    };
    saveLocEffect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFormat, firstDayOfWeek, timeFormat, timezone, language, showToast]);

  // ── Unsaved-changes guard ────────────────────────────────────────
  // Process settings auto-save, so only Profile/Organization can be "dirty".
  // Switching sections is already guarded by handleSectionChange; this covers
  // LEAVING the settings page: a hard navigation (beforeunload) and in-app
  // <Link> clicks (sidebar → Проєкти etc.), intercepted in the capture phase so
  // we run before Next's Link handler and can cancel it.
  useEffect(() => {
    const hasUnsaved = () => profileDirty;

    const onBeforeUnload = (e) => {
      if (!hasUnsaved()) return;
      e.preventDefault();
      e.returnValue = '';
    };

    const onClickCapture = (e) => {
      if (!hasUnsaved()) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target?.closest?.('a[href]');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;      // opens a new tab
      const url = new URL(anchor.href, window.location.origin);
      if (url.origin !== window.location.origin) return;           // external → beforeunload handles it
      if (url.pathname === window.location.pathname) return;        // same page / in-page anchor
      e.preventDefault();
      e.stopPropagation();
      confirmDialog({
        title: 'Незбережені зміни',
        message: 'У вас є незбережені зміни. Ви впевнені, що хочете піти без збереження?',
        confirmText: 'Піти', danger: true,
      }).then(ok => {
        if (!ok) return;
        revertProfile(); // discard so we don't re-prompt on the next click
        router.push(url.pathname + url.search + url.hash);
      });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [profileDirty, confirmDialog, router, revertProfile]);

  // Persist a single profile field inline (each field has its own save/cancel).
  const saveProfileField = async (field, rawValue) => {
    const uid = currentUser?.uid || currentUser?.id;
    if (!uid) return;
    let value = rawValue;
    if (field === 'skills') value = String(rawValue).split(',').map(s => s.trim()).filter(Boolean);
    else if (typeof rawValue === 'string') value = rawValue.trim();
    try {
      await updateDoc(doc(db, 'users', uid), { [field]: value, updatedAt: serverTimestamp() });
      showToast('Збережено');
    } catch { showToast('Помилка збереження', 'error'); }
  };

  const saveProfileImage = async (url, asset) => {
    const uid = currentUser?.uid || currentUser?.id;
    if (!uid) throw new Error('Не вдалося визначити користувача');
    await updateDoc(doc(db, 'users', uid), {
      customAvatar: url,
      customAvatarStoragePath: asset?.storagePath || '',
      customAvatarResourceType: asset?.resourceType || '',
      updatedAt: serverTimestamp(),
    });
    setCustomAvatar(url);
    setCustomAvatarStoragePath(asset?.storagePath || '');
    setCustomAvatarResourceType(asset?.resourceType || 'image');
    showToast(url ? 'Аватар збережено' : 'Аватар видалено');
  };


  const handleSectionChange = async (newSection) => {
    if (newSection === activeSection) return true;
    // Everything auto-saves except individual profile fields (which save inline
    // per-field), so warn only when a profile field is left unsaved.
    if (profileDirty) {
      if (!(await confirmDialog({
        title: 'Незбережені зміни',
        message: 'У вас є незбережені зміни у профілі. Перейти без збереження?',
        confirmText: 'Перейти',
        danger: true,
      }))) {
        return false;
      }
      revertProfile(); // chose to leave → discard so the guard stops prompting
    }
    setChosenSection(newSection);
    return true;
  };

  const handleConnectGitHub = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return showToast('Потрібно увійти повторно', 'error');
    setAuthMethodLoading('github-connect');
    try {
      await linkWithPopup(firebaseUser, createGitHubProvider());
      await refreshAuthProviders();
      showToast('GitHub підключено');
    } catch (error) {
      console.warn('[settings] GitHub connect failed:', error);
      const providerIds = await refreshAuthProviders();
      if (providerIds.includes('github.com')) {
        showToast('GitHub підключено');
        return;
      }
      const message = error.code === 'auth/provider-already-linked'
        ? 'GitHub уже підключено'
        : error.code === 'auth/credential-already-in-use'
          ? 'Цей GitHub уже підключений до іншого акаунта'
          // «Способи входу» is a client's section, and a client cannot open
          // our Firebase console — so no message here names our OAuth
          // application, its keys or where they live.
          : error.code === 'auth/operation-not-allowed'
            ? 'Підключення GitHub зараз недоступне'
            : error.code === 'auth/invalid-credential' || error.message?.includes('Bad credentials')
              ? 'GitHub відхилив підключення. Спробуйте пізніше або напишіть у підтримку'
            : 'Не вдалося підключити GitHub';
      showToast(message, 'error');
    } finally {
      setAuthMethodLoading(null);
    }
  };

  const handleConnectGoogle = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return showToast('Потрібно увійти повторно', 'error');
    setAuthMethodLoading('google-connect');
    try {
      await linkWithPopup(firebaseUser, googleProvider);
      await refreshAuthProviders();
      showToast('Google підключено');
    } catch (error) {
      console.error('[settings] Google connect failed:', error);
      const message = error.code === 'auth/provider-already-linked'
        ? 'Google уже підключено'
        : error.code === 'auth/credential-already-in-use'
          ? 'Цей Google акаунт уже підключений до іншого користувача'
          : error.code === 'auth/operation-not-allowed'
            ? 'Підключення Google зараз недоступне'
            : error.code === 'auth/requires-recent-login'
              ? 'Увійдіть повторно і спробуйте підключити Google ще раз'
              : 'Не вдалося підключити Google';
      showToast(message, 'error');
    } finally {
      setAuthMethodLoading(null);
    }
  };

  const handleDisconnectGitHub = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return showToast('Потрібно увійти повторно', 'error');
    if (!hasGoogleAuth && !hasOneBAuth) {
      return showToast('Спочатку підключіть Google або OneB, щоб не втратити доступ', 'error');
    }
    setAuthMethodLoading('github-disconnect');
    try {
      await unlink(firebaseUser, 'github.com');
      await refreshAuthProviders();
      showToast('GitHub відключено');
    } catch (error) {
      console.error('[settings] GitHub disconnect failed:', error);
      showToast(error.code === 'auth/no-such-provider' ? 'GitHub не підключено' : 'Не вдалося відключити GitHub', 'error');
    } finally {
      setAuthMethodLoading(null);
    }
  };

  const handleDisconnectGoogle = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return showToast('Потрібно увійти повторно', 'error');
    if (!hasGithubAuth && !hasOneBAuth) {
      return showToast('Спочатку підключіть GitHub або OneB, щоб не втратити доступ', 'error');
    }
    setAuthMethodLoading('google-disconnect');
    try {
      await unlink(firebaseUser, 'google.com');
      await refreshAuthProviders();
      showToast('Google відключено');
    } catch (error) {
      console.error('[settings] Google disconnect failed:', error);
      showToast(error.code === 'auth/no-such-provider' ? 'Google не підключено' : 'Не вдалося відключити Google', 'error');
    } finally {
      setAuthMethodLoading(null);
    }
  };

  const handleConnectOneB = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return showToast('Потрібно увійти повторно', 'error');
    const clientId = process.env.NEXT_PUBLIC_ONEB_CLIENT_ID || 'dummy_client_id';
    if (clientId === 'dummy_client_id') {
      return showToast('Підключення OneB зараз недоступне', 'error');
    }
    setAuthMethodLoading('oneb-connect');
    try {
      const idToken = await firebaseUser.getIdToken(true);
      const sessionResponse = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!sessionResponse.ok) throw new Error('Failed to refresh server session');

      // The server builds the authorize URL: it is the only side that can set
      // the httpOnly nonce cookie the callback checks against.
      const params = new URLSearchParams({ mode: 'link', r: '/settings?section=auth-methods' });
      navigateToSameOrigin(`/api/auth/oneb/start?${params.toString()}`);
    } catch (error) {
      console.error('[settings] OneB connect failed:', error);
      showToast('Не вдалося почати підключення OneB', 'error');
      setAuthMethodLoading(null);
    }
  };

  const handleDisconnectOneB = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return showToast('Потрібно увійти повторно', 'error');
    if (!hasGithubAuth && !hasGoogleAuth) {
      return showToast('Спочатку підключіть GitHub або Google, щоб не втратити доступ', 'error');
    }
    setAuthMethodLoading('oneb-disconnect');
    try {
      const idToken = await firebaseUser.getIdToken(true);
      const response = await fetch('/api/auth/oneb/unlink', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || 'Failed to unlink OneB');
      await firebaseUser.getIdToken(true);
      showToast('OneB відключено');
    } catch (error) {
      console.error('[settings] OneB disconnect failed:', error);
      showToast(error.message || 'Не вдалося відключити OneB', 'error');
    } finally {
      setAuthMethodLoading(null);
    }
  };

  // Full workflow documents are serialized through one client queue. This
  // prevents two debounced saves from arriving out of order and restoring an
  // older status model after a newer one.
  const queueWorkflowMutation = useCallback((
    payload,
    {
      statusMigrations = [],
      notify = true,
    } = {},
  ) => {
    const organizationId = activeOrgId;
    if (!organizationId) return Promise.reject(new Error('Не вибрано організацію'));
    const json = JSON.stringify(payload);
    if (
      statusMigrations.length === 0
      && wfQueuedJson.current === json
      && wfBaseline.current !== json
    ) {
      return wfSaveQueue.current;
    }
    wfQueuedJson.current = json;

    const work = wfSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        let pendingPayload = payload;
        let pendingJson = json;
        let pendingMigrations = statusMigrations;
        while (true) {
          try {
            const result = await updateWorkflowViaApi({
              organizationId,
              workflow: pendingPayload,
              statusMigrations: pendingMigrations,
            });
            if (wfOrgId.current !== organizationId) return result;

            wfBaseline.current = pendingJson;
            wfPersistedPayload.current = pendingPayload;
            if (
              wfLatestPayload.current
              && wfLatestJson.current !== pendingJson
              && wfQueuedJson.current === pendingJson
            ) {
              pendingPayload = wfLatestPayload.current;
              pendingJson = wfLatestJson.current;
              pendingMigrations = [];
              wfQueuedJson.current = pendingJson;
              continue;
            }
            if (notify && wfLatestJson.current === pendingJson) {
              showToast('Налаштування оновлено');
            }
            return result;
          } catch (error) {
            if (wfOrgId.current !== organizationId) throw error;
            if (
              wfLatestPayload.current
              && wfLatestJson.current !== pendingJson
              && wfQueuedJson.current === pendingJson
            ) {
              pendingPayload = wfLatestPayload.current;
              pendingJson = wfLatestJson.current;
              pendingMigrations = [];
              wfQueuedJson.current = pendingJson;
              continue;
            }
            if (wfQueuedJson.current === pendingJson) wfQueuedJson.current = null;
            if (
              wfLatestJson.current === pendingJson
              && wfPersistedPayload.current
            ) {
              const restored = wfPersistedPayload.current;
              const restoredJson = JSON.stringify(restored);
              wfLatestPayload.current = restored;
              wfLatestJson.current = restoredJson;
              wfBaseline.current = restoredJson;
              applyWorkflowPayload(restored);
            }
            if (notify) {
              console.error('Workflow autosave error:', error);
              showToast(error.message || 'Помилка збереження', 'error');
            }
            throw error;
          }
        }
      });
    wfSaveQueue.current = work.catch(() => undefined);
    return work;
  }, [activeOrgId, applyWorkflowPayload, showToast]);

  // Process settings auto-save: persist workflow changes in real time through
  // the transactional API. Debouncing collapses a burst of inline edits or a
  // drag-reorder into one mutation.
  useEffect(() => {
    if (wfLoading) return;
    const payload = {
      statuses: cleanWorkflowItems(statuses),
      types: cleanWorkflowItems(types),
      priorities: cleanWorkflowItems(priorities),
      labels: cleanWorkflowItems(labels),
      positions: cleanWorkflowItems(positions),
    };
    const json = JSON.stringify(payload);
    wfLatestPayload.current = payload;
    wfLatestJson.current = json;
    if (wfBaseline.current === null) {
      wfBaseline.current = json;
      wfPersistedPayload.current = payload;
      return;
    }
    if (wfBaseline.current === json) return;
    if (!activeOrgId) return;
    const timer = setTimeout(() => {
      queueWorkflowMutation(payload).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [
    statuses,
    types,
    priorities,
    labels,
    positions,
    wfLoading,
    activeOrgId,
    queueWorkflowMutation,
  ]);

  // Leaving is the same server call as being deactivated — the route tells the
  // two apart by the id — so the person keeps everything they did here and an
  // administrator can hand the seat back if they return.
  // «Налаштування» → «Акаунт» is one of the five sections an external client
  // can open, so this dialog and the deletion one below are read by somebody
  // who has never been shown a «проєкт» or a «задача» and never will be.
  const handleLeaveOrganization = async () => {
    const uid = currentUser?.uid || currentUser?.id;
    if (!uid || leavingOrganization) return;
    const typed = await confirmDialog({
      title: `Вийти з «${org?.name || 'організації'}»?`,
      message: 'Ви втратите доступ до організації та її проєктів. Повідомлення, коментарі й історія залишаться за вами. Щоб повернутися, потрібне буде запрошення або відновлення доступу адміністратором.\n\nВведіть ВИЙТИ, щоб підтвердити.',
      confirmText: 'Вийти з організації',
      cancelText: 'Скасувати',
      danger: true,
      input: { placeholder: 'ВИЙТИ' },
    });
    if (String(typed || '').trim().toLocaleUpperCase('uk-UA') !== 'ВИЙТИ') return;
    setLeavingOrganization(true);
    try {
      await deactivateMember(uid);
      showToast('Ви вийшли з організації');
      router.replace('/');
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося вийти з організації'), 'error');
    } finally {
      setLeavingOrganization(false);
    }
  };

  const unarchiveProject = async (id) => {
    try {
      await restoreProject(id);
      showToast('Проєкт повернуто з архіву');
    } catch (err) {
      showToast(userFacingErrorMessage(err, 'Не вдалося повернути проєкт з архіву'), 'error');
      return false;
    }
    return true;
  };

  // ── Workflow helpers ─────────────────────────────────────────────
  const makeUpdater = setter => ({
    onSave:   updated => setter(prev => prev.map(i => i.id === updated.id ? updated : i)),
    onDelete: id      => setter(prev => prev.filter(i => i.id !== id)),
  });
  const stA = makeUpdater(setStatuses);
  const tpA = makeUpdater(setTypes);
  const prA = makeUpdater(setPriorities);
  const lbA = makeUpdater(setLabels);

  const handlePriorityDragEnd = result => {
    if (!result.destination) return;
    setPriorities(current => {
      const moved = current[result.source.index];
      if (!moved || isSystemPriorityId(moved.id)) return current;

      const next = [...current];
      next.splice(result.source.index, 1);
      const blockerIndex = next.findIndex(item => item.id === 'blocker');
      const lowIndex = next.findIndex(item => item.id === 'low');
      const destinationIndex = Math.min(
        Math.max(result.destination.index, blockerIndex + 1),
        Math.max(blockerIndex + 1, lowIndex),
      );
      next.splice(destinationIndex, 0, moved);
      return next;
    });
  };

  // ── The workflow editor is a list per category ─────────────────────────────
  // A status's category is where it sits, not a dropdown on its row: you move a
  // status between «У роботі» and «Готово» by dragging it there, the way Linear
  // and Shortcut do it. That makes the two-layer model visible instead of
  // explained — and it means the flat array we save is always in category order,
  // so a project board's columns come out in the order work actually flows.
  const statusesByCategory = useMemo(() => groupStatusesByCategory(statuses), [statuses]);

  // The two invariants the whole product rests on, enforced here and again in the
  // API: something has to close a task, and something has to stay open for new
  // work to land in. Refused with the reason, never silently undone.
  const statusGroupsBreakInvariant = next => {
    const closing = next.filter(status => isClosingCategory(status.category)).length;
    if (closing === 0) {
      return 'Потрібен щонайменше один статус категорії «Готово» — '
        + 'без нього не рахуються прогрес, швидкість і рахунок';
    }
    if (closing === next.length) {
      return 'Потрібен щонайменше один відкритий статус — інакше нові звернення '
        + 'одразу вважатимуться закритими';
    }
    return null;
  };

  const handleStatusDragEnd = result => {
    const { source, destination } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId
      && source.index === destination.index
    ) return;
    const groups = new Map(
      [...statusesByCategory].map(([categoryId, items]) => [categoryId, [...items]]),
    );
    const from = groups.get(source.droppableId);
    const to = groups.get(destination.droppableId);
    if (!from || !to) return;
    const [moved] = from.splice(source.index, 1);
    if (!moved) return;
    to.splice(destination.index, 0, moved);
    const next = flattenStatusGroups(groups);
    if (source.droppableId !== destination.droppableId) {
      const problem = statusGroupsBreakInvariant(next);
      if (problem) {
        showToast(problem, 'error');
        return;
      }
    }
    setStatuses(next);
  };

  // Added into the category you pressed «+» on, and coloured like it: a status
  // starts out looking like what it means, and can be recoloured after.
  const handleAddStatus = categoryId => {
    setStatuses(prev => {
      const groups = groupStatusesByCategory(prev);
      groups.get(categoryId).push({
        id: `s-${Date.now()}`,
        label: 'Новий статус',
        color: STATUS_CATEGORIES[categoryId].color,
        category: categoryId,
        isDone: isClosingCategory(categoryId),
        isNew: true,
      });
      return flattenStatusGroups(groups);
    });
  };

  const handleStatusDeleteClick = async (id) => {
    const mutationOrganizationId = activeOrgId;
    const targetStatus = statuses.find(s => s.id === id);
    if (!targetStatus || targetStatus.isNew) {
      stA.onDelete(id);
      return;
    }
    if (statuses.filter(s => !s.isNew).length <= 1) {
      showToast('Дошка повинна мати хоча б одну видиму колонку', 'error');
      return;
    }
    const problem = statusGroupsBreakInvariant(statuses.filter(s => s.id !== id));
    if (problem) {
      showToast(problem, 'error');
      return;
    }
    // Where the work goes is one rule, shared with «Скинути до стандартних»
    // — see `statusMigrationPlan`.
    const remaining = statuses.filter(s => s.id !== id && !s.isNew);
    const target = statusMigrationTarget(targetStatus, remaining);
    if (!target) return;
    if (!(await confirmDialog({
      title: 'Видалити статус?',
      message: `Усі звернення зі статусом «${targetStatus.label}» буде атомарно переміщено в «${target.label}». Продовжити?`,
      confirmText: 'Видалити й перемістити',
      danger: true,
    }))) return;
    if (
      !mutationOrganizationId
      || wfOrgId.current !== mutationOrganizationId
    ) return;

    const nextStatuses = statuses.filter(status => status.id !== id);
    const payload = {
      statuses: cleanWorkflowItems(nextStatuses),
      types: cleanWorkflowItems(types),
      priorities: cleanWorkflowItems(priorities),
      labels: cleanWorkflowItems(labels),
      positions: cleanWorkflowItems(positions),
    };
    wfLatestPayload.current = payload;
    wfLatestJson.current = JSON.stringify(payload);
    setWfLoading(true);
    try {
      const result = await queueWorkflowMutation(payload, {
        statusMigrations: [{
          fromStatusId: id,
          toStatusId: target.id,
        }],
        notify: false,
      });
      if (wfOrgId.current !== mutationOrganizationId) return;
      setStatuses(nextStatuses);
      showToast(
        result.migratedIssues > 0
          ? `Статус видалено, переміщено звернень: ${result.migratedIssues}`
          : 'Статус видалено',
      );
    } catch (error) {
      if (wfOrgId.current !== mutationOrganizationId) return;
      showToast(
        error.message || 'Не вдалося безпечно видалити статус',
        'error',
      );
    } finally {
      if (wfOrgId.current === mutationOrganizationId) {
        setWfLoading(false);
      }
    }
  };

  // Resetting statuses is a deletion of every custom status at once, so it goes
  // the same way a single deletion does: say where the work lands, then move it
  // in the same transaction that rewrites the workflow.
  //
  // It used to just call `setStatuses(DEFAULT_STATUSES)` and let the debounced
  // autosave post the new list with no migrations. The server refuses that —
  // it will not strand tasks on a status that is about to stop existing — so
  // the save came back «Для видалених або застарілих статусів потрібно вибрати
  // ціль міграції» and the section rolled back. For any organization with real
  // work on a custom status, the reset button simply did not work.
  const handleStatusesReset = async () => {
    const mutationOrganizationId = activeOrgId;
    if (!mutationOrganizationId) return;

    const persistedStatuses = statuses.filter(status => !status.isNew);
    const migrations = planStatusMigrations(persistedStatuses, DEFAULT_STATUSES);
    const movedLabels = migrations
      .map(migration => persistedStatuses.find(status => status.id === migration.fromStatusId))
      .filter(Boolean)
      .map(status => `«${status.label}»`);
    const scope = 'Усі ваші статуси в цій секції буде замінено стандартним набором qTicket.';

    if (!(await confirmDialog({
      title: 'Скинути статуси?',
      message: movedLabels.length > 0
        // Naming them is the whole point: this is the only reset in settings
        // that moves tasks, and the person pressing it should know which.
        ? `${scope} Стандартний набір не містить ${movedLabels.join(', ')} — звернення з цих статусів буде переміщено у стандартний статус тієї самої категорії. Цю дію не можна скасувати.`
        : `${scope} Цю дію не можна скасувати.`,
      confirmText: movedLabels.length > 0 ? 'Скинути й перемістити' : 'Скинути',
      cancelText: 'Залишити',
      danger: true,
    }))) return;
    if (wfOrgId.current !== mutationOrganizationId) return;

    const payload = {
      statuses: cleanWorkflowItems(DEFAULT_STATUSES),
      types: cleanWorkflowItems(types),
      priorities: cleanWorkflowItems(priorities),
      labels: cleanWorkflowItems(labels),
      positions: cleanWorkflowItems(positions),
    };
    wfLatestPayload.current = payload;
    wfLatestJson.current = JSON.stringify(payload);
    setWfLoading(true);
    try {
      let result;
      try {
        result = await queueWorkflowMutation(payload, {
          statusMigrations: migrations,
          notify: false,
        });
      } catch (error) {
        // A task can stand on a status the workflow document no longer lists at
        // all — an import, or a status removed before this rule existed. There
        // is no category to match on, so the server tells us which ids are
        // still unaccounted for and they go to the entry status.
        const orphanIds = error?.code === 'STATUS_MIGRATION_REQUIRED'
          ? (error.statuses || []).map(entry => entry.statusId)
          : [];
        const orphanMigrations = planOrphanStatusMigrations(
          orphanIds,
          DEFAULT_STATUSES,
          migrations,
        );
        if (orphanMigrations.length === 0) throw error;
        if (wfOrgId.current !== mutationOrganizationId) return;
        // The failed attempt rolled the queue's idea of "latest" back to the
        // persisted workflow. Without restating it, the retry would succeed and
        // then immediately be followed by a save of the old statuses.
        wfLatestPayload.current = payload;
        wfLatestJson.current = JSON.stringify(payload);
        result = await queueWorkflowMutation(payload, {
          statusMigrations: [...migrations, ...orphanMigrations],
          notify: false,
        });
      }
      if (wfOrgId.current !== mutationOrganizationId) return;
      setStatuses(DEFAULT_STATUSES);
      showToast(
        result.migratedIssues > 0
          ? `Статуси скинуто, переміщено звернень: ${result.migratedIssues}`
          : 'Статуси скинуто',
      );
    } catch (error) {
      if (wfOrgId.current !== mutationOrganizationId) return;
      showToast(error.message || 'Не вдалося скинути налаштування', 'error');
    } finally {
      if (wfOrgId.current === mutationOrganizationId) setWfLoading(false);
    }
  };

  // Everything «Безпека» says about the account: which services can sign into
  // it, when it was last signed into, and from which devices. Asked for only
  // while the section is open — the devices are a document read, and no other
  // screen in the product has any use for it.
  const accountSecurity = useAccountSessions(
    activeSection === 'account' ? (currentUser?.uid || currentUser?.id || null) : null,
  );
  const signInMethods = describeSignInMethods(accountSecurity.providerData);

  // The account section asks the server what deleting this account would touch,
  // so the confirmation can state it instead of saying "everything". Only for a
  // client account — internal staff have no delete button to explain, and this
  // is three collection queries.
  useEffect(() => {
    if (activeSection !== 'account' || !clientViewer) return undefined;
    let cancelled = false;
    setAccountDeletion(current => ({ ...current, loading: true }));
    fetchAccountDeletionImpact()
      .then(impact => {
        if (cancelled) return;
        setAccountDeletion(current => ({
          ...current,
          loading: false,
          ownedOrganizations: impact.ownedOrganizations || [],
          organizationCount: impact.organizationCount || 0,
          projectCount: impact.projectCount || 0,
          assignedIssueCount: impact.assignedIssueCount || 0,
        }));
      })
      .catch(() => {
        if (!cancelled) setAccountDeletion(current => ({ ...current, loading: false }));
      });
    return () => { cancelled = true; };
  }, [activeSection, clientViewer]);

  const handleDeleteAccount = async () => {
    if (accountDeletion.busy) return;
    const scope = [
      accountDeletion.organizationCount > 0
        && `${accountDeletion.organizationCount} ${plural(accountDeletion.organizationCount, ['організації', 'організацій', 'організацій'])}`,
      accountDeletion.projectCount > 0
        && `${accountDeletion.projectCount} ${plural(accountDeletion.projectCount, ['проєкту', 'проєктів', 'проєктів'])}`,
      accountDeletion.assignedIssueCount > 0
        && `${accountDeletion.assignedIssueCount} ${plural(accountDeletion.assignedIssueCount, ['звернення', 'звернень', 'звернень'])}`,
    ].filter(Boolean);

    // Typed confirmation, not a second «Ви впевнені?». Nothing here can be
    // undone and there is no trash to fish it back out of.
    const typed = await confirmDialog({
      title: 'Видалити обліковий запис назавжди?',
      message: scope.length > 0
        ? `Вас буде прибрано з ${scope.join(', ')}. Створені вами записи й коментарі залишаться в історії, але профіль, налаштування та доступ зникнуть назавжди. Введіть ВИДАЛИТИ, щоб підтвердити.`
        : 'Профіль, налаштування та доступ буде видалено назавжди. Введіть ВИДАЛИТИ, щоб підтвердити.',
      confirmText: 'Видалити назавжди',
      cancelText: 'Скасувати',
      danger: true,
      input: { placeholder: 'ВИДАЛИТИ' },
    });
    if (String(typed || '').trim().toLocaleUpperCase('uk-UA') !== 'ВИДАЛИТИ') return;

    setAccountDeletion(current => ({ ...current, busy: true }));
    try {
      await deleteAccount();
      // The Firebase user no longer exists, so there is nothing left to sign
      // out of on the server; this clears the client session and lands on login.
      showToast('Обліковий запис видалено');
      await signOut();
    } catch (error) {
      setAccountDeletion(current => ({
        ...current,
        busy: false,
        ownedOrganizations: error?.organizations || current.ownedOrganizations,
      }));
      showToast(error.message || 'Не вдалося видалити обліковий запис', 'error');
    }
  };

  const handleDragEnd = (result, list, setList) => {
    if (!result.destination) return;
    const items = Array.from(list);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setList(items);
  };

  // ── Section renderer ─────────────────────────────────────────────
  // Process settings auto-save (no Save button, no status pill — same silent
  // behaviour as Notifications/Localization). Each section gets a reset-to-
  // defaults footer at the very bottom instead, with a short explanation.
  const workflowResetConfig = {
    statuses: {
      noun: 'статуси',
      hint: 'Перетягуйте статуси між категоріями. Категорія визначає поведінку звернення в загальній черзі та показниках підтримки.',
      // Statuses are the one section whose reset moves real work, so it does
      // not go through the debounced autosave. The handler is called from the
      // button below rather than held on this object: a closure stored on a
      // plain object built during render counts as render code, and this one
      // reads refs.
      movesTasks: true,
    },
    types: {
      noun: 'типи',
      hint: '«Звернення» лишається системним типом. Стандартні типи мають власні іконки, а створені вручну позначаються зіркою.',
      apply: () => setTypes(DEFAULT_TYPES),
    },
    priorities: {
      noun: 'пріоритети',
      hint: 'Чотири системні рівні не видаляються. Власні рівні можна додавати між ними — індикатор бере колір, який ви задали самому рівню.',
      apply: () => setPriorities(DEFAULT_PRIORITIES),
    },
    labels: {
      noun: 'мітки',
      hint: 'Мітки доступні в усіх проєктах організації.',
      apply: () => setLabels(DEFAULT_LABELS),
    },
  };
  const renderWorkflowResetFooter = () => {
    const cfg = workflowResetConfig[activeSection];
    if (!cfg) return null;
    return (
      <div className="mt-2 flex flex-col items-start gap-1 px-4 py-3">
        <p className="text-[12px] text-muted leading-relaxed">{cfg.hint}</p>
        <p className="text-[12px] text-muted leading-relaxed">
          Повернути {cfg.noun} до стандартного набору qTicket. Ваші поточні зміни в цій секції буде замінено.
        </p>
        <Button
          style="ghost"
          size="sm"
          icon={RefreshCw}
          className="-ml-3 text-faint hover:text-muted"
          onClick={async () => {
            if (cfg.movesTasks) {
              await handleStatusesReset();
              return;
            }
            const resetOrganizationId = activeOrgId;
            if (!(await confirmDialog({
              title: `Скинути ${cfg.noun}?`,
              message: `Усі ваші ${cfg.noun} в цій секції буде замінено стандартним набором qTicket. Цю дію не можна скасувати.`,
              confirmText: 'Скинути', cancelText: 'Залишити', danger: true,
            }))) return;
            if (
              !resetOrganizationId
              || wfOrgId.current !== resetOrganizationId
            ) return;
            cfg.apply();
          }}
        >
          Скинути до стандартних
        </Button>
      </div>
    );
  };

  const renderSection = () => {
    switch (activeSection) {

      // ──────────────────────────────────────────────────────────────
      // Two profiles, one section, and the difference is who owns the values.
      //
      // A client's account is qTicket's own, so they edit it here. An internal
      // seat's name, email and avatar arrive in QuickTeam's signed provisioning
      // snapshot and are re-written on every sync — editing them here would be
      // a change the next synchronization silently undoes. The section used to
      // be removed outright for staff on that reasoning, which answered a fair
      // question («яке в мене тут імʼя?») with «цього екрана для вас немає».
      // Locked fields say where the answer comes from; a missing screen says
      // nothing at all.
      case 'profile': return clientViewer ? (
        <Section title="Особистий профіль" desc="Ваша інформація відображається у команді підтримки та зверненнях">
          <Card preset="borderless" padding="lg">
            <Row label="Аватар" desc="Квадратне зображення виглядає найкраще — інші обрізаються по центру">
              <ImageUpload
                value={customAvatar || currentUser?.avatar || ''}
                storagePath={customAvatarStoragePath}
                resourceType={customAvatarResourceType}
                organizationId={activeOrgId}
                kind="avatars"
                onChange={saveProfileImage}
                theme="light"
                showLabel={false}
                showHint={false}
              />
            </Row>
            <Row label="Ім'я" desc="Показується у команді підтримки та зверненнях">
              <InlineEditField value={displayName} onChange={setDisplayName} saved={currentUser?.name || ''} onSave={() => saveProfileField('name', displayName)} className="w-[260px]" />
            </Row>
            <Row label="Email" desc="Використовується для входу та запрошень">
              <span className="text-[13px] text-muted">{currentUser?.email}</span>
            </Row>
            {/* Хто ви в компанії й як із вами звʼязатись — те, що підтримці
                справді треба знати про людину по той бік звернення, і чого в
                профілі не було зовсім. Не «про себе»: сторінка колеги в
                таск-менеджері, з якого це форкнули, нікому не допомогла
                відповісти на звернення. Усе тут необовʼязкове. */}
            <Row label="Посада" desc="Ваша роль у компанії — підтримка бачить її у профілі">
              <InlineEditField value={jobTitle} onChange={setJobTitle} saved={currentUser?.title || ''} onSave={() => saveProfileField('title', jobTitle)} className="w-[260px]" />
            </Row>
            <Row label="Телефон" desc="Якщо питання швидше вирішити дзвінком — бачить команда проєкту">
              <InlineEditField value={phone} onChange={setPhone} saved={currentUser?.phone || ''} onSave={() => saveProfileField('phone', phone)} className="w-[260px]" />
            </Row>
            <Row label="Telegram" desc="Нікнейм без @ (наприклад: username)">
              <InlineEditField value={telegram} onChange={setTelegram} saved={currentUser?.telegram || ''} onSave={() => saveProfileField('telegram', telegram)} className="w-[260px]" />
            </Row>
          </Card>
        </Section>
      ) : (
        <Section title="Особистий профіль" desc="Імʼя, фото та пошта приходять із QuickTeam; контакти ви заповнюєте тут">
          {/* No banner over this card. It said «Профіль керується в QuickTeam»
              in three sentences directly under a section description that says
              the same thing in one, above three fields that are visibly greyed
              out and carry the reason on each row. Four ways of saying one
              thing, and the loudest of them was a coloured block the reader had
              to scroll past every time they came here to type a phone number. */}
          <Card preset="borderless" padding="lg">
            <Row label="Аватар" desc="Те саме фото, що у вашому профілі QuickTeam">
              <UserAvatar user={currentUser} size="xl" />
            </Row>
            <Row label="Ім'я" desc="Приходить із QuickTeam — змініть його там">
              <div className="w-full sm:w-[260px]">
                <Input size="md" value={currentUser?.name || ''} readOnly disabled />
              </div>
            </Row>
            <Row label="Email" desc="Приходить із QuickTeam — використовується для входу">
              <div className="w-full sm:w-[260px]">
                <Input size="md" value={currentUser?.email || ''} readOnly disabled />
              </div>
            </Row>
            {/* And the three fields QuickTeam does not send, which is exactly
                why they are editable here. A colleague's profile in «Команда»
                could answer what somebody has open and never how to reach them;
                the customer's half of this screen has carried these rows all
                along, and the desk's half — the half that actually gets called
                — had none of them. Filling one in publishes it to the people
                you work with here, which is the point of the field.

                «Посада» is the one that was missing on this side alone, and it
                is the one the roster reads: `positionName` in «Команда» and in
                every profile falls through to `title`, so an agent with no
                position assigned was listed by their *role* — «Учасник» under
                four different people's names — while the customer sitting
                opposite them had a way to say «Головний бухгалтер» and they did
                not. It is qTicket's own field: provisioning writes the name,
                the email and the avatar, and never touches this one. */}
            <Row label="Посада" desc="Ваша роль у компанії — бачать усі, з ким ви працюєте в qTicket">
              <InlineEditField value={jobTitle} onChange={setJobTitle} saved={currentUser?.title || ''} onSave={() => saveProfileField('title', jobTitle)} className="w-[260px]" />
            </Row>
            <Row label="Телефон" desc="Бачать усі, з ким ви працюєте в qTicket">
              <InlineEditField value={phone} onChange={setPhone} saved={currentUser?.phone || ''} onSave={() => saveProfileField('phone', phone)} className="w-[260px]" />
            </Row>
            <Row label="Telegram" desc="Нікнейм без @ — бачать усі, з ким ви працюєте в qTicket">
              <InlineEditField value={telegram} onChange={setTelegram} saved={currentUser?.telegram || ''} onSave={() => saveProfileField('telegram', telegram)} className="w-[260px]" />
            </Row>
          </Card>
        </Section>
      );

      // ──────────────────────────────────────────────────────────────
      case 'notifications': {
        // Three cards, one per channel, because that is the question people
        // arrive with: «що мені шле Telegram?». The previous version was five
        // event switches in one list with the channel policy hardcoded in the
        // senders, and which event reached which channel was written nowhere.
        //
        // Ported from QuickTeam rather than designed again — the shape has been
        // in front of users there for a year, and the owner asked for that one.
        const eventRows = [
          { key: 'assigned',      label: 'Звернення призначено мені', desc: 'Хтось призначив звернення на тебе або створив нове одразу з тобою' },
          // A client is never a «виконавець» — that word describes a seat they
          // cannot hold.
          { key: 'commented',     label: 'Нове повідомлення',        desc: 'Там, де ти автор або учасник розмови' },
          { key: 'mentioned',     label: 'Згадування',               desc: 'Хтось написав @твоє-імʼя в розмові звернення' },
          { key: 'statusChanged', label: 'Зміна статусу',            desc: 'Коли звернення переходить на інший етап' },
          { key: 'deadline',      label: 'Терміни вирішення',        desc: 'За добу до обіцяного терміну і далі, поки звернення відкрите' },
        ].filter(row => QTICKET_NOTIFICATION_EVENT_KEYS.includes(row.key)
          // «Терміни вирішення» only ever reaches an assignee, and a client is
          // never one. A switch for a message that cannot arrive is a promise
          // the product does not keep.
          && !(clientViewer && row.key === 'deadline'));

        // Every line is the shared <Row>, so all three cards land on the same
        // label column and the same right-hand control column.
        const channelCard = ({ id, icon: ChannelIcon, title, caption, master, available, offNote, showDesc = false, footer = null }) => (
          <Card preset="borderless" padding="lg">
            {/* The channel switch is the big one: it governs every row in the
                card below it. The rows are `sm`, so the difference in size says
                which is which without a word. */}
            <CardHeading icon={ChannelIcon} title={title} caption={caption} action={master} />

            {available ? eventRows.map(row => (
              <Row key={row.key} label={row.label} desc={showDesc ? row.desc : undefined}>
                <ToggleSwitch
                  checked={notifMatrix[id][row.key] === true}
                  onChange={value => setChannelEvent(id, row.key, value)}
                  size="sm"
                  ariaLabel={`${row.label} — ${title}`}
                />
              </Row>
            )) : (
              <p className="py-[14px] text-[12px] leading-relaxed text-faint">{offNote}</p>
            )}

            {footer}
          </Card>
        );

        return (
          <Section title="Сповіщення" desc="Кожен канал окремо: оберіть, про що він вас повідомляє">
            {channelCard({
              id: 'inapp',
              icon: Bell,
              title: 'На сайті',
              caption: 'Дзвіночок у шапці робочого простору',
              available: true,
              showDesc: true,
              footer: (
                <div className="mt-1 border-t border-line pt-1">
                  <Row label="Звук" desc="Короткий сигнал при новому сповіщенні">
                    <ToggleSwitch checked={notif.sound} onChange={v => setNotif(p => ({ ...p, sound: v }))} size="sm" />
                  </Row>
                  <Row label="Спливаючі сповіщення" desc="Картка внизу екрана, коли подія стається в реальному часі">
                    <ToggleSwitch checked={notif.popup} onChange={v => setNotif(p => ({ ...p, popup: v }))} size="sm" />
                  </Row>
                </div>
              ),
            })}

            {/* Email is drawn with the switch it will have, and says plainly
                that it cannot deliver yet. The alternative — hiding the card
                until a provider exists — is how «а куди мені шле листи?» became
                a question with no screen to answer it. */}
            {channelCard({
              id: 'email',
              icon: Mail,
              title: 'Email',
              caption: emailDeliveryConfigured
                ? (currentUser?.email || 'Пошта не вказана')
                : 'Поштового провайдера ще не підключено',
              available: emailDeliveryConfigured && notif.emailEnabled === true,
              offNote: emailDeliveryConfigured
                ? 'Канал вимкнено — увімкніть, щоб обрати, що дублювати на пошту.'
                : 'Листи вимкнено на рівні середовища: домен для відправки ще не налаштовано. Щойно його підключать, цей канал запрацює з тими перемикачами, які ви тут виберете.',
              master: (
                <ToggleSwitch
                  checked={notif.emailEnabled === true}
                  onChange={v => setNotif(p => ({ ...p, emailEnabled: v }))}
                  disabled={!emailDeliveryConfigured}
                  size="md"
                  ariaLabel="Сповіщення на пошту"
                />
              ),
            })}

            {/* The switch is the connection. Turning it on opens the bot;
                turning it off unlinks the chat. A channel that is linked but
                silent, and one that is enabled but unlinked, are two states
                nobody wants and everybody creates by accident. */}
            {channelCard({
              id: 'telegram',
              icon: Send,
              title: 'Telegram',
              caption: telegramBotStatus.connected
                ? `Підключено: ${telegramBotStatus.chatTitle || 'особистий чат із ботом'}`
                : telegramAwaitingLink
                  ? 'Натисніть «Старт» у Telegram — підключиться саме'
                  : telegramBotStatus.configured
                    ? 'Не підключено'
                    : 'Інтеграцію не налаштовано в цьому середовищі',
              available: telegramBotStatus.connected && notif.telegramEnabled === true,
              offNote: telegramBotStatus.configured
                ? 'Увімкніть канал — відкриється бот. Після «Старт» тут зʼявиться список подій.'
                : 'Інтеграцію не налаштовано в цьому середовищі.',
              master: (
                <ToggleSwitch
                  checked={telegramBotStatus.connected && notif.telegramEnabled === true}
                  onChange={toggleTelegram}
                  disabled={
                    telegramBotLoading
                    || telegramAwaitingLink
                    || (!telegramBotStatus.configured && !telegramBotStatus.connected)
                  }
                  size="md"
                  ariaLabel="Сповіщення в Telegram"
                />
              ),
            })}
          </Section>
        );
      }

      // ──────────────────────────────────────────────────────────────
      case 'localization': {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');

        const hours24Num = now.getHours();
        const mins = String(now.getMinutes()).padStart(2, '0');
        const hours24Str = String(hours24Num).padStart(2, '0');
        const hours12Num = hours24Num % 12 || 12;
        const ampm = hours24Num >= 12 ? 'PM' : 'AM';

        const COMMON_TIMEZONES = [
          'UTC',
          'Pacific/Midway',
          'Pacific/Honolulu',
          'America/Anchorage',
          'America/Los_Angeles',
          'America/Denver',
          'America/Chicago',
          'America/New_York',
          'America/Caracas',
          'America/Buenos_Aires',
          'America/Sao_Paulo',
          'Atlantic/South_Georgia',
          'Atlantic/Azores',
          'Europe/London',
          'Europe/Paris',
          'Europe/Berlin',
          'Europe/Kyiv',
          'Europe/Helsinki',
          'Europe/Istanbul',
          'Asia/Jerusalem',
          'Asia/Dubai',
          'Asia/Tehran',
          'Asia/Kabul',
          'Asia/Karachi',
          'Asia/Kolkata',
          'Asia/Kathmandu',
          'Asia/Dhaka',
          'Asia/Yangon',
          'Asia/Bangkok',
          'Asia/Shanghai',
          'Asia/Hong_Kong',
          'Asia/Tokyo',
          'Australia/Perth',
          'Australia/Adelaide',
          'Australia/Sydney',
          'Pacific/Noumea',
          'Pacific/Auckland',
          'Pacific/Fiji',
          'Pacific/Tongatapu'
        ];

        const tzOptions = COMMON_TIMEZONES.map(tz => {
          try {
            const date = new Date();
            const timeStr = date.toLocaleTimeString('uk-UA', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
            let gmtStr = '';
            try {
              const str = date.toLocaleString('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' });
              const match = str.match(/GMT([+-]\d+(?::\d+)?)/);
              gmtStr = match ? `GMT${match[1]}` : 'GMT+0';
            } catch (e) {}

            return { value: tz, label: `${tz} (${gmtStr}, ${timeStr})` };
          } catch(e) {
            return { value: tz, label: tz };
          }
        });

        return (
        <Section title="Локалізація та регіон" desc="Налаштуйте відображення дати, часу та формату календаря відповідно до вашого регіону">
          <Card preset="borderless" padding="lg">
            <Row label="Мова інтерфейсу" desc="Наразі інтерфейс доступний лише українською">
              <Select
                value={language}
                onChange={setLanguage}
                disabled
                options={[
                  { value: 'ua', label: 'Українська' }
                ]}
                className="w-full sm:w-[240px]"
              />
            </Row>
            <Row label="Формат дати" desc="Оберіть зручний формат представлення дати">
              <Select
                value={dateFormat}
                onChange={setDateFormat}
                options={[
                  { value: 'DD.MM.YYYY', label: `DD.MM.YYYY (${dd}.${mm}.${yyyy})` },
                  { value: 'YYYY-MM-DD', label: `YYYY-MM-DD (${yyyy}-${mm}-${dd})` },
                  { value: 'MM/DD/YYYY', label: `MM/DD/YYYY (${mm}/${dd}/${yyyy})` }
                ]}
                className="w-full sm:w-[240px]"
              />
            </Row>
            <Row label="Перший день тижня" desc="Перший день тижня в сітці календаря (DatePicker)">
              <Select
                value={firstDayOfWeek}
                onChange={setFirstDayOfWeek}
                options={[
                  { value: 'Monday', label: 'Понеділок' },
                  { value: 'Sunday', label: 'Неділя' }
                ]}
                className="w-full sm:w-[240px]"
              />
            </Row>
            <Row label="Формат часу" desc="Виберіть між 24-годинним або 12-годинним форматом відображення">
              <Select
                value={timeFormat}
                onChange={setTimeFormat}
                options={[
                  { value: '24h', label: `24-годинний (${hours24Str}:${mins})` },
                  { value: '12h', label: `12-годинний (${hours12Num}:${mins} ${ampm})` }
                ]}
                className="w-full sm:w-[240px]"
              />
            </Row>
            <Row label="Часовий пояс" desc="Поточний регіональний час для планування">
              <Select
                value={timezone}
                onChange={setTimezone}
                options={tzOptions}
                className="w-full sm:w-[240px]"
              />
            </Row>
          </Card>
        </Section>
      );
      }

      // ──────────────────────────────────────────────────────────────
      // The brand is QuickTeam's. It arrives in the `portalBranding` snapshot
      // and is re-sent on the next provisioning sync, so an editor here was a
      // second place to change one setting — and the qTicket copy is the one
      // the next snapshot overwrites. The section stays because somebody has
      // to be able to see the brand qTicket is wearing; it no longer pretends
      // to own it.

      // ──────────────────────────────────────────────────────────────
      case 'statuses': {
        const closingStatuses = statuses.filter(s => isClosingCategory(s.category));
        const openStatuses = statuses.filter(s => !isClosingCategory(s.category));
        const statusAnnouncements = createUkrainianDndAnnouncements({
          itemLabel: draggableId => statuses.find(status => status.id === draggableId)?.label || 'Статус',
          listLabel: categoryId => STATUS_CATEGORIES[categoryId]?.label || 'Категорія статусів',
        });
        // The last status that closes a task and the last one that stays open
        // cannot be deleted — the same two invariants the drag guard enforces,
        // shown as a disabled control rather than a refusal after the click.
        const canDeleteStatus = status => (
          statuses.filter(s => !s.isNew).length > 1
          && !(isClosingCategory(status.category) && closingStatuses.length === 1)
          && !(!isClosingCategory(status.category) && openStatuses.length === 1)
        );
        return (
        <Section title="Статуси звернень" desc="Налаштуйте етапи, через які проходять звернення клієнтів.">
          {wfLoading ? (
            <div className="py-12 flex items-center justify-center">
              <LoadingSpinner size="md" />
            </div>
          ) : (
            <Card preset="borderless">
              <DragDropContext
                dragHandleUsageInstructions={UKRAINIAN_DRAG_HANDLE_USAGE_INSTRUCTIONS}
                onDragStart={statusAnnouncements.onDragStart}
                onDragUpdate={statusAnnouncements.onDragUpdate}
                onDragEnd={(result, provided) => {
                  statusAnnouncements.onDragEnd(result, provided);
                  handleStatusDragEnd(result);
                }}
              >
                {STATUS_CATEGORY_IDS.map((categoryId, categoryIndex) => {
                  const category = STATUS_CATEGORIES[categoryId];
                  const CategoryIcon = STATUS_CATEGORY_ICONS[categoryId];
                  const items = statusesByCategory.get(categoryId) || [];
                  return (
                    <section
                      key={categoryId}
                      className={categoryIndex > 0 ? 'mt-5 border-t border-line pt-5' : ''}
                    >
                      <header className="mb-2 flex items-center gap-[10px]">
                        <CategoryIcon
                          size={16}
                          strokeWidth={2}
                          style={{ color: category.color }}
                          className="shrink-0"
                          aria-hidden
                        />
                        <h3 className="min-w-0 flex-1 ui-type-card-title text-ink">{category.label}</h3>
                        <Button
                          onClick={() => handleAddStatus(categoryId)}
                          style="ghost"
                          size="icon"
                          icon={Plus}
                          title={`Додати статус у «${category.label}»`}
                          aria-label={`Додати статус у «${category.label}»`}
                        />
                      </header>
                      <Droppable droppableId={categoryId}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`rounded-[12px] transition-colors ${
                              snapshot.isDraggingOver ? 'bg-canvas' : ''
                            }`}
                          >
                            {items.map((s, i) => (
                              <Draggable key={s.id || `new-${i}`} draggableId={s.id || `new-${i}`} index={i}>
                                {(dragProvided) => (
                                  <WorkflowItem item={s}
                                    onSave={stA.onSave} onDelete={handleStatusDeleteClick}
                                    canDelete={canDeleteStatus(s)}
                                    variant="status"
                                    provided={dragProvided}
                                  />
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                            {items.length === 0 && !snapshot.isDraggingOver && (
                              <p className="px-[8px] py-[10px] text-[12px] text-faint">
                                Немає статусів. Перетягніть сюди статус або натисніть «+».
                              </p>
                            )}
                          </div>
                        )}
                      </Droppable>
                    </section>
                  );
                })}
              </DragDropContext>
            </Card>
          )}
          {!wfLoading && renderWorkflowResetFooter()}
        </Section>
        );
      }

      // QUI-130. The epic sentence outlived the epics: the type was removed and
      // migrated away, so the only thing it still explained was itself.
      case 'types': {
        const addType = () => setTypes(current => [
          ...current,
          {
            id: `t-${Date.now()}`,
            label: '',
            color: '#8b5cf6',
            icon: 'star',
            isNew: true,
          },
        ]);
        return (
        <Section title="Типи звернень" desc="Налаштуйте, як команда класифікує звернення клієнтів.">
          {wfLoading ? (
            <div className="py-12 flex items-center justify-center">
              <LoadingSpinner size="md" />
            </div>
          ) : (
            <Card preset="borderless">
              {types.map(t => (
                <WorkflowItem
                  key={t.id}
                  item={t}
                  onSave={tpA.onSave}
                  onDelete={tpA.onDelete}
                  canDelete={!isSystemTaskTypeId(t.id)}
                  locked={isSystemTaskTypeId(t.id)}
                  variant="type"
                  typeSuggestions={DEFAULT_TYPES.filter(type => !types.some(current => current.id === type.id))}
                  onChooseTypeSuggestion={preset => setTypes(current => current.map(type => (
                    type.id === t.id ? { ...preset } : type
                  )))}
                />
              ))}
              <Button
                onClick={addType}
                style="ghost"
                size="lg"
                icon={Plus}
                composition="settings-row-action"
                className="mt-2"
              >
                Додати тип
              </Button>
            </Card>
          )}
          {!wfLoading && renderWorkflowResetFooter()}
        </Section>
        );
      }

      case 'priorities': {
        const priorityAnnouncements = createUkrainianDndAnnouncements({
          itemLabel: draggableId => priorities.find(priority => priority.id === draggableId)?.label || 'Пріоритет',
          listLabel: () => 'Пріоритети',
        });
        return (
        <Section title="Пріоритети звернень" desc="Налаштуйте рівні терміновості клієнтських звернень.">
          {wfLoading ? (
            <div className="py-12 flex items-center justify-center">
              <LoadingSpinner size="md" />
            </div>
          ) : (
            <Card preset="borderless">
              <DragDropContext
                dragHandleUsageInstructions={UKRAINIAN_DRAG_HANDLE_USAGE_INSTRUCTIONS}
                onDragStart={priorityAnnouncements.onDragStart}
                onDragUpdate={priorityAnnouncements.onDragUpdate}
                onDragEnd={(result, provided) => {
                  priorityAnnouncements.onDragEnd(result, provided);
                  handlePriorityDragEnd(result);
                }}
              >
                <Droppable droppableId="workflow-priorities">
                  {provided => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                      {priorities.map((pItem, index) => {
                        const locked = isSystemPriorityId(pItem.id);
                        return (
                          <Draggable key={pItem.id} draggableId={pItem.id} index={index} isDragDisabled={locked}>
                            {dragProvided => (
                              <WorkflowItem
                                item={pItem}
                                onSave={prA.onSave}
                                onDelete={prA.onDelete}
                                canDelete={!locked}
                                locked={locked}
                                variant="priority"
                                provided={dragProvided}
                                priorityItems={priorities}
                              />
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
              <Button
                onClick={() => setPriorities(current => {
                  const lowIndex = current.findIndex(item => item.id === 'low');
                  const next = [...current];
                  next.splice(lowIndex < 0 ? current.length : lowIndex, 0, {
                    id: `p-${Date.now()}`,
                    label: 'Новий пріоритет',
                    color: '#eab308',
                    isNew: true,
                  });
                  return next;
                })}
                style="ghost" size="lg"
                icon={Plus}
                composition="settings-row-action"
                className="mt-2"
              >
                Додати пріоритет
              </Button>
            </Card>
          )}
          {!wfLoading && renderWorkflowResetFooter()}
        </Section>
        );
      }

      case 'labels': return (
        <Section title="Мітки звернень" desc="Спільні мітки для класифікації звернень">
          {wfLoading ? (
            <div className="py-12 flex items-center justify-center">
              <LoadingSpinner size="md" />
            </div>
          ) : (
            <Card preset="borderless">
              {labels.map(l => (
                <WorkflowItem key={l.id} item={l} onSave={lbA.onSave} onDelete={lbA.onDelete} variant="label" />
              ))}
              <Button
                onClick={() => setLabels(p => [...p, { id: `l-${Date.now()}`, label: 'Нова мітка', color: '#db2777', isNew: true }])}
                style="ghost" size="lg"
                icon={Plus}
                composition="settings-row-action"
                className="mt-2"
              >
                Додати мітку
              </Button>
            </Card>
          )}
          {!wfLoading && renderWorkflowResetFooter()}
        </Section>
      );

      // ──────────────────────────────────────────────────────────────
      case 'account': {
        // `formatTime` formats an "HH:MM" string off a form. Handed a Date it
        // returned the Date, and a settings row printed «Wed Aug 19 2026
        // 13:27:08 GMT+0300 (за східноєвропейським літнім часом)» — the line
        // that looked broken was this.
        const clockLabel = date => new Intl.DateTimeFormat('uk-UA', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: savedTimeFormat === '12h',
        }).format(date);
        const whenLabel = date => `${formatDate(date)}, ${clockLabel(date)}`;
        // One action, beside the heading. A button per row is not on offer —
        // signing out takes an account and not a device — and «вийти всюди
        // разом із цим» is a thing nobody came to this screen wanting. What a
        // person is here for is «цей пристрій мій, решта хай вийдуть», and that
        // is the whole panel.
        const DEVICE_ICONS = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

        const endOthers = async () => {
          const confirmed = await confirmDialog({
            title: 'Вийти з усіх, крім цього?',
            message: 'Цей пристрій лишиться в акаунті. На решті доведеться увійти заново.',
            confirmText: 'Вийти',
            danger: true,
          });
          if (!confirmed) return;
          try {
            const result = await accountSecurity.endOtherSessions();
            showToast(result?.endedCount
              ? `Завершено сеансів: ${result.endedCount}`
              : 'Інших пристроїв не було');
          } catch (error) {
            showToast(userFacingErrorMessage(error, 'Не вдалося вийти на інших пристроях'), 'error');
          }
        };
        return (
        // One question, asked in the order somebody worried about their account
        // asks it: who has been in here, when was that, and how can anybody get
        // in at all. The screen used to open with a link to another screen.
        <Section
          title="Безпека"
          desc={clientViewer
            ? 'Хто заходив у цей обліковий запис і звідки. Якщо якийсь пристрій вам незнайомий — вийдіть з усіх, крім цього, і перевірте, через які сервіси сюди можна увійти.'
            // Staff see the sessions and nothing else. The sessions are
            // qTicket's own — this browser opened this app — while the identity
            // behind them, the seat in the organization and the account itself
            // belong to QuickTeam, which is where they are changed.
            : 'Хто заходив у цей обліковий запис і звідки. Якщо якийсь пристрій вам незнайомий — вийдіть з усіх, крім цього. Сам обліковий запис, спосіб входу й доступ до організації налаштовуються у QuickTeam.'}
        >
          {/* Звідки заходили — first, because it is the answer. One row per
              browser the account has been opened in, newest first, this one at
              the top. The place comes from the request itself and is simply
              missing when the platform does not report it — a session that
              cannot say where it came from must not make one up. */}
          <Card preset="borderless" padding="lg">
            {/* No figure beside the label. «3» is the length of the list
                directly under it — a number the reader counts faster than they
                read it, and one that said nothing about whether any of the
                three is a stranger. */}
            <GroupLabel
              label="Пристрої"
              action={(
                <Button
                  onClick={endOthers}
                  style="ghost"
                  color="red"
                  size="sm"
                  loading={accountSecurity.busyId === 'others'}
                  disabled={Boolean(accountSecurity.busyId) || accountSecurity.sessions.length < 2}
                >
                  Вийти з усіх, крім цього
                </Button>
              )}
            />
            {accountSecurity.loading ? (
              <div className="flex justify-center py-8"><LoadingSpinner size="md" /></div>
            ) : accountSecurity.sessions.length === 0 ? (
              <p className="py-3 text-[13px] text-muted">
                Ще нічого не записано. Наступний вхід зʼявиться тут.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {accountSecurity.sessions.map(session => (
                  <div key={session.id} className="flex items-center gap-3 py-[10px] first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-center gap-3">
                      {/* The shape of the thing, not its name. Two laptops and
                          a phone are told apart before any of the text is
                          read, which is the whole job of this list. */}
                      {(() => {
                        const DeviceIcon = DEVICE_ICONS[session.kind] || MonitorSmartphone;
                        return <DeviceIcon size={16} className="shrink-0 text-muted" />;
                      })()}
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-[13px] font-semibold text-ink">{session.device}</p>
                          {session.isCurrent && <Pill size="md" className="shrink-0">Цей пристрій</Pill>}
                        </div>
                        {/* The device reading this row is here now, whatever
                            the stored stamp says: that stamp is written on a
                            schedule, so a browser somebody has been sitting in
                            all afternoon used to report the morning. It is the
                            one row whose answer is known without being read. */}
                        <p className="mt-0.5 truncate text-[12px] text-muted">
                          {[
                            session.place,
                            session.isCurrent
                              ? 'зараз тут'
                              : session.lastSeenMillis
                                ? `востаннє ${whenLabel(new Date(session.lastSeenMillis))}`
                                : null,
                          ].filter(Boolean).join(' · ') || 'Час останнього входу невідомий'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </Card>

          {/* «Способи входу» lives here now rather than in a section of its
              own. Which services can open this account is the other half of
              «хто може сюди зайти», and the two halves were on two screens with
              a button on one pointing at the other.

              Client accounts only. A staff identity is QuickTeam's — it arrives
              in the signed snapshot and comes back on the next sync — so a
              second place to attach or detach a provider is a copy that loses
              the argument. Staff keep the sessions above, which are qTicket's
              own record of this browser opening this app.

              And it lists the doors that open. This section is drawn for
              clients, and it was offering a client OneB — the provider `/login`
              draws only for staff — beside a GitHub whose button is behind a
              flag that is off. Two of its three live rows attached a provider
              that could not then be used to sign in, which is not a setting but
              an invitation to try and come back with nothing.
              `CLIENT_LOGIN_PROVIDERS` is the same answer the sign-in screen
              gives, asked once instead of twice. */}
          {clientViewer && (
          <Card preset="borderless" padding="lg">
            <GroupLabel label="Способи входу" />
            <div className="divide-y divide-canvas">
              {CLIENT_LOGIN_PROVIDERS.github && <LoginMethodItem
                icon={<GitHubLogo size={18} />}
                title="GitHub"
                detail={hasGithubAuth ? 'Підключено до поточного акаунта' : 'Вхід через GitHub OAuth'}
                connected={hasGithubAuth}
                primary={isPrimaryGitHub}
                loading={authMethodLoading === 'github-connect' || authMethodLoading === 'github-disconnect'}
                disabled={Boolean(authMethodLoading)}
                onConnect={handleConnectGitHub}
                onDisconnect={handleDisconnectGitHub}
              />}
              <LoginMethodItem
                icon={<GoogleLogo size={18} />}
                title="Google"
                detail={hasGoogleAuth ? 'Підключено до поточного акаунта' : 'Вхід через Google OAuth'}
                connected={hasGoogleAuth}
                primary={isPrimaryGoogle}
                loading={authMethodLoading === 'google-connect' || authMethodLoading === 'google-disconnect'}
                disabled={Boolean(authMethodLoading)}
                onConnect={handleConnectGoogle}
                onDisconnect={handleDisconnectGoogle}
              />
              {CLIENT_LOGIN_PROVIDERS.oneb && <LoginMethodItem
                icon={<OneBMark />}
                title="OneB"
                detail={hasOneBAuth
                  ? (currentUser?.onebAlias || currentUser?.onebWorkspace || 'Підключено до екосистеми OneB')
                  : 'Вхід через OneB OAuth'}
                connected={hasOneBAuth}
                primary={isPrimaryOneB}
                loading={authMethodLoading === 'oneb-connect' || authMethodLoading === 'oneb-disconnect'}
                disabled={Boolean(authMethodLoading)}
                onConnect={handleConnectOneB}
                onDisconnect={handleDisconnectOneB}
              />}
              <LoginMethodItem
                icon={<Mail size={18} />}
                title="Email"
                detail="Вхід по email-коду тимчасово вимкнений"
                connected={false}
                primary={isPrimaryEmail}
                soon
                loading={false}
                disabled
                staticMethod
                onConnect={() => {}}
                onDisconnect={() => {}}
              />
            </div>
          </Card>
          )}

          {/* «Організація і бренд» was cut down to one row here and is now cut
              the rest of the way. «Безпека» answers who has been in this
              account and how anybody gets in at all; a badge saying the tenant
              name and logo are synchronised from QuickTeam answers none of that,
              and the row's own description was an instruction for a different
              product. Nothing was lost with it — it changed nothing, and the
              section's copy already says the organization is set up in
              QuickTeam. */}

          <Card preset="borderless" padding="lg">
            <Row label="Вийти з акаунта" desc="Завершити сесію на цьому пристрої">
              <Button
                onClick={async () => {
                  if (await confirmDialog({ title: 'Вийти з акаунта?', confirmText: 'Вийти', danger: true })) signOut();
                }}
                style="ghost" color="red" size="lg"
                icon={LogOut}
              >
                Вийти
              </Button>
            </Row>

            {/* Leaving and deleting are client-account actions. A staff seat is
                opened and closed in QuickTeam — the server already refuses both
                for a QuickTeam-managed membership — and the account behind it is
                a QuickTeam identity, so a button here could only fail. Signing
                out above stays: that ends a qTicket session, which is qTicket's
                to end. */}
            {clientViewer && (
            <>
            <Row
              label="Вийти з організації"
              desc={isOwner
                ? 'Ви власник. Спершу передайте права власника комусь із команди'
                : 'Ви втратите доступ до організації та її проєктів. Повідомлення, коментарі й історія залишаться за вами, а адміністратор зможе повернути доступ'}
            >
              <Button
                onClick={handleLeaveOrganization}
                style="ghost" color="red" size="lg"
                icon={UserRoundX}
                loading={leavingOrganization}
                disabled={isOwner}
              >
                Вийти з організації
              </Button>
            </Row>

            {/* The one action a person is unconditionally entitled to take
                about their own data. The product used to answer this with
                «зверніться до підтримки», which is not an answer. */}
            <Row
              label="Видалення облікового запису"
              desc={accountDeletion.ownedOrganizations.length > 0
                ? `Ви власник: ${accountDeletion.ownedOrganizations.join(', ')}. Спершу передайте власність або зверніться до підтримки.`
                : 'Вас буде прибрано з усіх організацій, а обліковий запис і особисті дані — видалено назавжди'}
            >
              <Button
                onClick={handleDeleteAccount}
                style="primary"
                color="red"
                size="lg"
                icon={Trash2}
                loading={accountDeletion.busy}
                disabled={accountDeletion.loading || accountDeletion.ownedOrganizations.length > 0}
              >
                Видалити акаунт
              </Button>
            </Row>
            </>
            )}
          </Card>
        </Section>
        );
      }

      // ──────────────────────────────────────────────────────────────
      // One place for everything that is out of the way but not gone. Projects
      // were already here; tasks used to have nowhere at all — «Архівувати»
      // deleted them into a tombstone nobody could list, and the only way back
      // was a banner inside the task while it was still open.
      case 'archives': {
        const archivedProjects = (projects || []).filter(p => p.status === 'archived');
        // A count belongs in a `Counter`, not appended to the label with a dot:
        // three lists whose names already differ in length turned the strip into
        // a wall of text. The stepper shape also gives «Нещодавно видалене» the
        // width it needs instead of squeezing it into a section header.
        const archiveTabs = [
          { id: 'projects', label: 'Проєкти', count: archivedProjects.length },
          { id: 'issues', label: 'Звернення', count: archivedIssueList.length },
          { id: 'cancelled', label: 'Скасовані', count: cancelledIssueList.length },
          { id: 'deleted', label: 'Нещодавно видалене', count: deletedIssues.items.length },
        ];
        return (
          <Section
            title="Архів і видалене"
            desc="Архівовані звернення зникають з активної черги, але зберігають історію та показники. Скасовані не рахуються як робота. Обидва типи зберігаються без строку, а нещодавно видалені можна відновити протягом доби"
          >
            <div className="w-full overflow-x-auto">
              <Tabs
                variant="underline"
                tabs={archiveTabs}
                activeTab={archiveTab}
                onTabChange={setArchiveTab}
              />
            </div>
            <Card preset="borderless" padding="lg">
              {archiveTab === 'projects' && (
                archivedProjects.length === 0 ? (
                  <ArchiveEmpty
                    title="Немає архівованих проєктів"
                    hint="Тут відображатимуться всі архівовані проєкти"
                  />
                ) : (
                  <div className="flex flex-col divide-y divide-canvas -my-3">
                    {archivedProjects.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-ink truncate">{p.name}</p>
                          {p.description && (
                            <p className="text-[12px] text-muted truncate mt-0.5">{p.description}</p>
                          )}
                        </div>
                        <Button
                          onClick={() => unarchiveProject(p.id)}
                          style="secondary"
                          size="sm"
                          icon={ArchiveRestore}
                          className="ml-4 shrink-0"
                        >
                          Розархівувати
                        </Button>
                      </div>
                    ))}
                  </div>
                )
              )}

              {archiveTab === 'issues' && (
                archivedIssuesLoading && archivedIssueList.length === 0 ? (
                  <div className="flex justify-center py-12"><LoadingSpinner size="md" /></div>
                ) : archivedIssueList.length === 0 ? (
                  <ArchiveEmpty
                    title="Немає архівованих звернень"
                    hint="Архівуйте завершені звернення: вони зникнуть з активної черги, але вся історія та розмова збережуться"
                  />
                ) : (
                  <ArchiveIssueRows
                    issues={archivedIssueList}
                    projectNameById={projectNameById}
                    since={issue => (issue.archivedAt ? ` · в архіві з ${formatDate(issue.archivedAt)}` : '')}
                    onOpen={issue => router.push(issuePath(issue, issue.projectId))}
                    restore={{
                      icon: ArchiveRestore,
                      label: 'Повернути',
                      onClick: handleUnarchiveIssue,
                    }}
                  />
                )
              )}

              {archiveTab === 'cancelled' && (
                archivedIssuesLoading && cancelledIssueList.length === 0 ? (
                  <div className="flex justify-center py-12"><LoadingSpinner size="md" /></div>
                ) : cancelledIssueList.length === 0 ? (
                  <ArchiveEmpty
                    title="Немає скасованих звернень"
                    hint="Скасовані звернення не входять до активної черги, але лишаються тут і можуть бути повернуті"
                  />
                ) : (
                  <ArchiveIssueRows
                    issues={cancelledIssueList}
                    projectNameById={projectNameById}
                    since={issue => (issue.cancelledAt ? ` · скасовано ${formatDate(issue.cancelledAt)}` : '')}
                    onOpen={issue => router.push(issuePath(issue, issue.projectId))}
                    restore={{
                      icon: Undo2,
                      label: 'Повернути',
                      onClick: handleUncancelIssue,
                    }}
                  />
                )
              )}

              {archiveTab === 'deleted' && (
                deletedIssues.loading && deletedIssues.items.length === 0 ? (
                  <div className="flex justify-center py-12"><LoadingSpinner size="md" /></div>
                ) : deletedIssues.items.length === 0 ? (
                  <ArchiveEmpty
                    title="Нічого не видаляли"
                    hint="Видалене звернення зберігається тут одну добу, протягом якої його можна відновити"
                  />
                ) : (
                  <div className="flex flex-col divide-y divide-canvas -my-3">
                    {deletedIssues.items.map(item => (
                      <div key={item.issueId} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <Pill size="md" className="shrink-0">{item.issueKey}</Pill>
                            <p className="truncate text-[13px] font-semibold text-ink">{item.title || 'Без назви'}</p>
                          </div>
                          <p className="mt-0.5 truncate text-[12px] text-muted">
                            {item.projectName || projectNameById(item.projectId)} · {remainingTrashTime(item.purgeAfter)}
                          </p>
                        </div>
                        <Button
                          style="secondary"
                          size="sm"
                          icon={ArchiveRestore}
                          onClick={() => handleRestoreDeletedIssue(item)}
                        >
                          Відновити
                        </Button>
                      </div>
                    ))}
                  </div>
                )
              )}
            </Card>
          </Section>
        );
      }

      default: return null;
    }
  };




  // ── Layout ───────────────────────────────────────────────────
  //
  // The rail draws exactly what `reachableSections` allows — the same list the
  // address bar and the section body are answered from.
  const allowedNav = NAV.filter(item => reachableSections.has(item.id));

  const handleNavChange = async (id) => {
    const success = await handleSectionChange(id);
    if (success) setMobilePane('content');
  };

  const sidebarContent = (
    <InnerNavigation
      items={allowedNav}
      activeId={activeSection}
      onChange={handleNavChange}
    />
  );

  // One level up. Every section is one level deep, so this is the way out of
  // the pane.
  const mobileBack = () => {
    requestPaneClose();
  };

  return (
    <SidebarLayout context="settings" sidebar={sidebarContent} hasBorder={false} mobilePane={mobilePane}>
      <main className="qt-nav-scroll flex-1 overflow-y-auto custom-scrollbar bg-canvas relative">
        <div className="max-w-[760px] mx-auto px-[16px] py-[24px] md:px-[32px] md:py-[48px] min-h-full flex flex-col">
          <div className="flex-1 pb-[100px]">
            <SectionBackContext.Provider value={mobileBack}>
              {renderSection()}
            </SectionBackContext.Provider>
          </div>
        </div>
      </main>
    </SidebarLayout>
  );
}
