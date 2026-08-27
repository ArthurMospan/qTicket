'use client';
// src/components/workspace/BillingTab.jsx
// Invoice calculator: form/tasks on the left, always-visible summary rail on
// the right. Chrome matches the rest of the analytics tabs (no dark shell).
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useProjectAllTimeLogs } from '@/lib/hooks/useProjectAllTimeLogs';
import { useAppContext } from '@/lib/context/AppContext';
import { db } from '@/lib/firebase';
import {
  collection, query, where, onSnapshot,
} from 'firebase/firestore';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { AlertTriangle, Ban, ChevronRight, Eye, FileText, Printer, Clock, Save, Send } from 'lucide-react';
import { CalendarIcon } from '@/lib/design/icons';
import { Select } from '@/components/ui/Select';
import {
  Button, Surface, LoadingSpinner, Input, Textarea, Tabs, Checkbox,
  Dialog, Card, Alert, EmptyState, Label, Pill, PriorityBadge, Segmented, TypeBadge,
  useConfirm,
} from '@/components/ui';
import { printHtmlDocument } from '@/lib/utils/exportFile';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { buildCalendarBillingItems } from '@/lib/utils/calendarBillingItems.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { statusLabel } from '@/lib/utils/workflowDefaults.mjs';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';
import {
  aggregateIssueTimeLogs,
  calculateBillingAutoPrice,
  collectReservedInvoiceTimeLogIds,
  collectSourceTimeLogIds,
  findInvoiceTimeLogOverlap,
  isValidRawTimeLogMinutes,
  selectIncrementalBillableIssues,
} from '@/lib/utils/issueAccounting.mjs';
import {
  createInvoiceViaApi,
  voidInvoiceViaApi,
} from '@/lib/services/invoices';
import { fetchWorkflowViaApi } from '@/lib/services/workflow';
import {
  convertBillingMemberRates,
  emptyBillingMemberState,
  reconcileBillingMemberState,
  setBillingMemberPreset,
  setBillingMemberRate,
} from '@/lib/utils/billingProjectState.mjs';
import { plural } from '@/lib/utils/plural.mjs';

// ── Defaults ─────────────────────────────────────────────────────────

const CURRENCIES = ['USD', 'EUR', 'UAH', 'GBP', 'PLN'];
const EMPTY_INVOICES = Object.freeze([]);
const EMPTY_MEMBER_VALUES = Object.freeze({});

// ── Helpers ───────────────────────────────────────────────────────────

function fmtMin(min) {
  if (!min) return '0г';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}г ${m}хв` : `${h}г`) : `${m}хв`;
}
function fmtMoney(amount, currency) {
  if (typeof amount !== 'number') return '—';
  return new Intl.NumberFormat('uk-UA', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}
// Друкований аркуш складається з рядка, а в назві задачі може бути «<» —
// тому кожне значення, що потрапляє в HTML, проходить тут.
const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function fmtDate(d = new Date()) {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

// ── Field Component matching TaskDetailPanel ──────────────────────────

function Field({ label, children }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

// ── Rate row component ────────────────────────────────────────────────

function RateRow({ uid, member, rate, onRateChange, preset, onPresetChange, currency, positions = [] }) {
  const memberName = member?.name || member?.email || uid;
  const rateInputId = `billing-rate-${uid}`;

  return (
    // The same white-card-on-grey the billable items use. These rows were flat
    // on the panel's own grey with a near-invisible hairline between them, so
    // three people read as one block of text.
    <div
      data-ui-surface="billing-item"
      data-ui-padding="wide"
      className="ui-surface grid gap-3 sm:grid-cols-[minmax(180px,1fr)_minmax(170px,0.9fr)_150px] sm:items-end"
    >
      <div className="flex min-w-0 items-center gap-3 sm:pb-1">
        <UserAvatar user={member} size="md" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-ink">{memberName}</p>
          {member?.email && member.email !== memberName ? (
            <p className="mt-0.5 truncate text-[11px] text-muted">{member.email}</p>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-[6px]">
        <Label>Посада</Label>
        <Select
          value={preset || member?.positionId || ''}
          onChange={val => {
            const p = positions.find(r => r.id === val);
            onPresetChange(val);
            if (p) onRateChange(p.hourlyRate);
          }}
          options={[
            { value: '', label: 'Посада...' },
            ...positions.map(p => ({ value: p.id, label: p.label }))
          ]}
          placeholder="Посада..."
          size="md"
          className="w-full"
          dropdownClassName="min-w-[220px]"
          ariaLabel={`Посада: ${memberName}`}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-[6px]">
        <Label htmlFor={rateInputId}>Ставка</Label>
        <div className="relative">
          <Input
            id={rateInputId}
            size="md"
            type="number"
            min={0}
            value={rate}
            onChange={e => onRateChange(Number(e.target.value))}
            preset="money"
            suffix={`${currency}/г`}
          />
        </div>
      </div>
    </div>
  );
}

// ── Billable row component ───────────────────────────────────────────

function IssueRow({
  issue,
  checked,
  onCheck,
  timeLogs,
  rates,
  members,
  manualPrice,
  onManualPrice,
  currency,
  useManual,
  onUseManual,
  statusLabel: issueStatusLabel,
  typeMeta,
  priorities,
  billingConflictCount = 0,
}) {
  const issueLogs = useMemo(
    () => timeLogs[issue.id] || { totalMinutes: 0, byUser: {} },
    [timeLogs, issue.id],
  );

  // Auto price: sum per-user (minutes/60 * rate). Tracked time is the only
  // thing that prices itself; work nobody tracked gets a hand-typed sum.
  const autoPrice = useMemo(
    () => calculateBillingAutoPrice({ logSummary: issueLogs, rates }),
    [issueLogs, rates],
  );

  const price = useManual ? (manualPrice ?? 0) : autoPrice;
  const type = issue.type || 'task';
  const isEvent = type === 'calendar_event';
  const contributorIds = Object.keys(issueLogs.byUser).length > 0
    ? Object.keys(issueLogs.byUser)
    : issue.assigneeIds || [];
  const contributors = contributorIds
    .map(uid => members.find(member => (member.id || member.uid) === uid))
    .filter(Boolean);
  // An estimate is deliberately not shown here. It used to be, and a row that
  // reads «Оцінка 20 год» next to a sum of zero is a row nobody can act on.
  //
  // Порожньо — значить порожньо. «Без зафіксованого часу — ціна вручну» стояло
  // під кожним другим рядком і не повідомляло нічого: перемикач «Авто / Вручну»
  // праворуч у тому ж рядку вже показує, звідки береться сума, а годинник із
  // запереченням поруч із ним — це підпис до порожнього місця. Рядок каже, коли
  // час є; коли його немає, він мовчить.
  const effortLabel = issueLogs.totalMinutes > 0
    ? `Зафіксовано ${fmtMin(issueLogs.totalMinutes)}`
    : '';
  const contributorSummary = Object.entries(issueLogs.byUser)
    .map(([uid, minutes]) => {
      const member = members.find(candidate => (candidate.id || candidate.uid) === uid);
      const cost = rates[uid] ? ` · ${fmtMoney((minutes / 60) * rates[uid], currency)}` : '';
      return `${member?.name || uid.slice(0, 6)} ${fmtMin(minutes)}${cost}`;
    })
    .join(' · ');

  return (
    <div
      data-ui-surface="billing-item"
      data-ui-padding="compact-row"
      data-ui-muted={!checked}
      onClick={onCheck}
      // The whole row toggles the line item, so it answers the keyboard too.
      // Not a `<button>`: the checkbox it drives is inside it, and a control
      // cannot contain another control.
      role="button"
      tabIndex={0}
      aria-pressed={checked}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onCheck();
      }}
      className="ui-surface grid cursor-pointer select-none gap-3 transition-all md:grid-cols-[auto_minmax(240px,1fr)_minmax(210px,0.85fr)_190px] md:items-center"
    >
      <div className="shrink-0 md:self-center" onClick={event => event.stopPropagation()}>
        <Checkbox checked={checked} onChange={onCheck} />
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] font-bold tracking-wide text-faint">
            {issue.issueKey || (isEvent ? 'ПОДІЯ' : 'ЗАВДАННЯ')}
          </span>
          <TypeBadge
            label={isEvent ? 'Подія' : (typeMeta?.[type]?.label || type)}
            color={typeMeta?.[type]?.color || '#059669'}
            icon={isEvent ? CalendarIcon : taskTypeIcon(typeMeta?.[type] || type)}
          />
          {!isEvent && <PriorityBadge priority={issue.priority} priorities={priorities} />}
          {issueStatusLabel ? (
            <Pill tone="neutral" size="sm" shape="badge">{issueStatusLabel}</Pill>
          ) : null}
          {billingConflictCount > 0 ? (
            <Pill tone="warning" size="sm" shape="badge">
              Уже в рахунку · {billingConflictCount}
            </Pill>
          ) : null}
        </div>
        <h4 className="ui-type-card-title truncate leading-[1.35] text-ink">
          {issue.title}
        </h4>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {effortLabel && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-muted">
              <Clock size={12} />
              {effortLabel}
            </span>
          )}
          {contributors.length > 0 ? (
            <div className="flex -space-x-1.5">
              {contributors.slice(0, 3).map(member => (
                <UserAvatar
                  key={member.id || member.uid}
                  user={member}
                  size="xs"
                  stacked
                />
              ))}
              {contributors.length > 3 ? (
                <Pill
                  tone="neutral"
                  size="md"
                  preset="avatar-counter-xs"
                >
                  +{contributors.length - 3}
                </Pill>
              ) : null}
            </div>
          ) : null}
        </div>
        {contributorSummary ? (
          <p className="mt-1 truncate text-[10px] text-faint" title={contributorSummary}>
            {contributorSummary}
          </p>
        ) : null}
      </div>

      {/* Both price states occupy the same 104px slot. Letting the auto label
          and the manual input size themselves shifted the Авто/Вручну switch
          horizontally row by row, so a column of rows never lined up. */}
      <div
        className="flex min-w-0 items-center justify-between gap-2 md:justify-end"
        onClick={event => event.stopPropagation()}
      >
        <Segmented
          value={useManual ? 'manual' : 'auto'}
          onChange={value => {
            if ((value === 'manual') !== useManual) onUseManual();
          }}
          options={[
            { value: 'auto', label: 'Авто' },
            { value: 'manual', label: 'Вручну' },
          ]}
          surface="canvas"
        />
        <div className="relative h-[32px] w-[104px] shrink-0">
          {useManual ? (
            <>
              <Input
                type="number"
                size="md"
                min={0}
                step="0.01"
                value={manualPrice ?? ''}
                onChange={event => onManualPrice(event.target.value === '' ? null : Number(event.target.value))}
                placeholder="0.00"
                preset="money"
                suffix={currency}
                aria-label={`Ручна вартість: ${issue.title}`}
              />
            </>
          ) : (
            <span className={`flex h-full items-center justify-end text-right text-[13px] font-bold tabular-nums ${price > 0 ? 'text-ink' : 'text-faint'}`}>
              {price > 0 ? fmtMoney(price, currency) : '—'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Invoice Preview Component ─────────────────────────────────────────

function InvoicePreview({
  invoice,
  project,
  isSaved = false,
  onClose,
  onPrintBlocked,
  onVoid,
  voiding = false,
}) {
  const printRef = useRef(null);
  const invoiceItems = Array.isArray(invoice?.items) ? invoice.items : [];
  const officialNumber = typeof invoice?.number === 'string'
    ? invoice.number.trim()
    : '';
  const projectLabel = project?.name || invoice?.projectId || '—';
  const canExport = isSaved && officialNumber.length > 0;
  const canVoid = Boolean(onVoid) && isSaved && invoice?.status === 'draft';
  const dialogTitle = !isSaved
    ? 'Попередній перегляд чернетки'
    : canExport
      ? `Рахунок ${officialNumber}`
      : 'Перегляд збереженого рахунку';

  const handlePrint = () => {
    if (!canExport) return;
    // Друкований аркуш будується з тих самих даних, що й екранний.
    //
    // Раніше сюди віддавали `innerHTML` попереднього перегляду, а поруч
    // клали таблицю стилів, написану під зовсім іншу розмітку: селектори
    // `.meta`, `.badge`, `.grand` у документі не зустрічались жодного разу, а
    // все, що його справді малює, — це утиліти Tailwind, яких у вікні друку
    // немає. Плюс усередині живуть дві версії списку позицій — картки для
    // телефона й таблиця для екрана, — і без `hidden`/`sm:` друкувались обидві.
    // Звідси й «піздець»: подвоєний зміст без жодного оформлення.
    //
    // Тому аркуш складається тут, із рахунку, і кожен його клас має правило.
    const money = value => escapeHtml(fmtMoney(value, invoice.currency));
    const rows = invoiceItems.map(item => `
      <tr>
        <td>
          <p class="item-title">${escapeHtml(item.title || '')}</p>
          <p class="item-meta">${escapeHtml([item.key, item.status].filter(Boolean).join(' · '))}</p>
        </td>
        <td class="num">${item.minutes > 0 ? escapeHtml(fmtMin(item.minutes)) : '—'}</td>
        <td class="sum">${money(item.price)}</td>
      </tr>`).join('');
    const totalRow = (label, value, modifier = '') => `
      <div class="total-line${modifier}"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;
    const printed = printHtmlDocument(`
      <!DOCTYPE html>
      <html lang="uk">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(officialNumber)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: Inter, -apple-system, "Segoe UI", sans-serif;
            color: #1f1f1f; background: #fff;
            padding: 48px; max-width: 760px; margin: 0 auto;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 32px; }
          h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
          .number { margin-top: 6px; font-size: 14px; font-weight: 600; color: #9a9a9a; }
          .void { display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 999px; background: #f4f4f5; font-size: 10px; font-weight: 700; color: #6b6b6b; }
          .issued { text-align: right; }
          .issued span { display: block; font-size: 12px; color: #9a9a9a; }
          .issued strong { font-size: 15px; font-weight: 700; }
          .parties { display: flex; gap: 32px; margin-bottom: 28px; }
          .parties > div { flex: 1; }
          .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #9a9a9a; margin-bottom: 4px; }
          .party-name { font-size: 13px; font-weight: 600; }
          .party-details { margin-top: 4px; font-size: 12px; color: #6b6b6b; white-space: pre-line; }
          .project { background: #f4f4f5; border-radius: 10px; padding: 12px 16px; margin-bottom: 24px; }
          .project p { font-size: 13px; font-weight: 600; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; }
          th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #9a9a9a; padding-bottom: 8px; border-bottom: 2px solid #1f1f1f; text-align: left; }
          th.num, th.sum { text-align: right; }
          td { padding: 12px 0; border-bottom: 1px solid #e9e9e9; vertical-align: top; }
          td.num, td.sum { text-align: right; white-space: nowrap; }
          .item-title { font-size: 13px; font-weight: 500; }
          .item-meta { margin-top: 2px; font-size: 10px; color: #9a9a9a; }
          td.num { font-size: 12px; color: #6b6b6b; }
          td.sum { font-size: 13px; font-weight: 600; }
          .totals { margin-top: 18px; margin-left: auto; width: 260px; }
          .total-line { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; }
          .total-line span:first-child { color: #6b6b6b; font-size: 12px; }
          .total-line.grand { margin-top: 8px; padding-top: 10px; border-top: 1px solid #1f1f1f; }
          .total-line.grand span:first-child { color: #1f1f1f; font-size: 13px; font-weight: 700; }
          .total-line.grand span:last-child { font-size: 18px; font-weight: 800; }
          .notes { margin-top: 32px; border-top: 1px solid #e9e9e9; padding-top: 16px; font-size: 12px; color: #6b6b6b; white-space: pre-line; }
          @media print { body { padding: 24px; } }
        </style>
      </head>
      <body>
        <div class="head">
          <div>
            <h1>РАХУНОК</h1>
            <p class="number">${escapeHtml(officialNumber)}</p>
            ${invoice.status === 'void' ? '<span class="void">Анульовано</span>' : ''}
          </div>
          <div class="issued">
            <span>Дата виставлення</span>
            <strong>${escapeHtml(invoice.date || '')}</strong>
          </div>
        </div>

        <div class="parties">
          <div>
            <p class="label">Від</p>
            <p class="party-name">${escapeHtml(invoice.fromName || 'Ваша агенція')}</p>
            ${invoice.fromDetails ? `<p class="party-details">${escapeHtml(invoice.fromDetails)}</p>` : ''}
          </div>
          <div>
            <p class="label">Кому</p>
            <p class="party-name">${escapeHtml(invoice.clientName || '—')}</p>
            ${invoice.clientDetails ? `<p class="party-details">${escapeHtml(invoice.clientDetails)}</p>` : ''}
          </div>
        </div>

        <div class="project">
          <p class="label">Проєкт</p>
          <p>${escapeHtml(projectLabel)}</p>
        </div>

        <table>
          <thead>
            <tr><th>Послуга</th><th class="num">Час</th><th class="sum">Сума</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="totals">
          ${totalRow('Підсумок', money(invoice.subtotal))}
          ${invoice.discount > 0 ? totalRow(`Знижка (${invoice.discountPct}%)`, `−${money(invoice.discount)}`) : ''}
          ${invoice.tax > 0 ? totalRow(`ПДВ (${invoice.taxPct}%)`, `+${money(invoice.tax)}`) : ''}
          ${totalRow('До оплати', money(invoice.total), ' grand')}
        </div>

        ${invoice.notes ? `<div class="notes">${escapeHtml(invoice.notes)}</div>` : ''}
      </body>
      </html>
    `);
    // A popup blocker returns no window at all, and the old code dereferenced
    // it straight away — the button simply appeared to do nothing.
    if (!printed) onPrintBlocked?.();
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={dialogTitle}
      // Збережений рахунок — це документ, а не картка. У вузькому діалозі
      // сторінка, яку зараз надрукують, читалася смужкою; чернетка лишається
      // вузькою, бо це ще не документ, а перевірка складу.
      size={isSaved ? 'lg' : 'md'}
      footer={
        canExport ? (
          <>
            {/* «Надіслати в OneB Invoice» стоїть тут вимкненим навмисно: це
                контракт між двома застосунками, якого ще немає, і кнопка, що
                зникає до релізу, — це фіча, про яку ніхто не дізнається. */}
            <Button style="ghost" size="md" icon={Send} disabled title="Інтеграція в розробці">
              OneB Invoice · в розробці
            </Button>
            {/* Анулювання живе тут, біля самого рахунку, а не іконкою в
                списку. Це рішення про конкретний документ, і ухвалюють його,
                подивившись на нього, — а не проходячи повз рядок. */}
            {canVoid && (
              <Button
                onClick={onVoid}
                style="ghost"
                color="red"
                size="md"
                icon={Ban}
                loading={voiding}
              >
                Анулювати
              </Button>
            )}
            {/* Копіювання й експорт звідси прибрані: копія віддавала рахунок
                простим текстом без жодного оформлення, а таблиця в XLSX — це
                не рахунок, це його вміст. Документ віддає друк, і з нього ж
                браузер зберігає PDF. */}
            <Button onClick={handlePrint} style="primary" size="md" icon={Printer}>Друкувати</Button>
          </>
        ) : (
          <Button onClick={onClose} style="secondary" size="md">Закрити</Button>
        )
      }
    >
          {!isSaved && (
            <Alert
              variant="info"
              title="Незбережена чернетка"
              description="Офіційний номер рахунку з’явиться після збереження. Друк і копіювання доступні лише для збереженого рахунку."
              className="mb-4"
            />
          )}
          {isSaved && !canExport && (
            <Alert
              variant="warning"
              title="Збережений рахунок не має номера"
              description="Це застарілий або пошкоджений запис. Його можна переглянути, але не друкувати чи копіювати як офіційний рахунок."
              className="mb-4"
            />
          )}
          <div ref={printRef} className="px-2 py-3 max-w-[640px] mx-auto">
            <div className="mb-8 flex flex-col items-start justify-between gap-3 sm:flex-row">
              <div>
                <h1 className="ui-type-metric-title text-ink tracking-tight">РАХУНОК</h1>
                <div className="mt-1 flex items-center gap-2">
                  {canExport ? (
                    <p className="text-[14px] font-semibold text-muted">{officialNumber}</p>
                  ) : (
                    <Pill tone="neutral" size="sm">Номер після збереження</Pill>
                  )}
                  {invoice.status === 'void' && <Pill tone="neutral" size="sm">Анульовано</Pill>}
                </div>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-[12px] text-muted">Дата виставлення</p>
                <p className="text-[15px] font-bold text-ink">{invoice.date}</p>
              </div>
            </div>

            <div className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-8">
              <div>
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Від</p>
                <p className="text-[13px] font-semibold text-ink">{invoice.fromName || 'Ваша агенція'}</p>
                {invoice.fromDetails && <p className="text-[12px] text-muted mt-1 whitespace-pre-line">{invoice.fromDetails}</p>}
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Кому</p>
                <p className="text-[13px] font-semibold text-ink">{invoice.clientName || '—'}</p>
                {invoice.clientDetails && <p className="text-[12px] text-muted mt-1 whitespace-pre-line">{invoice.clientDetails}</p>}
              </div>
            </div>

            <div data-ui-surface="local" className="bg-canvas rounded-[10px] px-4 py-3 mb-6">
              <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Проєкт</p>
              <p className="text-[13px] font-semibold text-ink mt-[2px]">{projectLabel}</p>
            </div>

            <div className="mb-2 space-y-2 sm:hidden">
              {invoiceItems.map((item, index) => (
                <Card key={item.itemId || item.issueId || item.key || index} preset="bordered-compact" padding="sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-ink">{item.title}</p>
                      <p className="mt-0.5 text-[10px] text-muted">{item.key} · {item.status}</p>
                    </div>
                    <p className="shrink-0 text-[12px] font-bold text-ink">{fmtMoney(item.price, invoice.currency)}</p>
                  </div>
                  <p className="mt-2 text-[10px] font-medium text-muted">Час: {item.minutes > 0 ? fmtMin(item.minutes) : '—'}</p>
                </Card>
              ))}
            </div>

            <table className="mb-2 hidden w-full sm:table" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-bold text-muted uppercase tracking-wider pb-2 border-b-2 border-ink">Послуга</th>
                  <th className="text-center text-[10px] font-bold text-muted uppercase tracking-wider pb-2 border-b-2 border-ink w-[90px]">Час</th>
                  <th className="text-right text-[10px] font-bold text-muted uppercase tracking-wider pb-2 border-b-2 border-ink w-[100px]">Сума</th>
                </tr>
              </thead>
              <tbody>
                {invoiceItems.map((item, index) => (
                  <tr key={item.itemId || item.issueId || item.key || index}>
                    <td className="py-3 border-b border-line">
                      <p className="text-[13px] font-medium text-ink">{item.title}</p>
                      <p className="text-[10px] text-muted">{item.key} · {item.status}</p>
                    </td>
                    <td className="py-3 border-b border-line text-center text-[12px] text-muted">
                      {item.minutes > 0 ? fmtMin(item.minutes) : '—'}
                    </td>
                    <td className="py-3 border-b border-line text-right text-[13px] font-semibold text-ink">
                      {fmtMoney(item.price, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex flex-col items-stretch gap-1 sm:items-end">
              <div className="flex w-full justify-between sm:w-[240px]">
                <span className="text-[12px] text-muted">Підсумок</span>
                <span className="text-[13px] font-medium text-ink">{fmtMoney(invoice.subtotal, invoice.currency)}</span>
              </div>
              {invoice.discount > 0 && (
                <div className="flex w-full justify-between sm:w-[240px]">
                  <span className="text-[12px] text-muted">Знижка ({invoice.discountPct}%)</span>
                  <span className="text-[13px] font-medium text-success">−{fmtMoney(invoice.discount, invoice.currency)}</span>
                </div>
              )}
              {invoice.tax > 0 && (
                <div className="flex w-full justify-between sm:w-[240px]">
                  <span className="text-[12px] text-muted">ПДВ ({invoice.taxPct}%)</span>
                  <span className="text-[13px] font-medium text-ink">+{fmtMoney(invoice.tax, invoice.currency)}</span>
                </div>
              )}
              <div className="mt-1 flex w-full justify-between border-t border-ink pt-2 sm:w-[240px]">
                <span className="text-[13px] font-bold text-ink">До оплати</span>
                <span className="text-[18px] font-black text-ink">{fmtMoney(invoice.total, invoice.currency)}</span>
              </div>
            </div>

            {invoice.notes && (
              <div className="mt-8 pt-6 border-t border-line">
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Примітки</p>
                <p className="text-[12px] text-ink whitespace-pre-line">{invoice.notes}</p>
              </div>
            )}
          </div>
    </Dialog>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────

export default function BillingTab({ issues = [], events = [], members = [], project, projectId }) {
  const { activeOrgId } = useAppContext();
  const billingProjectKey = `${activeOrgId || ''}:${projectId || ''}`;
  const showToast = useWorkspaceStore(state => state.showToast);
  const confirmDialog = useConfirm();
  const {
    logs,
    loading: logsLoading,
    error: logsError,
    refresh: refreshLogs,
  } = useProjectAllTimeLogs(projectId);
  const { statuses, deliveredStatusIds, types = [], priorities = [] } = useWorkflowConfig();
  const [savedInvoiceState, setSavedInvoiceState] = useState({
    projectKey: '',
    invoices: [],
  });
  const savedInvoices = savedInvoiceState.projectKey === billingProjectKey
    ? savedInvoiceState.invoices
    : EMPTY_INVOICES;
  const typeMeta = useMemo(
    () => Object.fromEntries(types.map(type => [type.id, type])),
    [types],
  );
  // Status labels come from the live workflow config, falling back to the
  // shared defaults rather than a local copy of the same map.
  const statusLabelOf = (id) => id === 'calendar_event' ? 'Подія' : statusLabel(id, statuses);

  const reservedTimeLogIds = useMemo(
    () => collectReservedInvoiceTimeLogIds(savedInvoices),
    [savedInvoices],
  );
  const billableLogs = useMemo(
    () => logs.filter(log => (
      !log.invoiceId
      && !log.billedAt
      && (!log.id || !reservedTimeLogIds.has(log.id))
    )),
    [logs, reservedTimeLogIds],
  );
  const allIssueTimeLogs = useMemo(
    () => aggregateIssueTimeLogs(logs),
    [logs],
  );
  const invalidTimeLogCount = useMemo(
    () => logs.filter(log => !isValidRawTimeLogMinutes(log.spentMinutes)).length,
    [logs],
  );
  const invalidTimeLogIssueIds = useMemo(
    () => new Set(logs.flatMap(log => (
      !isValidRawTimeLogMinutes(log.spentMinutes) && log.issueId
        ? [log.issueId]
        : []
    ))),
    [logs],
  );
  const issueTimeLogs = useMemo(
    () => aggregateIssueTimeLogs(billableLogs),
    [billableLogs],
  );
  const { billableEvents, timeLogsByItem } = useMemo(() => {
    return buildCalendarBillingItems({
      byIssue: issueTimeLogs,
      events,
      logs: billableLogs,
      projectId,
    });
  }, [billableLogs, events, issueTimeLogs, projectId]);
  const billableIssues = useMemo(
    () => selectIncrementalBillableIssues(
      issues,
      timeLogsByItem,
      allIssueTimeLogs,
    ).filter(issue => !invalidTimeLogIssueIds.has(issue.id)),
    [
      allIssueTimeLogs,
      invalidTimeLogIssueIds,
      issues,
      timeLogsByItem,
    ],
  );
  const billingItems = useMemo(
    () => [...billableIssues, ...billableEvents],
    [billableEvents, billableIssues],
  );
  const billingItemsById = useMemo(
    () => new Map(billingItems.map(item => [item.id, item])),
    [billingItems],
  );
  const billingItemIds = useMemo(
    () => billingItems.map(item => item.id).join(','),
    [billingItems],
  );

  // ── Rate settings per member
  const [memberRateState, setMemberRateState] = useState(
    () => emptyBillingMemberState(),
  );
  const memberRates = memberRateState.projectKey === billingProjectKey
    ? memberRateState.rates
    : EMPTY_MEMBER_VALUES;
  const memberPresets = memberRateState.projectKey === billingProjectKey
    ? memberRateState.presets
    : EMPTY_MEMBER_VALUES;

  // ── Issue selection
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [manualPrices, setManualPrices] = useState({}); // { issueId: number|null }
  const [useManualMap, setUseManualMap] = useState({}); // { issueId: bool }

  // ── Invoice meta
  const [currency, setCurrency] = useState('USD');
  // The currency the amounts on screen were actually typed in. It only differs
  // from `currency` between choosing a new one and deciding what to do about the
  // figures, which is the gap where an invoice used to silently change value.
  const [amountsCurrency, setAmountsCurrency] = useState('USD');
  const [conversionRate, setConversionRate] = useState('');
  const [discountPct, setDiscountPct] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const [clientName, setClientName] = useState('');
  const [clientDetails, setClientDetails] = useState('');
  const [fromName, setFromName] = useState('');
  const [fromDetails, setFromDetails] = useState('');
  const [notes, setNotes] = useState('');

  // ── UI state
  const [tab, setTab] = useState('details'); // 'details' | 'issues' | 'history'
  const [invoicePreviewState, setInvoicePreviewState] = useState(null);
  const invoicePreview = invoicePreviewState?.projectKey === billingProjectKey
    ? invoicePreviewState
    : null;
  const [saving, setSaving] = useState(false);
  const [voidingInvoiceId, setVoidingInvoiceId] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [positions, setPositions] = useState([]);
  const selectionProjectRef = useRef('');
  const invoiceOverlap = useMemo(
    () => findInvoiceTimeLogOverlap(billingItems, timeLogsByItem, savedInvoices),
    [billingItems, savedInvoices, timeLogsByItem],
  );
  const conflictingItemIds = useMemo(
    () => new Set(invoiceOverlap.itemIds),
    [invoiceOverlap.itemIds],
  );
  const safeBillingItemIds = useMemo(
    () => billingItems
      .filter(item => !conflictingItemIds.has(item.id))
      .map(item => item.id),
    [billingItems, conflictingItemIds],
  );
  const safeBillingItemIdsKey = safeBillingItemIds.join(',');

  // Load positions
  useEffect(() => {
    if (!activeOrgId) return;
    let cancelled = false;
    fetchWorkflowViaApi(activeOrgId).then(workflow => {
      if (!cancelled && Array.isArray(workflow?.positions)) {
        setPositions(workflow.positions);
      }
    }).catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [activeOrgId]);

  // Collect unique member uids from tasks and calendar events.
  const billingMembers = useMemo(() => {
    const uids = new Set();
    billingItems.forEach(iss => {
      (iss.assigneeIds || []).forEach(uid => uids.add(uid));
    });
    Object.values(timeLogsByItem).forEach(data => {
      Object.keys(data.byUser).forEach(uid => uids.add(uid));
    });
    return [...uids].map(uid => members.find(m => (m.id || m.uid) === uid) || { id: uid, uid, name: uid.slice(0, 8) });
  }, [billingItems, members, timeLogsByItem]);

  // Select all when a project is opened; keep manual choices while its data refreshes.
  useEffect(() => {
    if (logsLoading) return;
    if (selectionProjectRef.current !== projectId) {
      selectionProjectRef.current = projectId || '';
      queueMicrotask(() => setCheckedIds(new Set(safeBillingItemIds)));
      return;
    }
    const availableIds = new Set(safeBillingItemIds);
    queueMicrotask(() => setCheckedIds(previous => (
      new Set([...previous].filter(id => availableIds.has(id)))
    )));
  }, [
    billingItemIds,
    logsLoading,
    projectId,
    safeBillingItemIds,
    safeBillingItemIdsKey,
  ]);

  // Keep rate edits scoped to one project. A project switch resets immediately;
  // later member/log refreshes only fill or refresh untouched members.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setMemberRateState(previous => {
        if (previous.projectKey !== billingProjectKey) {
          return emptyBillingMemberState(billingProjectKey);
        }
        if (logsLoading) return previous;
        return reconcileBillingMemberState({
          state: previous,
          projectKey: billingProjectKey,
          members: billingMembers,
          positions,
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [billingMembers, billingProjectKey, logsLoading, positions]);

  // ── Currency of the figures vs currency of the invoice ──
  const hasEnteredAmounts = useMemo(
    () => Object.values(memberRates).some(rate => Number(rate) > 0)
      || Object.values(manualPrices).some(price => Number(price) > 0),
    [manualPrices, memberRates],
  );
  const changeCurrency = next => {
    setCurrency(next);
    setConversionRate('');
    // Nothing entered yet means nothing to convert: the figures will simply be
    // typed in the new currency, so there is no question to ask.
    if (!hasEnteredAmounts) setAmountsCurrency(next);
  };

  const currencyChanged = currency !== amountsCurrency && hasEnteredAmounts;
  const parsedConversionRate = useMemo(() => {
    const value = Number(conversionRate);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [conversionRate]);

  const applyConversion = () => {
    if (!parsedConversionRate) return;
    setMemberRateState(previous => convertBillingMemberRates(previous, {
      projectKey: billingProjectKey,
      factor: parsedConversionRate,
    }));
    setManualPrices(previous => Object.fromEntries(
      Object.entries(previous).map(([id, price]) => {
        const value = Number(price);
        return [
          id,
          Number.isFinite(value) && value !== 0
            ? Math.round(value * parsedConversionRate * 100) / 100
            : price,
        ];
      }),
    ));
    setAmountsCurrency(currency);
    setConversionRate('');
  };

  const keepAmountsAsIs = () => {
    setAmountsCurrency(currency);
    setConversionRate('');
  };

  // Load saved invoices
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSavedInvoiceState(previous => (
        previous.projectKey === billingProjectKey
          ? previous
          : { projectKey: billingProjectKey, invoices: [] }
      ));
      setInvoicePreviewState(previous => (
        previous?.projectKey === billingProjectKey ? previous : null
      ));
    });
    if (!projectId || !activeOrgId) {
      return () => {
        active = false;
      };
    }
    const q = query(
      collection(db, 'invoices'),
      where('projectId', '==', projectId),
      where('organizationId', '==', activeOrgId),
    );
    const unsub = onSnapshot(q, snap => {
      if (!active) return;
      const docs = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      docs.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setSavedInvoiceState({
        projectKey: billingProjectKey,
        invoices: docs,
      });
    });
    return () => {
      active = false;
      unsub();
    };
  }, [activeOrgId, billingProjectKey, projectId]);

  // ── Filtered billable positions ──
  const filteredItems = useMemo(() => {
    return billingItems.filter(iss => {
      if (
        filterStatus !== 'all'
        && (iss.columnId || iss.status) !== filterStatus
      ) {
        return false;
      }
      if (
        filterType !== 'all'
        && (iss.type || 'task') !== filterType
      ) {
        return false;
      }
      return true;
    });
  }, [billingItems, filterStatus, filterType]);

  // ── Compute per-issue price ──
  const computePrice = useCallback((issue) => {
    if (useManualMap[issue.id]) return manualPrices[issue.id] ?? 0;
    return calculateBillingAutoPrice({
      logSummary: timeLogsByItem[issue.id],
      rates: memberRates,
    });
  }, [
    manualPrices,
    memberRates,
    timeLogsByItem,
    useManualMap,
  ]);

  // ── Summary ──
  const { subtotal, discount, tax, total } = useMemo(() => {
    let sub = 0;
    [...checkedIds].forEach(id => {
      const iss = billingItemsById.get(id);
      if (iss) sub += computePrice(iss);
    });
    const disc = sub * (discountPct / 100);
    const taxAmt = (sub - disc) * (taxPct / 100);
    return { subtotal: sub, discount: disc, tax: taxAmt, total: sub - disc + taxAmt };
  }, [billingItemsById, checkedIds, computePrice, discountPct, taxPct]);

  // ── Build invoice object ──
  const buildInvoice = () => {
    const selectedItems = [...checkedIds]
      .map(id => billingItemsById.get(id))
      .filter(Boolean);
    const invoiceItems = selectedItems.map(iss => {
      const logSummary = timeLogsByItem[iss.id] || {
        totalMinutes: 0,
        byUser: {},
        logIds: [],
      };
      const hasActualTime = logSummary.totalMinutes > 0;
      return {
        itemId: iss.id,
        issueId: iss.type === 'calendar_event' ? null : iss.id,
        key: iss.issueKey,
        title: iss.title,
        status: statusLabelOf(iss.columnId || iss.status),
        minutes: hasActualTime ? logSummary.totalMinutes : 0,
        price: computePrice(iss),
        sourceKind: useManualMap[iss.id]
          ? 'manual'
          : hasActualTime
            ? 'actual'
            : 'none',
        sourceTimeLogIds: [...(logSummary.logIds || [])],
      };
    });

    return {
      date: fmtDate(),
      currency,
      clientName, clientDetails,
      fromName, fromDetails,
      notes,
      discountPct, taxPct,
      discount, tax, subtotal, total,
      items: invoiceItems,
      sourceTimeLogIds: collectSourceTimeLogIds(selectedItems, timeLogsByItem),
    };
  };

  // ── Save invoice ──
  const saveInvoice = async () => {
    if (!checkedIds.size) return;
    const selectedItems = billingItems.filter(item => checkedIds.has(item.id));
    const selectedOverlap = findInvoiceTimeLogOverlap(
      selectedItems,
      timeLogsByItem,
      savedInvoices,
    );
    if (selectedOverlap.itemIds.length > 0) {
      setTab('issues');
      showToast(
        'Частина вибраних позицій або зафіксованого часу вже входить в інший рахунок. Зніміть позиції з попередженням.',
        'error',
      );
      return;
    }
    setSaving(true);
    try {
      const inv = buildInvoice();
      const created = await createInvoiceViaApi({
        invoice: inv,
        projectId,
        organizationId: activeOrgId,
      });
      showToast(`Рахунок ${created.number} створено — він у «Історії»`);
    } catch (err) {
      console.error(err);
      if ([
        'INVOICE_TIME_LOG_CONFLICT',
        'INVOICE_TIME_CHANGED',
        'INVOICE_ITEM_CONFLICT',
        'INVOICE_SOURCE_CONFLICT',
        'INVOICE_LEGACY_AMBIGUITY',
        'INVOICE_ISSUE_INVALID',
        'INVOICE_SUMMARY_ESTIMATE_CONFLICT',
        'INVOICE_ESTIMATE_HAS_ACTUAL_TIME',
        'INVOICE_ESTIMATE_CHANGED',
      ].includes(err?.code)) {
        setTab('issues');
        showToast(
          err?.message || 'Частина позицій більше недоступна для рахунку. Оновіть вибір.',
          'error',
        );
      } else {
        showToast(err?.message || 'Не вдалося зберегти рахунок', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const voidInvoice = async invoice => {
    if (!(await confirmDialog({
      title: 'Анулювати рахунок?',
      message: 'Рахунок залишиться у списку як анульований, а його записи часу та позиції знову стануть доступними.',
      confirmText: 'Анулювати',
      danger: true,
    }))) return;
    setVoidingInvoiceId(invoice.id);
    try {
      await voidInvoiceViaApi(invoice.id);
      showToast(`Рахунок ${invoice.number} анульовано`);
    } catch (error) {
      showToast(error?.message || 'Не вдалося анулювати рахунок', 'error');
    } finally {
      setVoidingInvoiceId(null);
    }
  };

  const checkedCount = checkedIds.size;
  const statusOptions = [...new Set(
    billingItems.map(i => i.columnId || i.status).filter(Boolean),
  )];
  const typeOptions = [...new Set(billingItems.map(i => i.type || 'task'))];
  const totalLoggedMin = [...checkedIds].reduce((sum, id) => sum + (timeLogsByItem[id]?.totalMinutes || 0), 0);
  const allIssueIds = safeBillingItemIds;
  const doneIssueIds = billingItems
    .filter(issue => (
      !conflictingItemIds.has(issue.id)
      && deliveredStatusIds.includes(issue.columnId || issue.status)
    ))
    .map(issue => issue.id);
  const selectedConflictCount = [...checkedIds].filter(
    id => conflictingItemIds.has(id),
  ).length;
  const matchesSelection = ids => checkedIds.size === ids.length && ids.every(id => checkedIds.has(id));
  const selectionPreset = checkedIds.size === 0
    ? 'none'
    : matchesSelection(allIssueIds)
      ? 'all'
      : matchesSelection(doneIssueIds)
        ? 'done'
        : 'custom';
  const applySelectionPreset = preset => {
    if (preset === 'all') setCheckedIds(new Set(allIssueIds));
    if (preset === 'none') setCheckedIds(new Set());
    if (preset === 'done') setCheckedIds(new Set(doneIssueIds));
  };

  const showDraftPreview = () => {
    setInvoicePreviewState({
      projectKey: billingProjectKey,
      kind: 'draft',
      invoice: buildInvoice(),
    });
  };
  const showSavedInvoice = invoice => {
    setInvoicePreviewState({
      projectKey: billingProjectKey,
      kind: 'saved',
      invoice,
    });
  };
  const closeInvoicePreview = () => setInvoicePreviewState(null);

  if (logsError) {
    return (
      <div className="flex min-h-[440px] flex-1 items-center justify-center">
        <EmptyState
          icon={AlertTriangle}
          title="Не вдалося завантажити час для рахунку"
          description="Рахунок не формуємо з неповних даних. Перевірте з’єднання та спробуйте ще раз."
          action="Спробувати ще"
          onAction={refreshLogs}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="w-full pb-16 grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

        {/* LEFT: invoice form & task selection — біла картка на сірій панелі аналітики */}
        <div data-ui-surface="card" data-ui-padding="lg" className="ui-surface lg:col-span-2 flex flex-col gap-4 min-w-0">
          <Tabs
            className="w-full overflow-x-auto hide-scrollbar"
            tabs={[
              { id: 'details', label: 'Деталі' },
              { id: 'issues', label: `Позиції (${checkedCount}/${billingItems.length})` },
              { id: 'history', label: `Рахунки (${savedInvoices.length})` },
            ]}
            activeTab={tab}
            onTabChange={setTab}
          />

          {tab === 'details' && (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Клієнт (назва)">
                  <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="ТОВ «Компанія»" />
                </Field>
                <Field label="Ваша агенція">
                  <Input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Назва вашої компанії" />
                </Field>
                <Field label="Реквізити клієнта">
                  <Textarea value={clientDetails} onChange={e => setClientDetails(e.target.value)} placeholder="ЄДРПОУ, адреса..." rows={3} />
                </Field>
                <Field label="Ваші реквізити">
                  <Textarea value={fromDetails} onChange={e => setFromDetails(e.target.value)} placeholder="ЄДРПОУ, IBAN, адреса..." rows={3} />
                </Field>
              </div>

              <Field label="Примітки">
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Умови оплати, терміни..." rows={2} />
              </Field>

              {/* Rates section. The per-position "quick presets" row is gone:
                  picking a position on the row itself already fills that
                  person's rate, so the buttons were a second way to do the same
                  thing that overwrote everybody at once. */}
              <Field label="Ставки виконавців">
                <Surface preset="bordered-panel" padding="sm" className="flex flex-col gap-2">
                  {billingMembers.length === 0 ? (
                    <p className="py-3 text-center text-[12px] text-faint">Учасників з часом немає</p>
                  ) : (
                    billingMembers.map(m => {
                      const uid = m.id || m.uid;
                      return (
                        <RateRow
                          key={uid}
                          uid={uid}
                          member={m}
                          rate={memberRates[uid] ?? 0}
                          onRateChange={rate => setMemberRateState(previous => (
                            setBillingMemberRate(previous, {
                              projectKey: billingProjectKey,
                              uid,
                              rate,
                            })
                          ))}
                          preset={memberPresets[uid] || ''}
                          onPresetChange={presetId => setMemberRateState(previous => (
                            setBillingMemberPreset(previous, {
                              projectKey: billingProjectKey,
                              uid,
                              presetId,
                            })
                          ))}
                          currency={currency}
                          positions={positions}
                        />
                      );
                    })
                  )}
                </Surface>
              </Field>

            </div>
          )}

          {tab === 'issues' && (
            <div className="flex flex-col gap-4">
              {invalidTimeLogCount > 0 && (
                <Alert
                  variant="warning"
                  title={`${invalidTimeLogCount} некоректних записів часу не включено`}
                  description="Перевірте legacy-записи часу: потрібні цілі хвилини від 1 до 525 600."
                />
              )}
              <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
                <Segmented
                  value={selectionPreset}
                  onChange={applySelectionPreset}
                  options={[
                    { value: 'all', label: 'Всі' },
                    { value: 'none', label: 'Жодної' },
                    { value: 'done', label: 'Виконані' },
                  ]}
                  surface="canvas"
                  composition="billing-selection"
                />

                <div className="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto">
                  <Select
                    filterRole="status"
                    value={filterStatus}
                    onChange={val => setFilterStatus(val)}
                    options={[
                      { value: 'all', label: 'Всі статуси' },
                      ...statusOptions.map(s => ({ value: s, label: statusLabelOf(s) }))
                    ]}
                    className="w-[120px]"
                  />
                  <Select
                    filterRole="type"
                    value={filterType}
                    onChange={val => setFilterType(val)}
                    options={[
                      { value: 'all', label: 'Всі типи' },
                      ...typeOptions.map(t => ({
                        value: t,
                        label: t === 'calendar_event' ? 'Події календаря' : (typeMeta[t]?.label || t),
                      }))
                    ]}
                    className="w-[110px]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {logsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <LoadingSpinner size="md" />
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="py-12 text-center text-[13px] text-faint font-semibold">Позицій немає</div>
                ) : (
                  filteredItems.map(iss => (
                    <IssueRow
                      key={iss.id}
                      issue={iss}
                      checked={checkedIds.has(iss.id)}
                      onCheck={() => setCheckedIds(prev => {
                        const next = new Set(prev);
                        next.has(iss.id) ? next.delete(iss.id) : next.add(iss.id);
                        return next;
                      })}
                      timeLogs={timeLogsByItem}
                      rates={memberRates}
                      members={members}
                      manualPrice={manualPrices[iss.id] ?? null}
                      onManualPrice={v => setManualPrices(p => ({ ...p, [iss.id]: v }))}
                      currency={currency}
                      useManual={useManualMap[iss.id] ?? false}
                      onUseManual={() => setUseManualMap(p => ({ ...p, [iss.id]: !p[iss.id] }))}
                      statusLabel={statusLabelOf(iss.columnId || iss.status)}
                      typeMeta={typeMeta}
                      priorities={priorities}
                      billingConflictCount={Math.max(
                        invoiceOverlap.byItemId[iss.id]?.length || 0,
                        invoiceOverlap.sourceItemIds.includes(iss.id) ? 1 : 0,
                      )}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="flex flex-col gap-3">
              {savedInvoices.length === 0 ? (
                <div className="py-12 text-center text-[13px] text-faint font-semibold">Рахунків ще немає</div>
              ) : (
                // A bordered grey card at the surface radius — which is a named
                // preset, not four utilities. It read as `#fafafa` before, one
                // of six near-whites the product had invented for the same fill.
                savedInvoices.map(inv => (
                  // Клікає весь рядок, а не одна кнопка в його кінці.
                  //
                  // «Переглянути рахунок» ховалося серед двох інших контролів
                  // праворуч, а сам рядок — номер, дата, сума — не робив нічого,
                  // хоча це єдине, заради чого в історію заходять. Рядок і є
                  // рахунок; кнопки поруч лишаються для того, що рядком не є
                  // (анулювати).
                  <Surface
                    key={inv.id}
                    preset="bordered-panel"
                    padding="md"
                    role="button"
                    tabIndex={0}
                    onClick={event => {
                      if (event.target.closest('button')) return;
                      showSavedInvoice(inv);
                    }}
                    onKeyDown={event => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      showSavedInvoice(inv);
                    }}
                    title={`Відкрити рахунок ${inv.number}`}
                    className="flex cursor-pointer flex-col items-stretch justify-between gap-3 transition-colors hover:bg-canvas/50 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-canvas text-muted">
                        <FileText size={16} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-bold text-ink">{inv.number}</p>
                          {/* Стан видно, а не здогадуються. Раніше позначався
                              лише анульований, тож чинний рахунок не мав
                              жодної мітки й нічим не відрізнявся від нього. */}
                          {inv.status === 'void'
                            ? <Pill tone="neutral">Анульовано</Pill>
                            : <Pill tone="dark" size="sm">Чинний</Pill>}
                        </div>
                        <p className="text-[11px] text-muted font-medium mt-1">
                          {inv.date} · {inv.items?.length || 0} {plural(inv.items?.length || 0, ['позиція', 'позиції', 'позицій'])}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-[14px] font-black text-ink">{fmtMoney(inv.total, inv.currency)}</span>
                      {/* Шеврон — це те, що робить рядок читабельно натисним.
                          Без нього номер, дата й сума виглядають як підпис. */}
                      <ChevronRight size={16} className="shrink-0 text-faint" />
                    </div>
                  </Surface>
                ))
              )}
            </div>
          )}
        </div>

        {/* RIGHT: always-visible invoice summary rail — біла на сірій панелі */}
        <Card preset="borderless" padding="lg" className="lg:col-span-1 flex flex-col gap-4">
          <h3 className="ui-type-eyebrow text-muted uppercase tracking-wider">
            Рахунок · {project?.name || 'Проєкт'}
          </h3>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Валюта">
              <Select
                value={currency}
                onChange={changeCurrency}
                options={CURRENCIES.map(c => ({ value: c, label: c }))}
              />
            </Field>
            <Field label="Знижка %">
              <Input type="number" min={0} max={100} value={discountPct}
                onChange={e => setDiscountPct(Math.min(100, Math.max(0, Number(e.target.value))))} />
            </Field>
            <Field label="ПДВ %">
              <Input type="number" min={0} max={100} value={taxPct}
                onChange={e => setTaxPct(Math.min(100, Math.max(0, Number(e.target.value))))} />
            </Field>
          </div>

          {/* Rates and manual prices are plain numbers; only this selector says
              what they are worth. Switching it therefore has to be answered:
              either convert the figures at a stated rate, or confirm they were
              already meant in the new currency. Doing neither is what made an
              invoice change value by 40× without a single digit moving. */}
          {currencyChanged && (
            <Alert
              variant="warning"
              title={`Суми введено в ${amountsCurrency}`}
              description={`Валюта рахунку тепер ${currency}. Вкажіть курс, щоб перерахувати ставки й ручні ціни, або підтвердьте, що суми вже в ${currency}.`}
            >
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-ink">1 {amountsCurrency} =</span>
                <Input
                  type="number"
                  min={0}
                  step="0.0001"
                  size="sm"
                  className="w-[110px]"
                  value={conversionRate}
                  onChange={e => setConversionRate(e.target.value)}
                  suffix={currency}
                  aria-label={`Курс ${amountsCurrency} до ${currency}`}
                />
                <Button size="sm" onClick={applyConversion} disabled={!parsedConversionRate}>
                  Перерахувати
                </Button>
                <Button size="sm" style="ghost" onClick={keepAmountsAsIs}>
                  Залишити як є
                </Button>
              </div>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div data-ui-surface="nested-panel" data-ui-padding="sm" className="ui-surface">
              <p className="text-[10px] font-bold text-muted uppercase tracking-wide">Обрано позицій</p>
              <p className="text-[18px] font-bold text-ink mt-[2px]">
                {checkedCount}<span className="text-[12px] text-faint font-semibold"> / {billingItems.length}</span>
              </p>
            </div>
            <div data-ui-surface="nested-panel" data-ui-padding="sm" className="ui-surface">
              <p className="text-[10px] font-bold text-muted uppercase tracking-wide">Зафіксовано часу</p>
              <p className="text-[18px] font-bold text-ink mt-[2px]">{fmtMin(totalLoggedMin)}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-[13px]">
              <span className="text-muted">Підсумок</span>
              <span className="font-bold text-ink">{fmtMoney(subtotal, currency)}</span>
            </div>
            {discountPct > 0 && (
              <div className="flex justify-between text-[13px]">
                <span className="text-muted">Знижка ({discountPct}%)</span>
                <span className="font-bold text-success">−{fmtMoney(discount, currency)}</span>
              </div>
            )}
            {taxPct > 0 && (
              <div className="flex justify-between text-[13px]">
                <span className="text-muted">ПДВ ({taxPct}%)</span>
                <span className="font-bold text-ink">+{fmtMoney(tax, currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-3 border-t border-line items-center">
              <span className="text-[13px] font-bold text-ink">До оплати</span>
              <span className="text-[20px] font-black text-ink">{fmtMoney(total, currency)}</span>
            </div>
          </div>

          {billingMembers.length > 0 && Object.values(memberRates).every(r => !r) && (
            <Alert
              variant="warning"
              title="Встановіть ставки виконавців"
              description="Без ставок вартість завдань і подій буде нульовою"
            />
          )}
          {selectedConflictCount > 0 ? (
            <Alert
              variant="warning"
              title={`${selectedConflictCount} ${plural(selectedConflictCount, ['позиція', 'позиції', 'позицій'])} уже є в рахунках`}
              description="Зніміть їх з вибору перед збереженням, щоб не виставити той самий зафіксований час двічі."
            />
          ) : null}

          <div className="flex flex-col gap-2 mt-1">
            {/* Both actions wait for the currency question to be answered: an
                invoice whose figures are in one currency and whose header says
                another is wrong in a way the reader cannot see. */}
            <Button
              onClick={showDraftPreview}
              disabled={checkedCount === 0 || currencyChanged}
              style="primary"
              size="lg"
              icon={Eye}
              className="w-full"
            >
              Переглянути рахунок
            </Button>
            {/* `loading` is the button's own busy state: it swaps the icon for
                a spinner in place. Rendering a LoadingSpinner *next to* the
                label instead added a second glyph, so the button grew wider and
                the text shifted the moment you pressed it. */}
            {/* Назва по тому, що кнопка робить.
                «Зберегти чернетку» звучить як «запамʼятати, щоб доробити
                пізніше» — ніби чернетка це запис у блокноті. Насправді це
                створення рахунку: сервер видає офіційний номер із послідовності
                організації й закріплює за ним використані записи часу, щоб ту
                саму роботу не виставили двічі. Скасувати можна, доробити —
                вже ні. Рядок під кнопкою каже і те, і те. */}
            <Button
              onClick={saveInvoice}
              disabled={checkedCount === 0 || currencyChanged}
              loading={saving}
              style="secondary"
              size="lg"
              icon={Save}
              className="w-full"
            >
              Створити рахунок
            </Button>

          </div>
        </Card>
      </div>

      {/* Invoice preview modal */}
      {invoicePreview && (
        <InvoicePreview
          invoice={invoicePreview.invoice}
          project={project}
          isSaved={invoicePreview.kind === 'saved'}
          onClose={closeInvoicePreview}
          onPrintBlocked={() => showToast('Дозвольте спливаючі вікна, щоб надрукувати рахунок', 'error')}
          onVoid={() => {
            const invoice = invoicePreview.invoice;
            closeInvoicePreview();
            voidInvoice(invoice);
          }}
          voiding={voidingInvoiceId === invoicePreview.invoice?.id}
        />
      )}
    </div>
  );
}
