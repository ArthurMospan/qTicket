// src/app/opengraph-image.js — what a QuickTeam link looks like when it is pasted.
//
// Until this existed, a workspace URL dropped into Telegram or Slack unfurled
// as the bare host and nothing else: no name, no mark, no clue whether the link
// went to a task or to a login screen. The workspace is shared by link dozens
// of times a day — an invite most of all — so the preview is a real surface.
//
// Drawn rather than stored, so it stays in step with the palette: the two
// colours below are the same `--color-ink` / `--color-canvas` every screen uses.

import { ImageResponse } from 'next/og';

export const alt = 'qTicket';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#1f1f1f';
const CANVAS = '#f4f4f5';

const TITLE = 'qTicket';

// The real mark, copied from `public/logo-min.svg`. Inlined rather than read
// off disk on purpose: a file under `public/` is served to browsers but is not
// guaranteed to be inside the function bundle that renders this card, and a
// card that throws in production is worse than a line to keep in step. If the
// logo ever changes, this string changes with it.
const MARK = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 16C0 8.80395 0 5.20593 2.0716 2.84372C2.31185 2.56977 2.56977 2.31185 2.84372 2.0716C5.20593 0 8.80395 0 16 0C23.196 0 26.7941 0 29.1563 2.0716C29.4302 2.31185 29.6882 2.56977 29.9284 2.84372C32 5.20593 32 8.80395 32 16C32 23.196 32 26.7941 29.9284 29.1563C29.6882 29.4302 29.4302 29.6882 29.1563 29.9284C26.7941 32 23.196 32 16 32C8.80395 32 5.20593 32 2.84372 29.9284C2.56977 29.6882 2.31185 29.4302 2.0716 29.1563C0 26.7941 0 23.196 0 16Z" fill="#f4f4f5"/><path d="M3.2 14.4C3.2 11.3072 5.70721 8.8 8.8 8.8C11.8928 8.8 14.4 11.3072 14.4 14.4V15.2C14.4 18.2928 11.8928 20.8 8.8 20.8C5.70721 20.8 3.2 18.2928 3.2 15.2V14.4Z" fill="#1F1F1F"/><path d="M17.6 14.4C17.6 11.3072 20.1072 8.8 23.2 8.8C26.2928 8.8 28.8 11.3072 28.8 14.4V15.2C28.8 18.2928 26.2928 20.8 23.2 20.8C20.1072 20.8 17.6 18.2928 17.6 15.2V14.4Z" fill="#1F1F1F"/><path d="M21.6 13.4C21.6 11.7431 22.9431 10.4 24.6 10.4C26.2569 10.4 27.6 11.7431 27.6 13.4C27.6 15.0569 26.2569 16.4 24.6 16.4C22.9431 16.4 21.6 15.0569 21.6 13.4Z" fill="#f4f4f5"/><path d="M7.2 13.4C7.2 11.7431 8.54315 10.4 10.2 10.4C11.8569 10.4 13.2 11.7431 13.2 13.4C13.2 15.0569 11.8569 16.4 10.2 16.4C8.54315 16.4 7.2 15.0569 7.2 13.4Z" fill="#f4f4f5"/></svg>`;
const MARK_SRC = `data:image/svg+xml;base64,${Buffer.from(MARK).toString('base64')}`;

// Google decides the format from the user agent, and satori reads exactly one
// of them. A modern string gets WOFF2 back and the build fails outright with
// "Unsupported OpenType signature wOF2"; a dated browser string gets WOFF, which
// silently yields no font at all. A user agent Google cannot place gets
// TrueType, which is the one that works — so the vaguest possible string is
// deliberate here, not laziness.
const PLAIN_UA = 'Mozilla/5.0';

/**
 * Google serves a subset containing exactly the glyphs asked for, which for
 * one word is a couple of kilobytes rather than the whole face.
 *
 * If the fetch fails the card still renders — the name falls back to whatever
 * satori bundles. An unfurled preview is not worth failing a build over.
 *
 * The face is registered under a name of its own rather than as a weight of
 * "Inter". Subsets arrive as separate files carrying the same internal name,
 * and satori then matches every element to whichever it saw last — that is how
 * an earlier cut of this card ended up with a 116px title in the weight of its
 * 26px chips.
 */
async function interSubset(family, weight, text) {
  try {
    const api = `https://fonts.googleapis.com/css2?family=Inter:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await fetch(api, { headers: { 'User-Agent': PLAIN_UA } })
      .then(response => (response.ok ? response.text() : ''));
    // Matched on the declared format, not the extension: a subsetted face is
    // served from `/l/font?kit=…` and has no extension to match on.
    const source = css.match(/url\((https:\/\/[^)]+)\)\s*format\('truetype'\)/)?.[1];
    if (!source) return null;
    const data = await fetch(source).then(response => (response.ok ? response.arrayBuffer() : null));
    if (!data) return null;
    return { name: family, data, weight: 400, style: 'normal' };
  } catch {
    return null;
  }
}

export default async function Image() {
  const fonts = [await interSubset('InterBold', 700, TITLE)].filter(Boolean);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: INK,
          padding: '72px 80px',
        }}
      >
        {/* The product mark itself — not a stand-in built out of letters.
            `next/image` has nothing to do here: satori draws the card, and the
            only element it understands for an image is a plain `img`. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK_SRC} width={84} height={84} alt="" />

        <div
          style={{
            display: 'flex',
            color: CANVAS,
            fontFamily: 'InterBold, sans-serif',
            fontSize: 116,
            letterSpacing: -4,
            lineHeight: 1,
          }}
        >
          {TITLE}
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
