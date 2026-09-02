'use client';

// Кеш одного бренду, який носять обидва читачі — рейка підтримки й клієнтський
// портал — у localStorage. Документ організації їде з Firestore асинхронно,
// тому без кешу після перезавантаження рейка секунду світить стандартною
// темною темою і лише потім перемальовується в колір організації. Кеш віддає
// останній відомий бренд одразу; щойно приходять живі дані — вони стають
// джерелом правди й оновлюють кеш.
import { useEffect, useState } from 'react';
import { SIDEBAR_THEME_VERSION } from '@/lib/utils/sidebarTheme';
import { resolveOrganizationPortalBrand } from '@/lib/utils/organizationBranding.mjs';

const cacheKey = orgId => `qt_sidebar_brand_${orgId}`;

// One tenant, one brand, one reader.
//
// This used to read the organization's own `customBranding`/`logo`/
// `sidebarTheme`/`sidebarColor` — the fields the inherited task manager wrote
// when somebody set a colour inside it — while the client portal read
// `portalBranding`, the snapshot QuickTeam signs and sends. Two fields, one
// company: the same organization was white in QuickTeam and purple in
// qTicket's staff rail, and nothing on either screen said which was wrong.
//
// QuickTeam owns the brand. `resolveOrganizationPortalBrand` is that single
// answer — it prefers the synced snapshot and falls back to the organization's
// own fields for a tenant that predates the sync — and every surface reads it:
// the staff rail, the client portal, the phone's sheet, the picker, the tab.
// It answers for a tenant without a logo too. This returned `null` for one,
// so a tenant with a colour and no logo got the default dark rail on the staff
// side while the client got the colour — the last place the two readers were
// still two. The `customBranding` gate went the same way: it was a paid plan's
// switch, and qTicket has no plans to switch.
function normalizeBrand(org) {
  if (!org) return null;
  const { name, logo, sidebarTheme, sidebarColor } = resolveOrganizationPortalBrand(org);
  return { name, logo, sidebarTheme, sidebarColor };
}

export function useCachedOrgBranding(activeOrgId, activeOrg) {
  const [cached, setCached] = useState(null);

  // Читаємо кеш, щойно відомий orgId — ще до приходу документа організації.
  useEffect(() => {
    queueMicrotask(() => {
      if (!activeOrgId) {
        setCached(null);
        return;
      }
      try {
        setCached(JSON.parse(localStorage.getItem(cacheKey(activeOrgId)) || 'null'));
      } catch {
        setCached(null);
      }
    });
  }, [activeOrgId]);

  // Живі дані оновлюють кеш: наступне перезавантаження стартує з того бренду,
  // який QuickTeam надіслав останнім.
  useEffect(() => {
    if (!activeOrgId || !activeOrg) return;
    try {
      localStorage.setItem(cacheKey(activeOrgId), JSON.stringify(normalizeBrand(activeOrg)));
    } catch {}
  }, [activeOrgId, activeOrg]);

  if (activeOrg) return normalizeBrand(activeOrg);
  return cached;
}

// Друга половина анти-мигання (перша — інлайн boot-скрипт у src/app/layout.js,
// що фарбує [data-app-sb] кешованою темою ДО першого кадру). Тут: щойно
// приїхали живі дані організації — записуємо застосовану тему в кеш для
// наступного перезавантаження і прибираємо boot-стиль, віддаючи владу React.
export function useSidebarThemeBoot(theme, ready, activeOrgId) {
  // Handing the rail back to React is not the same decision as trusting what it
  // is painting. The style has to go the moment this component renders — React
  // always has a theme, even before the organization document arrives, and an
  // `!important` copy of an older one sitting over it wins for as long as it is
  // there. Waiting for `ready` meant that on any load where the organization
  // never arrived — a refused read, a spent quota — the browser kept painting a
  // cached theme for ever, and a change to the colours simply never appeared.
  useEffect(() => {
    document.getElementById('sb-boot-theme')?.remove();
  }, []);

  // Writing the cache is the decision that needs the data to be real: caching a
  // default dark rail for a branded workspace would put the flash back.
  useEffect(() => {
    if (!ready || !theme?.bg || !activeOrgId) return;
    try {
      // Versioned, so that changing how a theme is derived invalidates every
      // copy of the old one — see SIDEBAR_THEME_VERSION.
      localStorage.setItem(
        `qt_sidebar_theme:${activeOrgId}`,
        JSON.stringify({ ...theme, v: SIDEBAR_THEME_VERSION }),
      );
      localStorage.removeItem('qt_sidebar_theme');
    } catch {}
  }, [activeOrgId, theme, ready]);
}
