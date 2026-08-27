'use client';

import { useEffect, useState } from 'react';

// Shortening the name inside a mention capsule.
//
// The obvious way — `max-width` with `text-overflow: ellipsis` — cannot be used
// here, and not as a matter of taste. A capsule is an inline-block, and an
// inline-block's baseline is the baseline of the text inside it *only while its
// overflow is visible*; the moment it clips, the baseline becomes its bottom
// margin edge. Measured in this product on a 320px column: a line carrying a
// capsule is 22.75px like every other line, and 26.75px the instant that
// capsule clips — with the words in it a step above the sentence. That step is
// what «капсули стрибають» was, and it was fixed by removing the clip.
//
// So the box is never clipped. The *string* is shortened instead, to the width
// the capsule actually has, which is measured rather than guessed at in
// characters: «Форма» and «Advance (us) | Не працює…» are the same number of
// characters apart in Cyrillic and Latin and nowhere near the same width.

const ELLIPSIS = '…';

let measuringContext = null;

function contextFor(font) {
  if (!measuringContext) {
    const canvas = document.createElement('canvas');
    measuringContext = canvas.getContext('2d');
  }
  if (!measuringContext) return null;
  measuringContext.font = font;
  return measuringContext;
}

/**
 * The longest prefix of `text` that fits `available` pixels in `font`, with an
 * ellipsis when anything was dropped. Exported for tests and for callers that
 * already know their width.
 */
export function fitLabel(text, available, font) {
  const value = String(text ?? '');
  if (!value || !(available > 0)) return value;
  const context = contextFor(font);
  if (!context) return value;
  if (context.measureText(value).width <= available) return value;

  let fits = 0;
  let tooLong = value.length;
  while (fits < tooLong) {
    const middle = Math.ceil((fits + tooLong) / 2);
    const candidate = `${value.slice(0, middle).trimEnd()}${ELLIPSIS}`;
    if (context.measureText(candidate).width <= available) fits = middle;
    else tooLong = middle - 1;
  }
  return fits > 0 ? `${value.slice(0, fits).trimEnd()}${ELLIPSIS}` : ELLIPSIS;
}

/**
 * The block a capsule sits in — the one whose width is the room it has. Walking
 * out past the inline wrappers is what makes this work in a 320px task panel
 * and in a 900px channel without either knowing about the other.
 */
function containingBlock(chip) {
  let box = chip.parentElement;
  while (box) {
    const display = window.getComputedStyle(box).display;
    if (display !== 'inline' && display !== 'inline-block' && display !== 'contents') return box;
    box = box.parentElement;
  }
  return null;
}

/** That block's width, less its padding and the capsule's own furniture. */
function availableWidth(chip, box) {
  const boxStyle = window.getComputedStyle(box);
  const chipStyle = window.getComputedStyle(chip);
  const inner = box.clientWidth
    - parseFloat(boxStyle.paddingLeft || 0)
    - parseFloat(boxStyle.paddingRight || 0);
  const furniture = parseFloat(chipStyle.paddingLeft || 0)
    + parseFloat(chipStyle.paddingRight || 0);
  return inner - furniture;
}

/**
 * A label that shortens itself to the capsule's real width.
 *
 * The first paint uses the full text, which is also what the server renders, so
 * there is nothing for hydration to disagree about; the measurement lands in
 * the same frame the browser would have painted an overflow in — a
 * `ResizeObserver` reports the box it is given as soon as it is observed, and
 * again whenever the conversation column changes width for reasons the capsule
 * cannot see: a thread pane opening, a window dragged, a task panel resized.
 *
 * @param {string} text The full name — of a person, or of a task.
 * @returns {[React.RefCallback, string]} The ref for the capsule, and what to
 *   put inside it.
 */
export default function useFittedLabel(text) {
  const [node, setNode] = useState(null);
  const [label, setLabel] = useState(text);

  useEffect(() => {
    // No reset of the label here: observing a box always fires the callback
    // once with its current size, so a name that arrives late (a task title
    // resolving behind its key) is measured in that same notification.
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const box = containingBlock(node);
    if (!box) return undefined;

    const style = window.getComputedStyle(node);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
    const observer = new ResizeObserver(() => {
      setLabel(fitLabel(text, availableWidth(node, box), font));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [node, text]);

  return [setNode, label];
}
