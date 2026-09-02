'use client';

import { useEffect, useState } from 'react';

// An organization logo is not a user avatar: it is square, it may be a
// transparent wordmark, and its fallback is the first letter of the company.
// Keeping this here gives the desktop rail, mobile sheet and organization
// picker one image-failure and fallback behaviour.
const SIZE_CLASSES = {
  sm: 'h-[32px] w-[32px] rounded-[8px] text-[13px]',
  md: 'h-[40px] w-[40px] rounded-[10px] text-[15px]',
  picker: 'h-[110px] w-[110px] rounded-full text-[40px]',
};

const APPEARANCE_CLASSES = {
  surface: 'border border-line bg-canvas text-ink',
  sidebar: 'text-[var(--sb-text)]',
  inverse: 'border-[3px] border-transparent bg-surface-dark text-white',
};

// The ground under a fallback initial, for the appearance that paints none
// under a logo. On the rail a logo lies directly on the rail colour, as it does
// in QuickTeam's rail: `--sb-active` is eight percent of white, and painted
// under an image it was a translucent plate behind the client's mark that the
// staff corner beside it — a bare `<img>` at the time — never had. A letter
// still needs a shape to sit in, so the initial keeps it. `surface` and
// `inverse` are not here on purpose: a bordered canvas tile under a wordmark is
// the design in lists and in the picker.
const INITIAL_GROUND = {
  sidebar: 'bg-[var(--sb-active)]',
};

/**
 * The logo or initial that identifies an organization.
 *
 * @param {string} props.name Organization name used for alt text and fallback.
 * @param {string} props.logo Public organization logo URL.
 * @param {'sm'|'md'|'picker'} props.size Named geometry from the UI Kit.
 * @param {'surface'|'sidebar'|'inverse'} props.appearance Surface contrast.
 *   On `sidebar` a logo lies directly on the rail colour and only the fallback
 *   initial gets a ground (`INITIAL_GROUND`); the other two paint theirs under
 *   the logo and the initial alike.
 * @param {string} props.background What the logo is laid on, as a colour from the
 *   organization's own record — never a design decision, which is why it is an
 *   inline value rather than a token. A wordmark is very often a transparent PNG
 *   or SVG in one ink, and against the picker's dark ground half of them vanish;
 *   the tenant's own brand colour is the ground the logo was drawn for. Omitted,
 *   the appearance decides, and the fallback initial always uses the appearance.
 * @param {string} props.className Placement in the parent only.
 */
export default function OrganizationMark({
  name = 'Організація',
  logo = '',
  size = 'sm',
  appearance = 'surface',
  background = '',
  className = '',
}) {
  const [failedLogo, setFailedLogo] = useState('');
  useEffect(() => {
    if (failedLogo && failedLogo !== logo) queueMicrotask(() => setFailedLogo(''));
  }, [failedLogo, logo]);

  const safeName = String(name || 'Організація').trim() || 'Організація';
  const showImage = Boolean(logo) && failedLogo !== logo;

  return (
    <span
      data-ui-size={size}
      data-ui-appearance={appearance}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden font-bold ${
        SIZE_CLASSES[size] || SIZE_CLASSES.sm
      } ${APPEARANCE_CLASSES[appearance] || APPEARANCE_CLASSES.surface} ${
        showImage ? '' : (INITIAL_GROUND[appearance] || '')
      } ${className}`}
      // Only under an image. An initial is drawn in the appearance's own ink,
      // and painting the tenant's colour behind it would put a brand colour
      // under a letter the brand never chose.
      style={showImage && background ? { backgroundColor: background } : undefined}
      aria-label={showImage ? undefined : safeName}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt={safeName}
          className="h-full w-full object-cover"
          onError={() => setFailedLogo(logo)}
        />
      ) : (
        <span aria-hidden="true">{safeName.charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}
