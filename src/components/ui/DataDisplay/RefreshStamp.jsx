'use client';
import React from 'react';
import { RefreshCw } from 'lucide-react';

import Button from '../Button';

/**
 * When a reading was taken, and the way to take another.
 *
 * A screen either updates itself or it says when it last looked — and the
 * second is only honest if it is on the screen. The analytics screens stopped
 * holding live listeners over the collections the workspace grows fastest
 * (see docs/ARCHITECTURE.md → «Вартість читання»), so this is the sentence that
 * replaces the promise those listeners were making. A report with no timestamp
 * and no refresh is a report the reader has to guess the age of.
 *
 * Deliberately not a status: nothing here is wrong, and nothing needs
 * attention. It is a caption in the header's own voice, with one quiet control
 * beside it.
 *
 * @param {number|null} props.at When the reading was taken, in milliseconds. Nothing is drawn until there is one.
 * @param {boolean} props.loading Whether a newer reading is on its way; the icon turns while it is.
 * @param {() => void} props.onRefresh Take another reading.
 * @param {string} props.label The whole phrase before the time, preposition included — «Оновлено о», «Дані на». A screen that means something more specific says it in full rather than having a preposition chosen for it.
 * @param {string} props.className Placement in the parent only.
 */
export default function RefreshStamp({
  at = null,
  loading = false,
  onRefresh,
  label = 'Оновлено о',
  className = '',
}) {
  if (!at) return null;
  const time = new Date(at).toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <span className={`inline-flex items-center gap-[2px] ${className}`}>
      <span className="whitespace-nowrap text-[12px] text-muted tabular-nums">
        {label} {time}
      </span>
      {onRefresh && (
        <Button
          style="ghost"
          size="icon-sm"
          icon={RefreshCw}
          onClick={onRefresh}
          disabled={loading}
          loading={loading}
          title="Оновити дані"
          aria-label="Оновити дані"
        />
      )}
    </span>
  );
}
