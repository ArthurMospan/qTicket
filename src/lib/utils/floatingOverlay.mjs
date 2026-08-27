function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function calculateFloatingOverlayPosition({
  anchorRect,
  overlayWidth,
  overlayHeight,
  viewportWidth,
  viewportHeight,
  preferredPlacement = 'bottom',
  align = 'center',
  gap = 8,
  padding = 8,
}) {
  const width = Math.max(0, Number(overlayWidth) || 0);
  const height = Math.max(0, Number(overlayHeight) || 0);
  const viewportW = Math.max(0, Number(viewportWidth) || 0);
  const viewportH = Math.max(0, Number(viewportHeight) || 0);
  const anchor = {
    top: Number(anchorRect?.top) || 0,
    right: Number(anchorRect?.right) || 0,
    bottom: Number(anchorRect?.bottom) || 0,
    left: Number(anchorRect?.left) || 0,
    width: Number(anchorRect?.width) || 0,
    height: Number(anchorRect?.height) || 0,
  };

  const room = {
    top: anchor.top - gap - padding,
    bottom: viewportH - anchor.bottom - gap - padding,
    left: anchor.left - gap - padding,
    right: viewportW - anchor.right - gap - padding,
  };
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const vertical = preferredPlacement === 'top' || preferredPlacement === 'bottom';
  const required = vertical ? height : width;
  const alternative = opposite[preferredPlacement] || 'top';
  const placement = room[preferredPlacement] < required && room[alternative] > room[preferredPlacement]
    ? alternative
    : preferredPlacement;

  let top;
  let left;
  if (placement === 'top') top = anchor.top - height - gap;
  else if (placement === 'bottom') top = anchor.bottom + gap;
  else if (placement === 'left') left = anchor.left - width - gap;
  else left = anchor.right + gap;

  if (placement === 'top' || placement === 'bottom') {
    if (align === 'start') left = anchor.left;
    else if (align === 'end') left = anchor.right - width;
    else left = anchor.left + (anchor.width - width) / 2;
  } else {
    if (align === 'start') top = anchor.top;
    else if (align === 'end') top = anchor.bottom - height;
    else top = anchor.top + (anchor.height - height) / 2;
  }

  return {
    top: clamp(top, padding, viewportH - height - padding),
    left: clamp(left, padding, viewportW - width - padding),
    placement,
  };
}
