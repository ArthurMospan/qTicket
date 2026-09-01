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

// Знак продукту, скопійований із `public/qticket_white.svg`. Білий варіант, бо
// картка малюється на ink — на темному тлі темний знак не видно.
//
// Вшитий рядком, а не прочитаний з диска: файл під `public/` віддається
// браузерам, але не гарантовано лежить у бандлі функції, яка малює цю картку, а
// картка, що падає в проді, гірша за рядок, який треба тримати в синхроні. Якщо
// знак зміниться — змінюється й цей рядок.
const MARK = `<svg width="188" height="188" viewBox="0 0 188 188" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M94.0001 0C131.329 0 149.994 -0.000104315 162.248 10.7461C163.669 11.9924 165.008 13.3308 166.254 14.752C177 27.0059 177 45.6708 177 83C177 120.329 177 138.994 166.254 151.248C165.008 152.669 163.669 154.008 162.248 155.254C149.994 166 131.329 166 94.0001 166C90.0025 166 86.2189 165.999 82.6343 165.986C79.803 165.975 77.237 167.659 76.1324 170.266L70.4494 183.679C68.5404 188.185 62.7152 189.391 59.1735 186.014L31.1467 159.29C30.7612 158.923 30.3332 158.603 29.8814 158.321C28.4233 157.411 27.0513 156.393 25.7521 155.254C24.331 154.008 22.9925 152.669 21.7462 151.248C11 138.994 11.0001 120.329 11.0001 83C11.0001 45.6707 10.9999 27.0059 21.7462 14.752C22.9925 13.3308 24.331 11.9924 25.7521 10.7461C38.006 6.48632e-06 56.671 0 94.0001 0Z" fill="white"/><path d="M27.6001 74.7005C27.6001 58.6566 40.6062 45.6505 56.6501 45.6505C72.694 45.6505 85.7001 58.6566 85.7001 74.7005V78.8505C85.7001 94.8944 72.694 107.901 56.6501 107.901C40.6062 107.901 27.6001 94.8944 27.6001 78.8505V74.7005Z" fill="#1F1F1F"/><path d="M102.3 74.7005C102.3 58.6566 115.306 45.6505 131.35 45.6505C147.394 45.6505 160.4 58.6566 160.4 74.7005V78.8505C160.4 94.8944 147.394 107.901 131.35 107.901C115.306 107.901 102.3 94.8944 102.3 78.8505V74.7005Z" fill="#1F1F1F"/><path d="M123.05 69.5122C123.05 60.9173 130.018 53.9497 138.613 53.9497C147.208 53.9497 154.175 60.9173 154.175 69.5122C154.175 78.1071 147.208 85.0747 138.613 85.0747C130.018 85.0747 123.05 78.1071 123.05 69.5122Z" fill="white"/><path d="M48.3501 69.5122C48.3501 60.9173 55.3177 53.9497 63.9126 53.9497C72.5075 53.9497 79.4751 60.9173 79.4751 69.5122C79.4751 78.1071 72.5075 85.0747 63.9126 85.0747C55.3177 85.0747 48.3501 78.1071 48.3501 69.5122Z" fill="white"/></svg>`;
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
