import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isResolvedOrganization } from '../src/lib/utils/organizationList.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// The mark and the two lines beside it are one object, and centring the text
// *box* on the logo is not the same as centring the words on it. Aligned by box
// alone, the words sat 1.5px above the logo's axis — small, visible, and
// reported twice.
//
// For a column of fixed height H split into a name row and a label row, the
// words land on the centre when
//
//   nameRow = H/2 + (nameInk − labelInk) / 2
//
// The ink is QuickTeam's measurement of the very same two lines, because this
// corner and that one have to be one corner: 10 for the 12px/500 label that
// leads and 17 for the 16px/700 name under it, giving 15 + 21. This file used
// to carry a different measurement of the same pair — 12 and 14, giving
// 17 + 19 — and two measurements of one pair are not both right. The one tuned
// against the rendered rail is the one that stays.

const COLUMN_HEIGHT = 36;
// `qt-workspace/tests/sidebar-brand-lockup.test.mjs`, INK.branded.
const INK = { label: 10, name: 17 };

const labelRowFor = ({ label, name }) =>
  Math.round(COLUMN_HEIGHT / 2 + (label - name) / 2);

test('the brand lockup splits its 36px on the ink, not down the middle', () => {
  assert.equal(labelRowFor(INK), 15);
  assert.equal(COLUMN_HEIGHT - labelRowFor(INK), 21);
  assert.equal(labelRowFor(INK) + (COLUMN_HEIGHT - labelRowFor(INK)), COLUMN_HEIGHT);
});

// There is one lockup, and both readers get it: the small line says what this
// place is, the big line under it names which one you are in.
//
// It used to read the other way round, which put the switcher — a control that
// changes the organization — on the row that says «qTicket», one line below the
// organization it changes. The staff rail had also drawn it in two different
// arrangements before that: «qTicket» big over the tenant's name small when the
// tenant had no branding, the two swapped when it did.
test('the sidebar ships one lockup for both readers', async () => {
  const sidebar = await read('src/components/WorkspaceSidebar.jsx');
  // The two rows, spelled the way the QuickTeam rail spells them.
  const nameLine = /style=\{nameStyle\}/g;
  const labelLine = /fontSize: 12,[\s\S]{0,60}height: 15,[\s\S]{0,60}lineHeight: '15px',[\s\S]{0,60}fontWeight: 500,/g;
  // Written once, not once per reader: `SidebarBrandLockup` takes the two pairs
  // of words as props, so a client's portal and a staff rail cannot drift apart
  // again the way three separate blocks of markup already had.
  // Two spellings of the name row — one inside the switcher, one without it —
  // and one label row above them both. Both name rows read one `nameStyle`, so
  // the switcher and the plain line cannot drift apart.
  assert.equal((sidebar.match(nameLine) || []).length, 2);
  assert.equal((sidebar.match(labelLine) || []).length, 1);
  assert.match(sidebar, /const nameStyle = \{ fontSize: 16, lineHeight: '21px', fontWeight: 700 \};/);
  assert.equal((sidebar.match(/style=\{\{ color: theme\.text, height: 21 \}\}/g) || []).length, 2);
  // The label leads: it is the first of the two lines in the lockup's markup.
  const lockup = sidebar.slice(sidebar.indexOf('function SidebarBrandLockup({'));
  assert.ok(lockup.search(labelLine) < lockup.search(nameLine));
  assert.match(sidebar, /function SidebarBrandLockup\(\{/);
  // One pair of words for both readers: «Портал підтримки» over whoever runs the
  // portal — the provider for a customer, the reader's own company for staff.
  // The staff line used to name the software instead, over an organization that
  // white-labels the rail below it.
  assert.match(sidebar, /label="Портал підтримки"/);
  assert.doesNotMatch(sidebar, /label=\{clientViewer \? .* : 'qTicket'\}/);

  // Branding decides which mark is drawn, never how the words are arranged.
  assert.doesNotMatch(sidebar, /fontSize: isBranded/);
  assert.doesNotMatch(sidebar, /fontWeight: isBranded/);
  assert.doesNotMatch(sidebar, /height: isBranded/);
  assert.doesNotMatch(sidebar, /lineHeight: isBranded/);
  // The old even-looking split is what put the words above the logo.
  assert.doesNotMatch(sidebar, /lineHeight: '16px'/);
  assert.doesNotMatch(sidebar, /lineHeight: '20px'/);
  // The mark and the lines share a centre line rather than a top edge.
  assert.match(sidebar, /flex items-center min-w-0 flex-1/);
});

// A picker of one is a door onto a wall. The rail offered it unconditionally on
// the staff side — chevron, hover, keyboard target and all — to owners who have
// exactly one workspace and nothing to switch to. The client's corner and the
// phone's sheet had both asked the question already.
// The check is proximity rather than scope, because this is source text and not
// a rendered tree: a guard that opens the picker's own branch is within a few
// hundred characters of the control, and a control with no guard of its own
// borrows one from a lockup far above it. `unguardedSwitcherOpeners` is exported
// as a function of the source so the case below can hold the code that shipped
// the defect against it.
const GUARD = '(allOrgs || []).length > 1';
const GUARD_REACH = 600;

function unguardedSwitcherOpeners(source) {
  return [...source.matchAll(/setShowOrgSwitcher\(true\)/g)]
    .map(opener => opener.index)
    .filter(index => {
      const guard = source.slice(0, index).lastIndexOf(GUARD);
      return guard < 0 || index - guard > GUARD_REACH;
    });
}

test('the organization switcher is offered only when there is somewhere to switch to', async () => {
  const [sidebar, mobile] = await Promise.all([
    read('src/components/WorkspaceSidebar.jsx'),
    read('src/components/MobileNav.jsx'),
  ]);
  for (const [name, source] of [['sidebar', sidebar], ['mobile nav', mobile]]) {
    assert.ok(
      /setShowOrgSwitcher\(true\)/.test(source),
      `${name} opens the switcher somewhere`,
    );
    assert.deepEqual(
      unguardedSwitcherOpeners(source),
      [],
      `${name}: a control opens the organization picker without checking there is a second one`,
    );
  }
});

// The test above is only worth having if it fails on the code it was written
// for. The staff rail's opener was a bare `div role="button"` with no check
// anywhere near it, so an owner of exactly one workspace was shown a chevron,
// a hover state and a keyboard target that led to a picker of one.
test('that check fails on the rail that shipped the chevron to everybody', () => {
  const shipped = `
    <div className="flex flex-col min-w-0 ml-[12px]">
      <Link href={homeHref}><h1>qTicket</h1></Link>
      <div
        onClick={() => setShowOrgSwitcher(true)}
        role="button"
        tabIndex={0}
        aria-label="Змінити організацію"
      >
        <span>{activeOrg?.name || 'Company name'}</span>
        <ChevronsUpDown size={12} />
      </div>
    </div>
  `;
  assert.equal(unguardedSwitcherOpeners(shipped).length, 1);
});

// The corner is drawn once, for both readers.
//
// It was drawn by role. A client's branch wrapped `OrganizationMark` in a bare
// anchor and read `portalBrand`; a staff branch drew a raw `<img>` and read
// `activeOrg.name`, with qTicket's own glyph for a tenant without a logo. Three
// things the owner noticed came out of that one fork. The desk name he set in
// QuickTeam's qTicket integration reached the client's rail and not his own.
// The client's corner sat 2px off: an inline-flex mark inside a blockified
// anchor grows a line box with the strut's descent under it — measured, 38px
// against the staff link's 32 — so the logo rose 2px, the two lines dropped 1px
// and everything below the header moved down 2px. And the kit's `sidebar`
// appearance painted `--sb-active` under the client's logo, a translucent plate
// the staff corner beside it never had. One brand, one link, one mark; the
// ground stays only under a fallback initial, which needs a shape to sit in.
test('the corner is drawn once, for both readers', async () => {
  const [sidebar, mobile, mark, cache, store] = await Promise.all([
    read('src/components/WorkspaceSidebar.jsx'),
    read('src/components/MobileNav.jsx'),
    read('src/components/ui/DataDisplay/OrganizationMark.jsx'),
    read('src/lib/hooks/useCachedOrgBranding.js'),
    read('src/store/useWorkspaceStore.js'),
  ]);

  for (const [name, source] of [['sidebar', sidebar], ['mobile nav', mobile]]) {
    // Neither the name nor the logo is chosen by who is looking.
    assert.doesNotMatch(source, /clientViewer \? portalBrand/, `${name}: the brand is picked by role`);
    assert.doesNotMatch(source, /activeOrg\?\.name/, `${name}: the corner reads the organization's own name`);
    assert.match(source, /name=\{portalBrand\.name\}/, name);
    assert.match(source, /logo=\{portalBrand\.logo\}/, name);
    // And neither is the colour: one brand, or its cached copy before the
    // organization document arrives, turned into a rail colour by the one
    // function the invitation landing page also uses. No preview from a
    // settings editor that no longer exists, no second ladder of presets.
    assert.match(source, /const portalBrand = orgBrand \? \{ \.\.\.liveBrand, \.\.\.orgBrand \} : liveBrand;/, name);
    assert.match(source, /const \{ sidebarTheme, sidebarColor \} = portalBrand;/, name);
    assert.match(source, /computeSidebarTheme\(organizationPortalBackground\(\{ sidebarTheme, sidebarColor \}\)\)/, name);
    assert.doesNotMatch(source, /sidebarPreview|isBranded|SIDEBAR_PRESETS|customBranding/, name);
  }

  // One mark, in a link that is a 32px block — the same box QuickTeam's rail
  // gives its logo, so the mark and the two lines beside it share one axis.
  assert.equal((sidebar.match(/<OrganizationMark/g) || []).length, 1);
  assert.match(
    sidebar,
    /<Link\s+href=\{homeHref\}\s+className="block h-\[32px\] w-\[32px\][^"]*"[^>]*>\s*<OrganizationMark/,
  );
  assert.doesNotMatch(sidebar, /<img\s+src=/);
  assert.doesNotMatch(sidebar, /qticket_white\.svg|from 'next\/image'/);
  // One accessible name for the switcher: the one the phone's sheet and
  // QuickTeam's rail already use. «Змінити портал підтримки» was the client's
  // half of the fork.
  assert.match(sidebar, /switchLabel="Змінити організацію"/);
  assert.doesNotMatch(sidebar, /Змінити портал підтримки/);

  // The kit paints no ground under a logo on the rail, and keeps one under the
  // initial. `APPEARANCE_CLASSES` stays a lookup map with the same three keys —
  // `scripts/kit-variants.mjs` reads variants from maps like it — and the
  // ground moves to a second map that is applied only when no image is shown.
  const sidebarEntry = mark.match(/const APPEARANCE_CLASSES = \{[\s\S]*?sidebar: '([^']*)'/)?.[1] || '';
  assert.ok(sidebarEntry.length > 0, 'the sidebar appearance is declared');
  assert.doesNotMatch(sidebarEntry, /bg-/);
  assert.match(mark, /const INITIAL_GROUND = \{[\s\S]*?sidebar: 'bg-\[var\(--sb-active\)\]'/);
  assert.match(mark, /showImage \? '' : \(INITIAL_GROUND\[appearance\] \|\| ''\)/);
  // The other two appearances keep their ground under a logo: a bordered
  // canvas tile under a wordmark is the design in lists and in the picker.
  assert.match(mark, /surface: 'border border-line bg-canvas text-ink'/);
  assert.match(mark, /inverse: 'border-\[3px\] border-transparent bg-surface-dark text-white'/);

  // The cache is the same brand, whole. It answered `null` for a tenant with
  // no logo, so a tenant with a colour and no logo got the default dark rail on
  // the staff side while the client got the colour.
  assert.match(cache, /const \{ name, logo, sidebarTheme, sidebarColor \} = resolveOrganizationPortalBrand\(org\);/);
  assert.doesNotMatch(cache, /if \(!brand\.logo\) return null|customBranding: true/);

  // And nothing previews a brand: qTicket does not edit it, QuickTeam does.
  assert.doesNotMatch(store, /sidebarPreview|setSidebarPreview|clearSidebarPreview/);
});

// Кут рейки на пару кадрів підписувався дефолтом — словом «Підтримка» на
// стандартному чорному, — і це було не миготіння завантаження, а помилка.
//
// Список організацій публікує за членство, чий документ ще не приїхав,
// заглушку `{ id, pending: true }`: простір лишається досяжним, поки по
// документ ідуть ще раз. Брендинг питав рівно «чи є організація», заглушка
// відповідала «є», і назва з кольором бралися з порожнечі. Гірше: обидва кеші
// анти-мигання записувались із тієї ж заглушки, тому наступне завантаження
// стартувало з дефолту знову — кеш, який існує проти мигання, сам його й
// відтворював.
test('заглушка на час читання не є брендом', async () => {
  const [list, cache, sidebar, nav] = await Promise.all([
    read('src/lib/utils/organizationList.mjs'),
    read('src/lib/hooks/useCachedOrgBranding.js'),
    read('src/components/WorkspaceSidebar.jsx'),
    read('src/components/MobileNav.jsx'),
  ]);

  assert.equal(isResolvedOrganization({ id: 'a', name: 'Acme' }), true);
  assert.equal(isResolvedOrganization({ id: 'a', pending: true }), false);
  assert.equal(isResolvedOrganization(null), false);
  assert.match(list, /export function isResolvedOrganization\(organization\)/);

  // Кеш віддає бренд саме в ту мить, для якої він і є, і не пише в себе те,
  // чого в заглушці немає.
  assert.match(cache, /const organization = isResolvedOrganization\(activeOrg\) \? activeOrg : null;/);
  assert.match(cache, /if \(!activeOrgId \|\| !organization\) return;/);
  assert.match(cache, /writeCachedBrand\(activeOrgId, normalizeBrand\(organization\)\);/);
  assert.match(cache, /if \(organization\) return normalizeBrand\(organization\);/);
  assert.doesNotMatch(cache, /if \(activeOrg\) return normalizeBrand\(activeOrg\);/);

  // Отруєні записи вже лежать у браузерах, тож старий зразок викидається разом.
  assert.match(cache, /const BRAND_CACHE_VERSION = 1;/);
  assert.match(cache, /if \(!stored \|\| stored\.v !== BRAND_CACHE_VERSION\) return null;/);

  // Обидва читачі бренду: тема пишеться в кеш лише з живого документа, а знак і
  // назва чекають на нього або на кеш — не на заглушку.
  for (const [surface, source] of [['rail', sidebar], ['phone', nav]]) {
    assert.match(source, /const resolvedOrg = isResolvedOrganization\(activeOrg\) \? activeOrg : null;/, surface);
    assert.match(source, /useSidebarThemeBoot\(theme, Boolean\(resolvedOrg\), activeOrgId\)/, surface);
    assert.doesNotMatch(source, /useSidebarThemeBoot\(theme, Boolean\(activeOrg\)/, surface);
    // Кеш накладається на живі поля, а не стоїть замість них: коли документ
    // приїхав, обидва джерела дають ті самі чотири поля.
    assert.match(source, /const portalBrand = orgBrand \? \{ \.\.\.liveBrand, \.\.\.orgBrand \} : liveBrand;/, surface);
  }
  assert.match(sidebar, /const brandingReady = Boolean\(resolvedOrg\) \|\| Boolean\(orgBrand\);/);
});

// Колір малювався до першого кадру — і жив кілька мілісекунд.
//
// Boot-стиль знімався на монтуванні рейки. Рейка ж монтується не тоді, коли
// організація готова, а тоді, коли список організацій перестав вантажитись, —
// тобто вже на заглушках. Тому намальоване зникало майже одразу, і далі
// стояла стандартна темна тема, доки не відповість `/api/organizations`; на
// холодній серверній функції це секунди, і всі вони показували рівно той
// дефолт, проти якого весь цей механізм і зроблений.
test('намальоване до першого кадру тримається до живого документа', async () => {
  const cache = await read('src/lib/hooks/useCachedOrgBranding.js');

  // Стиль іде тієї миті, коли є чим його замінити…
  assert.match(cache, /if \(ready\) \{\s*\n\s*releaseRail\(\);/);
  // …і сходить сам, якщо замінити нічим і не буде чим: інакше `!important`
  // поверх React-змінних тримав би кешований колір вічно на завантаженні, де
  // організація не приїде ніколи.
  assert.match(cache, /const BOOT_THEME_HOLD_MS = 15_000;/);
  assert.match(cache, /const timer = window\.setTimeout\(releaseRail, BOOT_THEME_HOLD_MS\);/);
  assert.match(cache, /return \(\) => window\.clearTimeout\(timer\);\s*\n\s*\}, \[ready\]\);/);

  // Не на монтуванні. Це і був увесь баг.
  assert.doesNotMatch(
    cache,
    /document\.getElementById\('sb-boot-theme'\)\?\.remove\(\);\s*\n\s*\}, \[\]\);/,
  );
});

// Анти-мигання не працювало рівно там, де воно найпотрібніше, — у новій
// вкладці. Вибір організації живе в `sessionStorage`, нова вкладка його не
// має, і boot-скрипт виходив ні з чим: рейка спалахувала стандартною темною
// темою при кожному вході з нової вкладки, і тільки з неї.
test('нова вкладка знає, який колір малювати до першого кадру', async () => {
  const layout = await read('src/app/layout.js');

  // Скрипт вбудований у сторінку рядком, тож і перевіряється він як код: цей
  // шматок виймається з джерела й виконується. Інакше тест пильнував би текст,
  // який ніхто не запускав, — а це саме той код, у якому помилка не падає, а
  // мовчки нічого не фарбує.
  assert.ok(layout.includes('${BOOT_ORGANIZATION}if(!o)return;'));
  const [, lookup] = /const BOOT_ORGANIZATION = `([^`]*)`;/.exec(layout);

  const storage = entries => {
    const keys = Object.keys(entries);
    return {
      length: keys.length,
      key: index => (index in keys ? keys[index] : null),
      getItem: name => (name in entries ? entries[name] : null),
    };
  };
  const chosen = (search, session, local) => new Function(
    'location', 'sessionStorage', 'localStorage',
    `${lookup} return o;`,
  )({ search }, storage(session), storage(local));

  // Адреса важить більше за вкладку, вкладка — більше за пам'ять браузера.
  assert.equal(chosen('?org=from-link', { qt_active_org_id: 'from-tab' }, {}), 'from-link');
  assert.equal(chosen('', { qt_active_org_id: 'from-tab' }, { 'qt_last_org_id:u1': 'from-memory' }), 'from-tab');
  assert.equal(chosen('', {}, { 'qt_last_org_id:u1': 'from-memory' }), 'from-memory');
  assert.equal(chosen('?org=%D1%84', {}, {}), 'ф');

  // Рівно один запам'ятований акаунт. Два — і вгадувати нема з чого: кадр
  // стандартної теми кращий за кадр чужого кольору.
  assert.ok(!chosen('', {}, { 'qt_last_org_id:u1': 'one', 'qt_last_org_id:u2': 'two' }));
  assert.ok(!chosen('', {}, { qt_sidebar_collapsed: '1' }));
  assert.ok(!chosen('', {}, {}));
});
