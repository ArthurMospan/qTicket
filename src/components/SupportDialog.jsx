'use client';

import { ArrowUpRight, History, Mail } from 'lucide-react';
import { Dialog, ListRow } from '@/components/ui';
import { BRAND_COLORS, TelegramMark, ViberMark } from '@/lib/design/brandMarks';
import { ONEB_SUPPORT_CONTACTS } from '@/lib/content/supportContacts.mjs';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

// How each support channel presents itself: its own logo on a wash of its own
// colour, and what pressing the row will actually do. Mail has no brand of its
// own — the letter is drawn in the product's ink so the three rows still read
// as one list rather than two logos and an orphan.
const SUPPORT_CHANNELS = {
  email: {
    Mark: ({ size }) => <Mail size={size - 2} strokeWidth={1.9} className="text-ink" />,
    tint: 'rgba(31, 31, 31, 0.06)',
    action: 'Відкрити поштову програму',
  },
  telegram: {
    Mark: TelegramMark,
    tint: `${BRAND_COLORS.telegram}1f`,
    action: 'Відкрити Telegram',
  },
  viber: {
    Mark: ViberMark,
    tint: `${BRAND_COLORS.viber}1f`,
    action: 'Відкрити Viber',
  },
};

function openExternal(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * The three official OneB channels, in one dialog.
 *
 * It used to live inside the workspace help menu, which meant support was
 * reachable only from inside an organization — precisely the wrong place, since
 * somebody who cannot sign in or has no workspace to open is the person most
 * likely to need it. The dialog is a component of its own now, so the sign-in
 * shell and the workspace open the same one rather than each drawing a list of
 * contacts that would drift apart.
 */
export default function SupportDialog({ isOpen, onClose }) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Підтримка"
      description="Офіційні канали OneB — напишіть у той, що зручніший."
      size="sm"
      presentation="dialog"
    >
      <div className="flex flex-col gap-[8px]">
        <div className="overflow-hidden rounded-[14px] border border-line divide-y divide-line">
          {ONEB_SUPPORT_CONTACTS.map(contact => {
            const channel = SUPPORT_CHANNELS[contact.id] || SUPPORT_CHANNELS.email;
            const Mark = channel.Mark;
            return (
              <ListRow
                key={contact.id}
                density="roomy"
                title={channel.action}
                onClick={() => {
                  if (contact.href.startsWith('mailto:')) window.location.href = contact.href;
                  else openExternal(contact.href);
                }}
                className="flex items-center gap-[12px]"
              >
                <span
                  aria-hidden
                  className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[12px]"
                  style={{ background: channel.tint }}
                >
                  <Mark size={22} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-bold text-ink">{contact.label}</span>
                  <span className="truncate text-[12px] font-medium text-muted">{contact.value}</span>
                </span>
                <ArrowUpRight size={16} className="ml-auto shrink-0 text-faint" />
              </ListRow>
            );
          })}
        </div>
        {/* The build, for a support conversation that needs it. It used to
            be a link into a changelog written for whoever built the product;
            the number is the only part of that anybody was ever asked for. */}
        <p className="mt-[4px] flex items-center justify-center gap-[6px] text-[11px] font-medium text-muted">
          <History size={12} />
          qTicket {APP_VERSION}
        </p>
      </div>
    </Dialog>
  );
}
