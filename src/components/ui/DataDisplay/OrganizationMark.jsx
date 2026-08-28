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
  sidebar: 'bg-[var(--sb-active)] text-[var(--sb-text)]',
  inverse: 'border-[3px] border-transparent bg-surface-dark text-white',
};

/**
 * The logo or initial that identifies an organization.
 *
 * @param {string} props.name Organization name used for alt text and fallback.
 * @param {string} props.logo Public organization logo URL.
 * @param {'sm'|'md'|'picker'} props.size Named geometry from the UI Kit.
 * @param {'surface'|'sidebar'|'inverse'} props.appearance Surface contrast.
 * @param {string} props.className Placement in the parent only.
 */
export default function OrganizationMark({
  name = 'Організація',
  logo = '',
  size = 'sm',
  appearance = 'surface',
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
      } ${APPEARANCE_CLASSES[appearance] || APPEARANCE_CLASSES.surface} ${className}`}
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
