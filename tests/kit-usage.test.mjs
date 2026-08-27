import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { scanKitUsage } from '../scripts/scan-kit-usage.mjs';
import { auditUiFidelity } from '../scripts/audit-ui-fidelity.mjs';
import { readShowcase } from '../scripts/ui-kit-showcase.mjs';

const committed = JSON.parse(
  readFileSync(new URL('../src/app/ui-kit/kit-usage.generated.json', import.meta.url), 'utf8'),
);
const committedFidelityAudit = JSON.parse(
  readFileSync(new URL('../src/app/ui-kit/fidelity-audit.generated.json', import.meta.url), 'utf8'),
);

// This is the whole anti-drift mechanism. /ui-kit is hand-written, so it had no
// way of knowing what the product uses and slowly stopped describing the site.
// The status screen now reads generated data — and this test is what keeps that
// data true: start using a kit component, or stop, and the build fails until
// `npm run kit:scan` is run.
test('the committed kit usage data matches the code', () => {
  const fresh = scanKitUsage();
  assert.deepEqual(
    fresh,
    committed,
    'kit-usage.generated.json is stale — run `npm run kit:scan` and commit the result',
  );
});

test('the committed UI fidelity audit matches every product UI file', () => {
  assert.deepEqual(
    auditUiFidelity(),
    committedFidelityAudit,
    'fidelity-audit.generated.json is stale — run `npm run kit:audit` and review every changed drift category',
  );
  assert.equal(committedFidelityAudit.totals.parseErrors, 0);
  assert.deepEqual(committedFidelityAudit.parseErrors, []);
});

// One reference page, and it is a catalogue of components. There used to be
// three: /ui-diff listed duplicate patterns and /ui-audit listed the 145
// hand-written controls that bypass the kit — both reports wearing a
// catalogue's clothes, which meant no single page answered "what can I build
// with?". The audit still runs and still fails the build; it no longer has a
// screen, because a screen full of raw markup taught nobody anything.
test('the catalogue is the only reference page, and it lists components', () => {
  const kit = readShowcase().everything;
  const app = new URL('../src/app/', import.meta.url);
  const pages = readdirSync(app).filter(name => name.startsWith('ui-'));

  assert.deepEqual(
    pages,
    ['ui-kit'],
    `stray reference pages: ${pages.join(', ')}`,
  );
  assert.doesNotMatch(kit, /SurfaceElements|surface-chat|CHAT_CONTROLS|fidelity-audit\.generated/);
  assert.match(kit, /Чат — власна шкала аватарів/, '/ui-kit keeps the chat components it really owns');
});

// The kit is the source of truth only while the product stays inside what the
// kit declares. These two numbers being zero is the whole invariant: a new
// undeclared variant or a new className override fails the build here.
test('new UI work cannot silently grow the audited drift baseline', () => {
  const maximums = {
    manualLabels: 0,
    manualModalShells: 0,
    manualPills: 0,
    manualSurfaces: 0,
    manualIconButtons: 0,
    headingStyles: 0,
    sharedChromeOverrides: 0,
    localSharedNameCollisions: 0,
    localSurfaceExceptions: 68,
    reviewedNativeControls: 19,
    // The one number that had no ceiling, which is why it reached 145: every
    // other category was pinned at zero, so new hand-written markup simply
    // landed here and the report grew without anything objecting. It may fall
    // freely; raising it has to be a decision somebody makes on purpose.
    //
    // 18 → 19, on purpose: the «Ще» sheet gained a help section, and its rows
    // are the sheet's own row — the sidebar's theme variables, the 40px height
    // and the radius the two lists above them already use. Those two are
    // `Link`s because they navigate; these open a dialog in place. Nothing in
    // the kit is that row: `ListRow` is a light divided-list row with its own
    // hover, and dressing it for a dark sheet would be the chrome override this
    // audit exists to prevent. Marked `data-ui-control="navigation-sheet-row"`.
    //
    // 19 → 20, on purpose: a profile's phone number and email address are now
    // copied by clicking them. What that draws is a line of text in a
    // two-column contact grid — the same 13px value the Telegram handle beside
    // them has always been — and a `Button` there would put a control box
    // where a value belongs and move every row of the grid on the desktop. The
    // kit has no "a value you can click" component, and inventing one for two
    // lines would be a component nothing else reaches for. Marked
    // `data-ui-control="profile-contact-value"`.
    //
    // 20 → 21, on purpose: the sign-in shell's footer can now open support.
    // That footer is a row of quiet 12px links — the documents and the
    // language — and support is one more word in it that happens to open a
    // dialog instead of navigating. A `Button` there would put a control box
    // in a line of text and make the loudest thing on the screen the footer,
    // on a screen whose entire job is the three sign-in buttons above it.
    // Marked `data-ui-control="auth-footer-support"`.
    nativeControls: 21,
  };
  for (const [category, maximum] of Object.entries(maximums)) {
    assert.ok(
      committedFidelityAudit.totals[category] <= maximum,
      `${category} grew from the audited baseline (${maximum}) to ${committedFidelityAudit.totals[category]}; reuse the UI Kit or add an approved named context`,
    );
  }
  assert.deepEqual(
    committedFidelityAudit.repeatedNativeFingerprints,
    [],
    'Repeated native-control fingerprints must become a shared component/preset or receive an explicit reviewed context',
  );

  // This used to carry a 32-name allowlist of components nothing rendered.
  // They are gone — deleted, not excused — so the exception list is gone too.
  assert.deepEqual(
    committedFidelityAudit.kit.unusedComponents,
    [],
    'A shared component must be used by the product and shown in /ui-kit in the '
    + `same change, or deleted: ${committedFidelityAudit.kit.unusedComponents.join(', ')}`,
  );
});

test('the durable repository instructions keep product and UI Kit changes atomic', () => {
  const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  const contract = readFileSync(new URL('../docs/UI_KIT_CONTRACT.md', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  assert.match(agents, /Treat the authenticated workspace and `\/ui-kit` as one UI contract/);
  assert.match(agents, /used by the product, and rendered in `\/ui-kit` in the same change/);
  assert.match(agents, /npm run kit:scan/);
  assert.match(agents, /npm run kit:audit/);
  assert.match(contract, /A new shared component is exported[\s\S]*used by[\s\S]*rendered in `\/ui-kit` in the same change/);
  assert.equal(packageJson.scripts['kit:audit'], 'node scripts/audit-ui-fidelity.mjs');

  // AGENTS.md and docs/UI_KIT_CONTRACT.md described `kit:drift`, a variant
  // matrix and a kit-drift.generated.json for months while none of the three
  // existed — the canonical rules file told every next session to run a command
  // that was not there. Documentation may only name commands that resolve.
  for (const command of [...agents.matchAll(/`npm run ([\w:]+)`/g)].map(match => match[1])) {
    assert.ok(
      command in packageJson.scripts,
      `AGENTS.md tells the reader to run \`npm run ${command}\`, which package.json does not define`,
    );
  }
  for (const command of [...contract.matchAll(/`npm run ([\w:]+)`/g)].map(match => match[1])) {
    assert.ok(
      command in packageJson.scripts,
      `docs/UI_KIT_CONTRACT.md names \`npm run ${command}\`, which package.json does not define`,
    );
  }
  assert.equal(packageJson.scripts['kit:drift'], 'node scripts/check-kit-drift.mjs');
});

// The screen that recorded these decisions is gone; the decisions themselves are
// product behaviour and still have to hold.
test('the approved follow-up decisions stay encoded in the product', () => {
  const taskList = readFileSync(new URL('../src/components/ui/TaskManagement/TaskListView.jsx', import.meta.url), 'utf8');
  const taskRow = readFileSync(new URL('../src/components/ui/TaskManagement/TaskRow.jsx', import.meta.url), 'utf8');
  const createTask = readFileSync(new URL('../src/components/CreateTaskModal.jsx', import.meta.url), 'utf8');
  const issueDetail = readFileSync(new URL('../src/components/workspace/IssueDetail.jsx', import.meta.url), 'utf8');
  const agileBoard = readFileSync(new URL('../src/components/workspace/AgileBoard.jsx', import.meta.url), 'utf8');
  const issueCard = readFileSync(new URL('../src/components/workspace/IssueCard.jsx', import.meta.url), 'utf8');
  const myTasks = readFileSync(new URL('../src/app/(app)/my/page.js', import.meta.url), 'utf8');
  const project = readFileSync(new URL('../src/app/(app)/[projectId]/ProjectBoardClient.jsx', import.meta.url), 'utf8');
  assert.match(taskList, /hiddenGroupIds = \[\]/);
  // A section is a status, or a status category on a list that spans projects.
  assert.match(taskList, /const groups = byCategory \? categoryColumns : statuses;/);
  assert.match(taskList, /label: 'Приховані'/);
  assert.match(taskList, /showProjectName=\{showProjectName\}/);
  assert.match(taskRow, /showProjectName = false/);
  // The row hands the decision to `TaskIdentity`, which is where the key, the
  // project and the parent are drawn for both the row and the board card.
  assert.match(taskRow, /showProjectName=\{showProjectName\}/);
  const taskIdentity = readFileSync(new URL('../src/components/ui/TaskManagement/TaskIdentity.jsx', import.meta.url), 'utf8');
  assert.match(taskIdentity, /showProjectName && Boolean\(projectName\)/);
  assert.match(myTasks, /hiddenGroupIds=\{hiddenCategories\}/);
  assert.match(project, /hiddenGroupIds=\{project\?\.hiddenColumns \|\| \[\]\}/);
  assert.match(myTasks, /<AgileBoard[\s\S]{0,500}showHiddenLane/);
  assert.match(myTasks, /<AgileBoard[\s\S]{0,600}onRequestAddIssue=/);
  assert.doesNotMatch(project, /<AgileBoard[\s\S]{0,700}showHiddenLane/);

  assert.match(createTask, /types\.filter\(type => type\.id !== 'epic'\)/);
  assert.match(createTask, /options=\{creatableTypes\.map/);
  assert.match(issueDetail, /parentIssueId: issueId/);
  assert.match(issueDetail, /legacy-checklist/);
  assert.doesNotMatch(issueDetail, /update\(\{\s*subtasks|subtasks:\s*arrayUnion/);
  assert.match(issueDetail, /ISSUE_LINK_OPTIONS/);
  // QUI-127 approved the opposite of what this used to assert: a subtask keeps
  // its own status, so it is a card of its own in whatever column that status
  // puts it in, and the card names its parent to keep the hierarchy readable.
  // Collapsing children into the parent hid real work from its column, so the
  // `collapseHierarchy` prop and its filter are gone for good.
  assert.doesNotMatch(agileBoard, /collapseHierarchy/);
  assert.doesNotMatch(project, /collapseHierarchy/);
  assert.match(agileBoard, /const boardIssues = issues;/);
  // The parent is passed to `TaskIdentity`, which draws it behind a real icon.
  // It used to be the literal character "↳" written into both the card and the
  // row — a glyph with no consistent metrics across the font stack, which is
  // what made it sit crooked against the text beside it.
  assert.match(issueCard, /parentIssue=\{parentIssueId \? \(parentIssue \|\| \{ issueKey: '' \}\) : null\}/);
  const identity = readFileSync(new URL('../src/components/ui/TaskManagement/TaskIdentity.jsx', import.meta.url), 'utf8');
  const taskPage = readFileSync(new URL('../src/components/workspace/IssueDetail.jsx', import.meta.url), 'utf8');
  // One glyph for one relation, and it lives in `design/icons` rather than at
  // either call site: the board card drew the arrow and the task page drew
  // `Layers`, so "this hangs under that" looked like two different facts
  // depending on which screen you read it on.
  for (const source of [identity, taskPage]) {
    assert.match(source, /<ParentTaskIcon/);
  }
  assert.doesNotMatch(taskPage, /<Layers/);
  // Rendered, not merely mentioned — the component's own comment explains why
  // the character was dropped, so the check is for it appearing in JSX.
  for (const source of [issueCard, taskRow, identity]) {
    assert.doesNotMatch(source, /^(?!\s*(\/\/|\*)).*>\s*↳/m);
  }
  assert.doesNotMatch(agileBoard, /parentEpicId|swimlane === 'epic'/);
});

test('usage requires an imported component to be rendered as JSX', () => {
  const { components } = committed;
  // `Stat` matched every `useState`/`Status` and `Grid` every `grid` class, so
  // a substring scan called both heavily used while nothing imported them. Both
  // components are gone now; `Tag` and `Card` carry the same hazard (`TagIcon`,
  // `KpiCard`, `ProjectCard`) and are live, so the guard moves to them.
  for (const name of ['Tag', 'Card']) {
    assert.ok(name in components, `${name} should be in the inventory`);
    for (const file of components[name].usedIn) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.match(
        source,
        new RegExp(`^import[^;]*\\b${name}\\b[^;]*from\\s+['"]@/components/ui`, 'm'),
        `${file} is listed as using ${name} but does not import it`,
      );
    }
  }

  // A file that only renames another component is not a component. `TaskCard`
  // was `export default IssueCard`, so it could never be "used" — every call
  // site imports the real one — and it sat in the unused list permanently.
  assert.ok(!('TaskCard' in components), 'a pure re-export must not enter the inventory');
});

test('every recorded usage really imports the component it is credited with', () => {
  for (const [name, entry] of Object.entries(committed.components)) {
    assert.equal(entry.count, entry.usedIn.length, `${name}: count and usedIn disagree`);
    for (const file of entry.usedIn) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.match(source, /@\/components\/ui/, `${file} credited to ${name} imports nothing from the kit`);
      // A call site may rename what it imports — WorkspaceToastHost renders
      // `<UiToast>` — so the local binding is what has to appear in the JSX,
      // not the exported name.
      const aliased = source.match(
        new RegExp(`^import\\s+(\\w+)\\s+from\\s+['"][^'"]*/${name}['"]`, 'm'),
      );
      const rendered = aliased?.[1] || name;
      assert.match(
        source,
        new RegExp(`<${rendered}\\b`),
        `${file} is credited to ${name} but never renders it`,
      );
    }
  }
});

test('the showcase pages are never counted as product usage', () => {
  for (const [name, entry] of Object.entries(committed.components)) {
    for (const file of entry.usedIn) {
      assert.ok(
        !file.startsWith('src/app/ui-kit/') && !file.startsWith('src/components/ui/'),
        `${name} is credited to ${file}, which is the kit or the showcase page`,
      );
    }
  }
});

test('components known to be live are reported as live', () => {
  // Regression guard for a real bug in the scanner: the import pattern used to
  // span statements, so the capture ran from a file's first import to its first
  // kit import and silently swallowed the names in between. These two are
  // imported on a line of their own, far down the file — exactly the shape that
  // was being lost.
  for (const name of ['ConfirmProvider', 'TopHeader', 'Button', 'Select']) {
    assert.ok(committed.components[name].count > 0, `${name} should be reported as used`);
  }
});

test('every UI component used by the product is showcased in /ui-kit', () => {
  const uncovered = Object.entries(committed.components)
    .filter(([, entry]) => entry.count > 0 && !entry.showcased)
    .map(([name]) => name);
  const showcasedButDead = Object.entries(committed.components)
    .filter(([, entry]) => entry.count === 0 && entry.usedByKit.length === 0 && entry.showcased)
    .map(([name]) => name);

  assert.deepEqual(
    uncovered,
    [],
    `Live product components missing from /ui-kit: ${uncovered.join(', ')}`,
  );
  assert.equal(committed.totals.uncovered, 0);

  // Coverage is owed by what the product calls directly. Breadcrumb and
  // HeaderSearch are reached only through TopHeader, so every TopHeader preview
  // already shows them; a preview of either alone would demonstrate a shape the
  // product never renders on its own.
  assert.equal(committed.totals.covered + committed.totals.internal, committed.totals.used);

  // The original invariant, unchanged: nothing dead may pass itself off as UI.
  assert.deepEqual(
    showcasedButDead,
    [],
    `Unreachable components must not be counted as coverage: ${showcasedButDead.join(', ')}`,
  );
});

// The other half of that rule used to have no owner: hiding an unused component
// kept coverage honest but also made it invisible, so the only way to learn one
// existed was to read the directory, and every few months one got rebuilt by
// hand. Thirty-one had accumulated that way — over a third of the kit — and
// half of them duplicated something already live (Avatar beside UserAvatar,
// Badge beside Pill, Chip beside Tag). They are deleted. Unused now means gone.
test('nothing in the kit is unused', () => {
  const unlisted = Object.entries(committed.components)
    .filter(([, entry]) => entry.count === 0 && entry.usedByKit.length === 0)
    .map(([name]) => name);

  assert.deepEqual(
    unlisted,
    [],
    `A component nothing reaches must be deleted, not left in the barrel: ${unlisted.join(', ')}`,
  );
  assert.equal(committed.totals.unlisted, 0);
  assert.equal(committed.totals.unused, 0);
});

// A component the product reaches only *through* another component is used, and
// the workspace scan cannot see it: it stops at the kit boundary on purpose. So
// TopHeader rendered Breadcrumb and HeaderSearch on every screen while both
// reported zero usages — and a cleanup pass believed the zero and deleted them.
test('a component used only by another kit component still counts as used', () => {
  for (const name of ['Breadcrumb', 'HeaderSearch']) {
    const entry = committed.components[name];
    assert.ok(entry, `${name} should be in the inventory`);
    assert.equal(entry.count, 0, `${name} is expected to have no direct product usage`);
    assert.ok(
      entry.usedByKit.includes('TopHeader'),
      `${name} is rendered by TopHeader and must be recorded as such`,
    );
  }
  assert.ok(committed.totals.internal > 0);
});

// `import UiToast from '@/components/ui/Feedback/Toast'` binds a local name the
// inventory has never heard of. Matching on that alone reported `Toast` unused
// while WorkspaceToastHost rendered it on every screen — a default export has
// no name of its own, so the file it comes from has to be the name.
test('a renamed default import is credited to the component it imports', () => {
  const toast = committed.components.Toast;
  assert.ok(toast.count > 0, 'Toast is rendered by WorkspaceToastHost');
  assert.ok(toast.usedIn.some(file => file.endsWith('WorkspaceToastHost.jsx')));
});

test('high-risk composed previews keep the product markup signatures', () => {
  const kit = readShowcase().everything;
  const chat = readFileSync(new URL('../src/app/(app)/chat/page.js', import.meta.url), 'utf8');
  const projects = readFileSync(new URL('../src/app/(app)/page.js', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/app/(app)/settings/page.js', import.meta.url), 'utf8');
  const issueDetail = readFileSync(new URL('../src/components/workspace/IssueDetail.jsx', import.meta.url), 'utf8');
  const calendarEvent = readFileSync(new URL('../src/components/workspace/calendar/CalendarEventPage.jsx', import.meta.url), 'utf8');
  const timeline = readFileSync(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');
  const qtPlusComposer = readFileSync(new URL('../src/components/workspace/qtplus/chat/ChatComposer.jsx', import.meta.url), 'utf8');
  const composerCore = readFileSync(new URL('../src/components/ui/ChatComposerCore.jsx', import.meta.url), 'utf8');
  const taskAttributes = readFileSync(new URL('../src/components/ui/Layout/TaskAttributesPanel.jsx', import.meta.url), 'utf8');

  for (const signature of [
    // A border plus a focus shadow drew two concentric outlines around one
    // box; the workspace chat wears the same single ring the task-page chat
    // does, keeping only its own corner radius.
    'overflow-hidden rounded-2xl bg-white ring-1 ring-black/[0.04] transition-all hover:ring-black/10 focus-within:ring-4 focus-within:ring-black/10 focus-within:shadow-[0_12px_40px_rgb(0,0,0,0.08)]',
    'w-full px-4 py-3.5 text-[14px] text-ink placeholder-placeholder bg-transparent outline-none resize-none max-h-[200px] leading-relaxed',
    'overflow-hidden rounded-[24px] bg-white ring-1 ring-black/[0.04] transition-all hover:ring-black/10 focus-within:ring-4 focus-within:ring-black/10 focus-within:shadow-[0_12px_40px_rgb(0,0,0,0.08)]',
    'custom-scrollbar min-h-[36px] max-h-[120px] flex-1 resize-none border-0 bg-transparent px-1.5 py-2 text-[14px] leading-5 text-ink outline-none placeholder:text-muted',
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-transform hover:scale-105 disabled:bg-faint disabled:hover:scale-100',
    'flex min-h-[44px] items-end gap-1 rounded-[24px] bg-white p-1 ring-1 ring-black/[0.04] transition-all focus-within:ring-4 focus-within:ring-black/10 focus-within:shadow-[0_12px_40px_rgb(0,0,0,0.08)]',
    'max-h-[120px] min-h-[36px] flex-1 resize-none bg-transparent px-3 py-2 text-[14px] leading-5 text-ink outline-none placeholder:text-muted disabled:opacity-50',
  ]) {
    assert.ok(composerCore.includes(signature), `shared composer core lost product geometry: ${signature}`);
  }
  assert.match(chat, /<ChatComposerCore[\s\S]*variant="workspace"/);
  assert.match(timeline, /<ChatComposerCore[\s\S]*variant="timeline"/);
  assert.match(qtPlusComposer, /<ChatComposerCore[\s\S]*variant="qtplus"/);
  for (const variant of ['workspace', 'timeline', 'qtplus']) {
    assert.match(kit, new RegExp(`<ChatComposerCore[\\s\\S]{0,220}variant="${variant}"`));
  }

  assert.match(projects, /<EmptyState[\s\S]{0,1200}context="page"/);
  assert.match(kit, /<EmptyState[\s\S]{0,1200}context="page"/);
  assert.doesNotMatch(projects, /<EmptyState[\s\S]{0,320}className="min-h-\[328px\]"/);

  // Both attribute strips condense on scroll (QUI-123). The event card used to
  // keep its selects pinned at full height inside the sticky header while the
  // task card collapsed its labels and faded behind it, so the same control
  // behaved differently depending on which record you had open.
  //
  // The scroll container itself is no longer either page's: both hand their
  // title, strip and sections to `DetailLayout`, which owns the scrollport, the
  // threshold, the sticky box and the fade. That is what makes "the same page"
  // true structurally rather than by two files agreeing to match.
  const detailLayout = readFileSync(new URL('../src/components/ui/Layout/DetailLayout.jsx', import.meta.url), 'utf8');
  assert.match(detailLayout, /scrollTop > 4/);
  for (const source of [issueDetail, calendarEvent]) {
    assert.match(source, /getTaskAttributeChrome\(\{ condensed: isHeaderScrolled \}\)/);
    assert.match(source, /condensed=\{isHeaderScrolled\}/);
    assert.match(source, /<DetailLayout[\s\S]{0,400}scrolled=\{isHeaderScrolled\}/);
    assert.match(source, /onScrolledChange=\{setIsHeaderScrolled\}/);
  }
  // The header allowance is the difference that made the two pages scroll
  // differently: the task reserved it above its scroller and the event on it,
  // so the event's sticky title parked under the fixed header. Neither page
  // reserves it any more — `.ui-detail-shell` does, once.
  for (const source of [issueDetail, calendarEvent]) {
    assert.doesNotMatch(source, /pt-\[56px\]/, 'the fixed-header allowance belongs to the shell');
  }
  // The conversation rail holds still, and one number is why. A sticky box
  // cannot leave its containing block — here the grid area, which ends where
  // the content ends while the scroll runs on for the room under the page. A
  // rail as tall as the whole scrollport had no room left in exactly that
  // stretch and got shoved up by it at the end of every scroll. So the rail's
  // height subtracts the same `--ui-detail-bottom` everything else measures
  // from, and it may not be written as a length at a call site again.
  //
  // The scrollport itself is measured rather than derived from the window. It
  // was `100dvh` less a written-down allowance for the fixed header and the
  // shell's inset, which holds only while nothing is ever put above the content
  // panel — and a strip announcing a spent plan ceiling was, pushing the panel
  // down by its own height. The rail then stood taller than its column: its
  // composer hung below the bottom edge and the reading column's floor floated
  // up into the middle of the page.
  const detailCss = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  const aside = detailCss.slice(detailCss.lastIndexOf('.ui-detail-aside {'));
  assert.ok(
    aside.includes('var(--ui-detail-scrollport, calc(100dvh - var(--ui-detail-viewport-inset)))'),
    'the rail measures the scrollport instead of deriving it from the window',
  );
  assert.ok(
    aside.includes('- var(--ui-detail-bottom)'),
    'the rail is the scrollport minus the room it is not allowed into',
  );
  assert.ok(
    detailLayout.includes("setProperty('--ui-detail-scrollport'"),
    'nothing publishes what the scrollport actually measures',
  );
  assert.doesNotMatch(detailLayout, /pb-\[\d+px\]/, 'the room under the page is a variable, not a class');
  // And that room belongs to the document, not to the scrollport. As the
  // scroller's own padding it sat *below* the floor — sticky `bottom: 0` lands
  // on the scroller's content edge — so the last stretch of the reading area
  // kept showing content under a line claiming to be the bottom.
  assert.doesNotMatch(
    detailCss,
    /\.ui-detail-scroll\s*\{[^}]*padding-bottom/,
    'the room at the end of the page is the floor’s height, not the scroller’s padding',
  );
  assert.match(detailCss, /\.ui-detail-scroll \.scroll-shadow--bottom \{\s*height: var\(--ui-detail-bottom\);/);
  // Below the grid the rail is the whole pane, and the reading column that
  // carries the floor is not rendered — so the rail asks for the room itself,
  // and only there. Above the grid its shortened height already is the gap.
  assert.match(
    detailCss,
    /@media \(max-width: 1023px\) \{[\s\S]{0,400}?\.ui-detail-aside \{\s*padding-bottom: var\(--ui-detail-bottom\);/,
  );
  const railAtDesktop = detailCss.slice(detailCss.indexOf('@media (min-width: 1024px)'));
  assert.doesNotMatch(
    railAtDesktop.slice(0, railAtDesktop.indexOf('}\n  }') + 5),
    /padding-bottom/,
    'the gap under the rail is its shortened height, not a second padding',
  );
  // The board's two walls and the detail page's floor are one edge with one
  // depth and one duration. The board's came first and was named after it; a
  // second screen wanting the same gesture is what makes the name wrong.
  const agileBoardSource = readFileSync(new URL('../src/components/workspace/AgileBoard.jsx', import.meta.url), 'utf8');
  for (const [name, source] of Object.entries({ AgileBoard: agileBoardSource, DetailLayout: detailLayout })) {
    assert.match(source, /className="scroll-shadow scroll-shadow--/, `${name} draws the shared edge`);
    assert.doesNotMatch(source, /kanban-scroll-shadow/, `${name} must not keep a screen-specific copy`);
  }
  assert.doesNotMatch(detailCss, /kanban-scroll-shadow/, 'the edge is not the board’s alone any more');
  assert.match(detailCss, /\.scroll-shadow \{[^}]*--scroll-shadow-depth: 20px/);
  // The floor is sticky, not absolute: it belongs to the reading column, so it
  // stops at the gap and never lays a gradient over the conversation rail. And
  // it has a height — it *is* the room at the end of the document, which is
  // what puts it on the true bottom edge with nothing showing underneath.
  assert.match(detailCss, /\.scroll-shadow--bottom \{\s*position: sticky;\s*bottom: 0;\s*flex: none;\s*height: var\(--scroll-shadow-depth\);/);
  assert.match(detailLayout, /data-scrolled-below=\{moreBelow \? 'true' : 'false'\}/);
  assert.match(detailLayout, /scroll-shadow--bottom[\s\S]{0,40}<\/div>/, 'the floor closes the reading column, not the grid');
  // Both records render the same timer. The calendar used to carry a
  // byte-identical copy of it, down to the 1px nudge that centres the play
  // triangle, so the two could drift without anything noticing.
  //
  // They reach it through LiveTimeTracking, which is the only reader of the
  // store's one-second tick on either screen: reading `timerElapsed` in a
  // record's own body re-renders the whole record once a second for as long as
  // a timer runs.
  const liveTimeTracking = readFileSync(new URL('../src/components/workspace/LiveTimeTracking.jsx', import.meta.url), 'utf8');
  assert.match(liveTimeTracking, /<TimeTrackingControl/, 'the timer comes from the kit');
  for (const [name, source] of Object.entries({ IssueDetail: issueDetail, CalendarEventPage: calendarEvent })) {
    assert.match(source, /<LiveTimeTracking/, `${name} renders the shared timer`);
    assert.doesNotMatch(source, /state\.timerElapsed|s\.timerElapsed/, `${name} must not subscribe to the tick itself`);
  }
  assert.doesNotMatch(
    calendarEvent,
    /place-items-center rounded-\[6px\] leading-none/,
    'the calendar must not keep its own copy of the timer square',
  );

  assert.match(issueDetail, /<TaskAttributesPanel[\s\S]{0,120}context="task"/);
  assert.match(calendarEvent, /<TaskAttributesPanel[\s\S]{0,180}context="calendar"/);
  // The last column carries «Деталі», which is a target before it is a column:
  // 32px wide next to a 28px condensed height is a 32×28 hit area, and a thumb
  // misses it. 44px on a phone, unchanged from `sm` up where the label is back.
  assert.match(taskAttributes, /task: 'grid w-full grid-cols-\[repeat\(3,minmax\(0,1fr\)\)_44px\]/);
  assert.match(taskAttributes, /detailsButtonClass: `[^`]*max-sm:h-\[44px\]/);
  // …and the wrapper Popover puts around that trigger has to fill the column,
  // or the button inside is only as wide as its glyph however wide the column
  // is — and having filled it, it has to centre what it stretched around, or
  // «Деталі» sits at the top of a box the rest of the strip centres in. Both
  // the product and its preview say so.
  for (const source of [issueDetail, kit]) {
    assert.match(source, /<Popover[\s\S]{0,900}triggerClassName="flex h-full w-full items-center justify-center"/);
  }
  assert.match(taskAttributes, /calendar: 'grid w-full grid-cols-2/);
  assert.match(taskAttributes, /compactSelectClass: 'h-\[22px\][^']*rounded-\[10px\]/);
  assert.match(kit, /getTaskAttributeChrome\(\)/);
  assert.match(kit, /<TaskAttributesPanel[\s\S]{0,120}context="task"/);
  assert.match(kit, /<TaskAttributesPanel[\s\S]{0,120}context="calendar"/);

  for (const role of ['member', 'date', 'sort']) {
    assert.match(projects, new RegExp(`filterRole="${role}"`));
    assert.match(kit, new RegExp(`filterRole="${role}"`));
  }

  for (const signature of [
    'flex-1 overflow-y-auto custom-scrollbar bg-canvas relative',
    'max-w-[760px] mx-auto px-[16px] py-[24px] md:px-[32px] md:py-[48px] min-h-full flex flex-col',
  ]) {
    assert.ok(settings.includes(signature), `settings product signature changed: ${signature}`);
    assert.ok(kit.includes(signature), `settings /ui-kit preview does not mirror: ${signature}`);
  }
});

// Each section is a story file named after its navigation id, so the hierarchy,
// the story directory and the renderer are three lists that must agree. The
// filename carries the id: that is what lets every tool find a section's source
// without parsing the page, and what makes an orphan story visible.
test('the atomic hierarchy and section renderer stay in sync', () => {
  const { page, groupsSource, mapSource, visibleSectionIds, renderedSectionIds, stories } = readShowcase();

  for (const layer of ['Атоми (Atoms)', 'Молекули (Molecules)', 'Організми (Organisms)', 'Лейаути (Layouts)']) {
    assert.match(groupsSource, new RegExp(layer.replace(/[()]/g, '\\$&')), `Missing ${layer} layer`);
  }

  assert.deepEqual(
    visibleSectionIds.filter(id => !renderedSectionIds.includes(id)),
    [],
    'A visible navigation section is missing its renderer',
  );

  const storyIds = stories.map(story => story.id).sort();
  assert.deepEqual(
    storyIds,
    [...visibleSectionIds].sort(),
    'A story file must be a navigable section, and every section must have one',
  );

  // The map is wired by hand, so a section can point at the wrong story: the id
  // and the imported component both say "buttons" only if somebody checks.
  const importedFrom = new Map(
    [...page.matchAll(/^import (\w+) from '\.\/sections\/([\w-]+)';$/gm)].map(match => [match[1], match[2]]),
  );
  for (const match of mapSource.matchAll(/^\s*(?:'([^']+)'|([a-z][\w-]*)):\s*<([A-Z]\w+)\s*\/>/gm)) {
    const id = match[1] || match[2];
    assert.equal(
      importedFrom.get(match[3]),
      id,
      `Section "${id}" renders ${match[3]}, which comes from a different story file`,
    );
  }

  for (const story of stories) {
    assert.match(
      story.source,
      /^export default function \w+Section\(/m,
      `${story.id}: a story file exports its section as the default`,
    );
  }
});

test('approved UI decisions stay encoded in shared components', () => {
  const tokens = readFileSync(new URL('../src/lib/design/tokens.js', import.meta.url), 'utf8');
  const globals = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  const input = readFileSync(new URL('../src/components/ui/Input.jsx', import.meta.url), 'utf8');
  const select = readFileSync(new URL('../src/components/ui/Select.jsx', import.meta.url), 'utf8');
  const emptyState = readFileSync(new URL('../src/components/ui/Feedback/EmptyState.jsx', import.meta.url), 'utf8');
  const filterBar = readFileSync(new URL('../src/components/ui/FilterBar.jsx', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../src/components/ui/Layout/Card.jsx', import.meta.url), 'utf8');
  const surface = readFileSync(new URL('../src/components/ui/Surface.jsx', import.meta.url), 'utf8');
  const sprints = readFileSync(new URL('../src/app/(app)/sprints/page.js', import.meta.url), 'utf8');
  const button = readFileSync(new URL('../src/components/ui/Button.jsx', import.meta.url), 'utf8');

  assert.match(tokens, /h1: \{ size: '24px'/);
  assert.match(tokens, /h2: \{ size: '18px'/);
  assert.doesNotMatch(tokens, /buttonPrimary:[\s\S]{0,900}\bblue:/);
  for (const size of ['sm', 'md', 'lg']) {
    assert.match(globals, new RegExp(`--ui-control-${size}:`));
  }
  assert.match(input, /data-ui-size=\{size\}/);
  assert.match(select, /data-ui-size=\{variant === 'ghost' \? 'sm' : size\}/);
  assert.match(globals, /\.ui-type-page-title/);
  assert.match(globals, /\.ui-type-section-title/);
  assert.match(globals, /\.ui-pill/);
  assert.match(globals, /\.ui-surface/);
  for (const context of ['page', 'inset', 'flexible', 'centered']) {
    assert.match(emptyState, new RegExp(`${context}:`));
  }
  for (const role of ['type', 'date', 'member', 'project', 'sort']) {
    assert.match(filterBar, new RegExp(`${role}: 'w-\\[`));
  }
  for (const preset of ['bordered', 'borderless', 'canvas']) {
    assert.match(card, new RegExp(`${preset}:`));
  }
  for (const preset of ['panel', 'card', 'inset', "'nested-card'", "'bordered-panel'"]) {
    assert.ok(surface.includes(`${preset}:`), `Surface preset missing: ${preset}`);
  }
  assert.match(sprints, /<StatusPill label="Активний"/);
  assert.doesNotMatch(sprints, /function Badge\(/);
  assert.doesNotMatch(sprints, /<select\b/);
  assert.doesNotMatch(sprints, /<Input type="date"/);

  // QUI-126. A control declares its height once, and the line box reads the
  // same value, so text is centred by the browser instead of by a `leading-*`
  // utility that happens to win the cascade. `leading-none` in Button beat the
  // components layer and left every label ~2px above centre — invisible at
  // 100% zoom, plainly crooked at 90%.
  assert.match(globals, /--ui-control-height: var\(--ui-control-lg\)/);
  assert.match(globals, /line-height: var\(--ui-control-line, var\(--ui-control-height\)\)/);
  // A variant that sets a bare `height` keeps its own box but inherits the base
  // line box — reintroducing the miscentring one size at a time.
  for (const [rule, body] of globals.matchAll(/(\.ui-control\[data-ui-[^{]*)\{([^}]*)\}/g)) {
    assert.doesNotMatch(
      body,
      /(^|[\s;])height:/,
      `${rule.trim()} sets a bare height; declare --ui-control-height so the line box follows`,
    );
  }
  const baseClasses = button.slice(button.indexOf('const baseClasses'), button.indexOf('const sizeClass'));
  assert.doesNotMatch(
    baseClasses,
    /leading-/,
    'Button must not set its own line box; .ui-control owns it and a utility would win the cascade',
  );
});

// Settings is one screen, so a row that turns something on has to look the same
// wherever it lives. These two came in as separate reports about the same drift.
test('every settings row that switches something on is a switch', () => {
  const settings = readFileSync(new URL('../src/app/(app)/settings/page.js', import.meta.url), 'utf8');
  const integrationCard = readFileSync(new URL('../src/components/integrations/IntegrationCard.jsx', import.meta.url), 'utf8');
  const youtrack = readFileSync(new URL('../src/components/integrations/YouTrackImportCard.jsx', import.meta.url), 'utf8');

  // QUI-120: login methods used a Підключити/Відключити button pair beside a
  // status pill that only repeated what the switch position already says.
  const loginMethod = settings.slice(
    settings.indexOf('function LoginMethodItem'),
    settings.indexOf('// ── WorkflowItem'),
  );
  assert.match(loginMethod, /<ToggleSwitch/);
  assert.doesNotMatch(loginMethod, /<Button\b|<Pill\b|ProviderStatus/);
  assert.doesNotMatch(settings, /function ProviderStatus/);

  // QUI-119: one instruction panel shared by every integration. The same kind
  // of hint used to carry a different radius, padding and body colour per
  // service, and BuggyBag additionally listed what it syncs for no reason.
  assert.match(integrationCard, /export function IntegrationNote/);
  assert.match(integrationCard, /export function IntegrationCode/);
  for (const source of [settings, youtrack]) {
    assert.match(source, /<IntegrationNote/);
    assert.doesNotMatch(source, /rounded-\[(8|10)px\] border border-line bg-canvas/);
  }
  assert.doesNotMatch(settings, /'Скріншоти та консоль'/);
});

test('the local reference page does not depend on a working login flow', () => {
  const source = readFileSync(new URL('../src/proxy.js', import.meta.url), 'utf8');
  const developmentBypass = source.indexOf("process.env.NODE_ENV === 'development'");
  const sessionLookup = source.indexOf("request.cookies.get('qt_session')");

  assert.ok(developmentBypass >= 0, 'the local UI reference page needs a development-only auth bypass');
  assert.ok(
    developmentBypass < sessionLookup,
    'the development bypass must run before Firebase session verification',
  );
  assert.match(source, /pathname === '\/ui-kit'/);
  assert.match(source, /matcher: \['\/ui-kit'\]/);
  assert.doesNotMatch(
    source,
    /'\/ui-decisions'|'\/ui-diff'|'\/ui-audit'/,
    'deleted reference pages must not linger in the matcher',
  );
  assert.match(source, /if \(isDevelopmentReferencePage\) return NextResponse\.next\(\)/);
  assert.match(
    source,
    /if \(!hasSession\)[\s\S]*NextResponse\.redirect\(loginUrl\)/,
    'production reference pages must remain session-protected',
  );
});
