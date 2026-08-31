# qTicket roadmap

This file contains current owner guardrails and confirmed open work. Completed implementation history belongs in Git, not in long-lived task documents. If this document conflicts with current code, rules, or tests, the implementation wins and this file should be corrected.

## Product guardrails

- qTicket is a shared multi-tenant SaaS add-on activated for an existing QuickTeam organization. It has no standalone registration or organization creation. QuickTeam provisions the tenant, branding and selected support staff; qTicket then owns client spaces, invitations and incidents. qTicket and QuickTeam remain separate products and data stores.
- Organization roles are `owner`, `admin`, `member`, `client_admin`, and `client_member`. The first three belong to the tenant's support team. Client roles are restricted to their assigned project: they can see and create incidents and reply in an incident, while workflow, assignment, priority, and settings remain internal to **change**. Reading is a separate question and was conflated with changing until 2026-08-31: a client's board card had always drawn the status, the type badge and the priority mark, while the request's own page showed the status alone — so the page withheld from a customer what the card beside it had already told them. A client now reads status, type and priority on both surfaces and can set none of them. Two facts stay withheld on both, deliberately: which member of support is answering, because routing is how the desk organises itself; and the resolution date, because a date a customer can read is a promised resolution time, and qTicket promises none. A client admin may invite only client members into that same project.
- Staff identity and incident-to-task transfer integrate with QuickTeam through explicit server-side contracts. External clients authenticate in qTicket's own Firebase project; project-scoped invitations are bound to the verified email returned by the sign-in provider. Do not couple the products' primary Firebase sessions or data models.
- QuickTeam is the authority for the internal organization, branding,
  entitlement and enabled support staff. qTicket must refuse direct changes to
  synchronized internal seats, ownership and entitlement. qTicket remains the
  authority for client projects, external invitations, incidents and workflow.
- `issues` is the canonical incident collection. `tasks` is legacy/read-only and must not receive new features. The internal collection name stays stable during the fork; every user-facing string calls the record **«звернення»**, and it is one word for both audiences — the client's portal and the support queue name the same thing the same way.
- **The conversation on an incident is one shared thread.** Everything support writes there, the client reads. There is no internal note, no staff-only mode in the composer and no second collection beside `comments` — the owner removed it after it shipped, and a smaller version of it (a «draft» reply, a hidden mention, a private quote) is the same feature under another name. When support needs to discuss a case among themselves, they do it somewhere that is not the customer's own record.
- **Огляд and Звернення are two screens and stay two.** Folding the overview
  into the queue as a set of saved filters was proposed and refused by the
  owner on 2026-08-29: an overview answers «як ідуть справи» and a queue
  answers «що робити далі», and one screen wearing both answers neither.
  `/overview` is not to be redirected into `/my`, merged with it, or reduced
  to a filter chip on it.
- **A client space is that client's queue, not a second dashboard.** The page
  reached from **Клієнти** carries two tabs — **Звернення** and **Учасники** —
  and no counter tiles above the board: the board's own columns already say
  where every request stands, and the numbers belong on **Огляд**. The space's
  configuration is one dialog behind the gear in the header, never a tab of its
  own beside it.
- **The client and the support team see the same interface.** The difference between them is what the client is *not* shown — internal controls, other customers' queues, organization settings — never a second product built for customers. A screen both audiences reach is one screen that knows who is looking; a screen only clients reach exists only where support genuinely has no equivalent.
- **The team and the brand are administered in QuickTeam's qTicket integration, not inside qTicket.** Staff seats, roles, identity, organization name, logo and colour arrive in the signed snapshot and are read-only here; a second editor for any of them is a copy that loses. What qTicket's own settings own is the support process and its record: statuses, types, priorities, labels and the archive. A settings section that does not administer one of those does not belong in qTicket.
- qTicket does not publish a price list, sell or switch subscriptions, or use a
  browser-visible plan as a security boundary. QuickTeam owns the add-on's
  commercial state and sends only the server-side `active`/`inactive`
  entitlement that qTicket enforces.
- QuickTeam owns the internal support directory: activation, enabled staff,
  roles, identity and removal. qTicket may render that synchronized directory
  read-only for assignment and support operations, but must not duplicate its
  administration. A separate **Команда** surface earns primary navigation only
  if it adds incident-specific operational value such as who is answering which
  client; a copied name/role roster belongs in contextual pickers and profiles
  instead. External client employees remain qTicket-owned because
  `client_admin` manages them inside one client project.
- **The owner has rejected these outright. Do not propose them, do not build a
  smaller version of one, and do not leave a placeholder that implies one is
  coming.** Service-level policies and any promised first-response or
  resolution time; business-hours calendars; an automatic pause while an
  incident waits for the client; satisfaction ratings after resolution (CSAT);
  conditional form builders; canned-response macros; an inbound support
  mailbox; automatic routing or assignment rules; a knowledge base; any qTicket
  billing, price list or checkout; staff-only notes inside an incident; and the
  inherited planning calendar, sprints, timers, timesheets, invoices and
  analytics. What survives from those categories is deliberately manual:
  «Очікує відповіді» is a status a person chooses, a resolution date is a date
  a person sets, and an incident is assigned by a person.
- Organization deletion stays disabled until an owner-only, idempotent server cascade safely handles Firestore and external files and has integration coverage.
- Multi-tenant isolation and server-authorized privileged writes take precedence over UI convenience.

## Active implementation checkpoint (2026-08-28)

This section is the durable handoff for the current qTicket build. Keep it
current while the MVP is unfinished; move completed implementation details to
Git commits once the corresponding slice is accepted.

### Current product state

The application is a working, isolated qTicket beta built from the QuickTeam
foundation. Infrastructure readiness is not product acceptance: the primary
support and client journeys are qTicket-native, while the complete two-account
acceptance flow still has to be executed against the deployed test project.

Completed foundation:

- qTicket has its own GitHub repository, Vercel project and Firebase project;
  it does not share QuickTeam's primary database or authentication session.
- The test deployment is live at `https://qticket-qt.vercel.app` and reaches
  Firestore from authenticated server routes.
- Firebase client/admin configuration and Cloudinary are configured in Vercel;
  secrets are not stored in Git. Transactional email is intentionally disabled.
- Firestore rules and indexes are deployed to `qticket-qt`. The rules emulator
  suite passes all 89 tests, including the client reply transaction the
  product actually sends, the project-scoped client boundary, entitlement
  revocation, stale project-roster denial and the invite-link refusals.
- The role model already exists in code and rules: internal `owner`, `admin`,
  `member`; external `client_admin`, `client_member`. External users can create,
  read and discuss incidents in their client project, but cannot control the
  workflow, priority, assignment or organization settings.

Completed product slice on 2026-08-28:

- Internal primary navigation is now **Огляд**, **Звернення**, **Клієнти**,
  **Команда**, **Налаштування**. Task-planning surfaces are no longer primary
  qTicket navigation, and the legacy project dashboard is reached through
  `/clients` rather than acting as the internal home screen.
- `/overview` is a real support overview across accessible client projects: it
  shows open, new, active and unassigned counts, recently updated incidents and
  client queues. External client roles are redirected away from it.
- `/my` is now the internal organization-wide incident queue, not the signed-in
  person's task list. It provides board/list views and client, status, internal
  assignee, priority, type and creation-period filters; sprint controls are gone.
- The user-facing help articles for navigation, client projects and incident
  creation describe the qTicket flow implemented in this slice.
- The external client's `/` is now a dedicated **Мої звернення** portal rather
  than a redirect to the inherited project Kanban. It lists only that client's
  incidents, offers open/all/resolved views, exposes a prominent client-safe
  composer, and links `client_admin` directly to their employee directory.
- A direct client visit to the inherited project board returns to **Мої
  звернення**. The client incident detail keeps the visible status, description,
  attachments and shared conversation while removing internal assignee, roster,
  label, deadline and direct-chat surfaces.
- The internal client-project route now opens a qTicket customer workspace
  instead of the inherited project board. It has a focused incident queue,
  separate client/support rosters and a project-scoped client administrator
  invitation. It no longer subscribes to sprints, project analytics, timers or
  QuickTeam+ UI. (The support metrics and the settings summary that shipped
  with it were removed on 2026-08-29 — see the slice below.)
- The product baseline passes lint, the complete unit suite, production build,
  all 89 Firestore rules tests, all 42 local visual scenarios, and the UI Kit
  usage, drift, fidelity, colour and
  accessibility contracts. Authenticated two-role verification remains part of
  acceptance below.
- The version 1 QuickTeam add-on contract now exists in both repositories.
  QuickTeam owners activate qTicket, choose from existing active team members
  and synchronize branding; enabled staff receive a 90-second one-time launch
  and sign into qTicket Firebase on the qTicket origin. qTicket stores no
  QuickTeam session and refuses direct mutation of synchronized staff,
  ownership or plan.
- A plain qTicket `/login` is now the external client portal. Native staff login
  is disabled by default and exists only behind an explicit development/recovery
  environment switch.
- qTicket no longer bootstraps a tenant after a public sign-in. The retired
  onboarding route redirects into the authenticated boundary,
  `POST /api/organizations` refuses standalone creation, organization-switcher
  UI has no create action, and an account without a verified invitation or
  QuickTeam-managed membership receives an explicit no-access screen.
- Client invitation scope now has executable server-domain coverage: staff can
  invite the first `client_admin` into one tenant project, that administrator
  can invite only `client_member` users into their own project, and a foreign
  project id is refused. The invitation capacity read also reuses the verified
  organization snapshot instead of failing through a shadowed binding.
- The default incident lifecycle is **Новий → Прийнято → У роботі → Очікує
  відповіді → Вирішено**. The default types are **Звернення**, **Побажання** and
  **Помилка**; historical built-in labels are localized on read without
  overwriting custom organization labels.
- Creating a client no longer turns an email entered in the setup dialog into
  an internal QuickTeam seat. Support staff are selected only from synchronized
  internal members, while external users are invited from the client space's
  **Учасники** tab with `client_admin`/`client_member` scope.
- QuickTeam-managed organization, branding, entitlement and support seats are
  read-only in qTicket. Inherited migration and unrelated integration panels are
  removed from qTicket settings navigation; the rates and organization-deletion
  panels were deleted outright in the 2026-08-29 slice below.
- The incident composer and detail view no longer expose audio tasks, sprints,
  time tracking, estimates, task hierarchy or task links.
  Internal support keeps status, responsible staff, priority, type, resolution
  target, labels, description, attachments and the shared client conversation.
- Direct visits to inherited task-manager routes are contained at the request
  boundary: `/analytics` and `/calendar` return to **Огляд**, while `/sprints`
  and `/chat` return to **Звернення**. The active organization is preserved and
  legacy view filters are discarded.
- The planning calendar and the sprint board are now deleted, not merely
  hidden. `src/app/(app)/calendar`, `src/app/(app)/calendar/event/[eventId]`
  and `src/app/(app)/sprints` are gone, together with everything a reference
  audit found unreachable without them: the `CalendarEntry` and
  `CalendarHourSlot` kit components, `calendarEventDates`, `calendarLayout`,
  `sectionExpansion` and `sprintPlanning`, `SPRINTS_VIEW_SCHEMA`, the
  `sprintSearch`/`calendarSearch` store slices and the `manage:sprints`
  permission, whose only call site was the deleted screen. The redirects stay:
  a copied bookmark lands in the nearest supported workflow instead of on a
  404. What was left standing then — the `calendarEvents` server machinery and
  the event-detail component chain — is being removed in its own slice; the
  `sprints` collection and the stored `issue.sprintId` values are an
  organization's own history and are not rewritten.
- The help centre is a qTicket catalogue of 13 implemented topics, and every
  article for a deleted screen is deleted rather than unpublished: keeping one
  «for later» is keeping a description of a product nobody can buy.
- Notification settings expose only in-app delivery. Email remains
  hidden until a real provider is configured and verified; the beta does not
  promise channels that cannot deliver. The panel itself is now a client
  surface only — see the settings-ownership entry below for what internal staff
  lost with it.
- `Ctrl+K` and the global empty-search state are now role-aware qTicket
  surfaces. Internal support gets overview, incidents, clients, team, settings
  and incident/client creation; external clients get only their requests,
  incident creation, profile and the client-admin employee entry. Calendar,
  sprint, analytics and timer commands are gone. Search no longer reads
  calendar events, and client people results are restricted to their accessible
  client-space teams.
- The authenticated shell no longer renders the inherited global timer on
  desktop or mobile. Client settings now keep the employee directory exclusive
  to `client_admin`, use client-facing labels, and send a direct `client_member`
  deep link back to personal settings.
- External client routes are now contained by the authenticated layout, not
  only hidden navigation. Client roles may open their portal, personal settings
  and accessible incident details; direct staff overview, queue, team and board
  URLs return to the client portal before the internal screen renders.
- The shared incident conversation no longer subscribes a client session to
  staff time logs. Firestore also refuses client reads of raw time records and
  analytics rollups, and refuses client-authored audit entries, so internal work
  notes, billing evidence and forged workflow history cannot cross the portal
  boundary through a direct SDK request.
- The static role audit found a second direct-API bypass behind the already
  hidden calendar screen: any organization membership could call
  `/api/calendar/events` and receive staff events and birthdays through the
  Admin SDK. The routes were first narrowed to an internal support role and have
  since been deleted outright, together with `access:calendar` — nothing is left
  for a client account, or any account, to call.
- The inherited qTicket-local price list and plan subsystem are removed from
  settings, shared UI, project creation/restoration, invitations, AI and
  integration routes. qTicket no longer stores or switches a plan and applies
  no local project/member/feature ceilings. Server authorization and Firestore
  rules now require a non-empty QuickTeam source organization id plus an active
  signed entitlement; legacy standalone organization documents grant no access,
  and the synchronized organization snapshot is server-write-only.
- An external client can reply in their own incident. Until now they could not:
  `useComments.addComment` writes the message and the incident's conversation
  metadata in one transaction, Firestore refused the second write to a client
  role, and the atomic transaction took the message down with it — «Надіслати»
  returned a raw English «Missing or insufficient permissions» on the one action
  the client portal exists for, from the bootstrap commit onwards. Deleting your
  own message and the read receipt failed for the same reason. `issues` now
  carries a narrow conversation-participant update clause: whoever reaches the
  incident may write the comment counter, the last-activity strip, the last-
  comment fields and the mention tally, and `hasOnly` refuses status, columnId,
  assignees, priority, labels, deadlines, watchers, hierarchy, archive/cancel
  stamps and every other field. The client's incident screen also stops offering
  «Стежити», which writes a support-side field, and its breadcrumb no longer
  says «Клієнти › …» to the customer or link them at a screen that bounces.

Two things this record should say plainly. The two-sided acceptance flow below
could never have passed: its step «клієнт створює інцидент і відповідає в його
обговоренні» was broken in the shipped product the whole time it was listed as
open. And the rules suite passed while it was broken, because the test for it
exercised a bare `setDoc` on the comment document — a shape the product never
sends. A rules test that does not send the transaction the product sends proves
nothing about the product.

Completed product slice on 2026-08-29:

- **Налаштування** is audited by ownership for internal roles. A section stays
  for `owner`/`admin`/`member` only where qTicket owns the thing it changes and
  QuickTeam holds no copy of it. Internal staff keep incident statuses, incident
  types, priorities, labels, «Архів і видалене», «Організація і бренд» with the
  read-only qTicket access state folded into it, and the qTicket half of
  «Безпека». («Доступ qTicket» and «Команда підтримки» were sections of their
  own until the second 2026-08-29 pass below.) They lose **Особистий профіль**, **Локалізація** and
  **Сповіщення**: name, avatar, language and role arrive in QuickTeam's signed
  snapshot and are re-sent on the next sync, so a second editor here is a copy
  that loses. Client roles (`client_admin`, `client_member`) keep all three
  unchanged — their account is qTicket's own.
- A removed section is removed at every door, not hidden behind one. One
  `reachableSections` set answers the rail, the `?section=` address and the
  rendered body, so `/settings?section=localization` opened by a staff member
  lands on the first section that role actually has instead of drawing a screen
  the product no longer offers. The bell's «Налаштування сповіщень» gear is
  likewise client-only now.
- **What internal staff can no longer configure, deliberately.** «Сповіщення» is
  the one removed section qTicket genuinely owned: it is the only editor for
  `users/{uid}/settings/notifications`, which decides whether the in-app bell
  records `assigned`, `commented`, `mentioned`, `statusChanged` and `deadline`,
  plus the notification sound and the pop-up card. Internal staff are now pinned
  to whatever that document already holds, and a new staff account is pinned to
  the defaults in `src/lib/utils/notificationChannels.mjs` — all five event types
  on, sound on, pop-up on. Nothing else reads or writes those fields, so nobody
  can turn a type off for them either. Reversing this is one line: drop
  `'notifications'` from `CLIENT_ONLY_SETTINGS_SECTIONS` in
  `src/app/(app)/settings/page.js` and the section returns to the internal rail,
  its address and its body at once.
- «Безпека» kept the part qTicket owns and dropped the copy. The device/session
  list and «Вийти з акаунта» are qTicket's own record of this browser in this
  app and stay for every role. «Способи входу», «Вийти з організації» and
  «Видалення облікового запису» are now client-only: a staff identity and a
  staff seat both belong to QuickTeam, and the member route already refuses a
  QuickTeam-managed membership with `QUICKTEAM_MANAGED`, so those buttons could
  only ever fail.
- Two hidden inherited sections were deleted with their bodies, not left behind
  a flag: «Посади та ставки» (`positions`) and «Видалення даних» (`danger`),
  together with `PositionItem` and the whole-catalogue branch of the workflow
  reset. `positions` data is still hydrated and saved with the workflow document
  because the rosters — «Команда» and the client directory — read a member's
  position label. «Інтеграції» and
  «Перенесення даних» were kept hidden rather than deleted while something still
  referenced them; nothing does now — the third-party integrations, the import
  wizard and the `docs/integrations/` contracts that described them are all
  gone, and the one remaining contract is
  [QTICKET.md](integrations/QTICKET.md).
- Client-facing surfaces now carry the tenant's brand rather than qTicket's.
  `AuthLayout` takes an optional brand and paints the shell from the same
  `--sb-*` theme the workspace rail uses, so one organization colour cannot
  produce two shades; `organizationPortalBackground` is now the one place that
  turns a portal brand into a colour, and the sidebar reads it too. A plain
  `/login` stays deliberately unbranded — it cannot know whose portal it is
  before sign-in — and `/login?mode=staff` and `/login/quickteam` keep qTicket's
  own identity, because qTicket is the product the support team bought.
- The copied login instruction and the (still unsent) invitation email name the
  tenant instead of qTicket, and both resolve the name through
  `organizationPortalName` rather than reading the organization document raw.
  qTicket's own support channels are not offered on a branded screen: a client
  pressing «Підтримка» there would have reached OneB's Telegram rather than
  their supplier.
- The client invitation **link** exists again, client-only. Staff mint a
  `client_admin` link on a client space's «Учасники» tab; a `client_admin` mints a
  `client_member` link in «Співробітники клієнта». A link is fixed to one role
  and one client project, expires in 7 days, is capped at 10 uses and can be
  revoked. `src/lib/server/inviteLinks.mjs` refuses an internal role when the
  link is minted and again when it is accepted; `firestore.rules` refuses every
  browser read, list and write of a link document. Firestore stores only the
  token's SHA-256, accepting is a transaction so the last use cannot be spent
  twice, and expired/revoked/exhausted/unknown all answer identically.
- Listing `invitations` from a browser is now refused outright. A per-document
  `read` condition does not protect a query: the rules engine returned the link
  document to an admin whose direct `get` of that same document it had just
  refused, which would have let a `tokenHash` be harvested in bulk. `get` and
  `list` are separate rules now, and `tests/firestore.rules.test.mjs` holds it.
- `/invite/{token}` is the product's only unauthenticated read. Given a valid
  token it returns the portal name, logo, colour, client space name and invited
  role — and nothing about the inviter, the members, the organization id or the
  remaining uses — so an invited client meets their supplier's brand before
  signing in. It is rate-limited by IP and its page metadata deliberately does
  not unfurl the tenant, because the link is pasted into group chats.

- The client space page lost its dashboard and its third tab. The four KPI
  tiles above the board are gone for both readers, «Люди» is now **Учасники**,
  and the «Налаштування» tab is deleted outright: its body was a read-only copy
  of the client card plus a button that opened the very dialog the gear in the
  header opens. One consequence is deliberate and worth stating — the client's
  «Контекст» (`project.description`) is now readable only inside that dialog,
  which is `owner`/`admin` (`edit:project_settings`), so an internal `member`
  no longer sees it anywhere. If it turns out support needs that text, it comes
  back as one line under the header, not as a tab.

- **Налаштування** lost two more sections, both by ownership. «Доступ qTicket»
  was two read-only rows about the same synchronized organization «Організація
  і бренд» describes, so it is one row inside it now and `?section=billing`
  merges there. «Команда підтримки» was a second copy of a roster qTicket does
  not own, and **Команда** already draws it with the thing a support screen is
  for beside it — which clients a person is on, what they have open. The
  section is `client_admin`-only now («Співробітники клієнта», qTicket's own
  directory, which has no screen of its own), and `?section=team` asked by
  staff redirects to `/team` — that roster moved, it was not taken away.
- **Команда** absorbed what only the settings copy had. It lists people whose
  seat QuickTeam switched off, sorted last, dimmed, «Без доступу» in place of
  a position they no longer hold, and the profile they open says the same. Only
  a roster does this: `activeMembers` stays the answer for every picker, since
  work cannot be handed to somebody who can no longer sign in. The rail also
  carries the one sentence the deleted section had and this screen did not —
  where a seat comes from.

### Workspaces the product refuses to open (2026-08-31)

A seat in `orgMemberships` is what draws an organization in the switcher, and
nothing ever took one back out. Provisioning stopped creating seats for QuickTeam
tenants that never bought qTicket — but that covered only the seats provisioning
itself had made. A dry run of `migrate:noncustomer-orgs` against `qticket-qt`
removed **nothing** and reported two organizations under `manualReview` with the
reason `legacy-standalone`: they predate the QuickTeam contract, carry no
`quickTeam.sourceOrganizationId` at all, and were therefore never in that
migration's scope. Their owners kept being offered a door that opens onto
«організація не підключена через QuickTeam», because access requires both a
source organization and an active entitlement.

`buildOrganizationList` now drops an organization whose document proves the
product cannot open it, and the active-organization snapshot listener applies the
same rule before appending. Nothing is deleted and no seat is touched — the
organization simply stops being offered as somewhere to go. The one case it must
never catch is a `pending` entry: a document that did not come back is a short
read, and dropping a workspace on that evidence is the failure `buildOrganizationList`
was written to prevent in the first place. Both halves have a test.

The two legacy organizations stay in the database, with their content, for a
human to decide about. They are not a migration's business.

### A customer's thread that says nothing happened (2026-08-31)

`audit/` is the support-side work record — who reassigned it, who moved it, when
— and `firestore.rules` refuses it to a client role. That is right, and it left
the customer's own thread empty: a request went Новий → Прийнято → У роботі →
Вирішено and their timeline showed no trace of it unless somebody had also typed
a message, while the status pill above it changed silently.

Firestore rules cannot require a `where` clause, so «let a client read the audit,
but only the status rows» is not a condition that can be written. The fact they
are entitled to therefore lives in `issues/{id}/statusHistory`, written by the
status route and the create route — both server-side, both the only writers, and
the rule refuses every browser write. Status changes have exactly one write path
already: the bulk action delegates to the same route, so the history has no
holes.

- No actor is stored. Which agent moved a request is the routing withheld from a
  customer everywhere else, and a field that is not written cannot leak if the
  rule around it is ever loosened.
- Entries are written in the audit's own shape (`action`, `from`, `to`), so
  `describeAuditEvent` reads both feeds out in the same words. Two vocabularies
  for one fact is how the two sides of a desk begin describing different
  products.
- `UnifiedTimeline` subscribes to exactly one of the two feeds by role, and the
  unread boundary now waits on whichever one this reader is actually on —
  latching on `auditLoading` would settle instantly for a customer, who has no
  audit subscription at all.

### The customer's own side of a request (2026-08-31)

`assigneeIds` is support's routing and a client never sees it. `clientAssigneeIds`
is the mirror that belongs to them: which of their own people answers for this
request. Support reads it — «who do we talk to over there» is the most useful
thing about a queue of somebody else's problems — and may correct it. It defaults
to whoever filed the request, because a field that starts empty is a field most
people leave empty and «нобody» is the one answer this question never has.

- One label for both readers, **«Відповідальні клієнта»**. Two labels for one
  field is how a two-name product starts, and the agent's screen shows this
  beside «Відповідальні», so the label has to say whose.
- One placement for both readers: a `group` section in the request's body, not a
  cell on the attribute strip. The agent's strip is already five controls wide,
  and this is read far more often than it is changed.
- The server bounds it to the client space's roster at creation;
  `firestore.rules` bounds the later edit to the same roster and to this key
  alone. What the roster cannot do is tell a client from an agent, so a client
  could name a support uid and see that person under their own heading —
  cosmetic, confined to a project that person is already on, and separating the
  two in rules would mean a membership `get` per entry against a limit of ten.

**A budget, and a warning for whoever edits `firestore.rules` next.** A request
carries a thousand expressions across every clause that matches it, and this
file already spends most of that. Adding this as a third `allow update` on
`issues` repeated the whole scope walk and pushed denied writes past the limit —
and an exhausted budget arrives looking exactly like a denial. The emulator suite
stayed green throughout, because every write it exhausted on was one the rules
meant to refuse: green by coincidence. It is folded into the conversation clause
now, second branch, so «Надіслати» is decided at full budget before any of it can
be spent. **The next change here should reduce what is in this file rather than
add to it.**

### «Огляд» for the customer too (2026-08-31)

The product's front screen was something only half its users had. `/overview`
redirected a client away on sight, `/` sent them into their space instead, and
their rail opened with «Мої звернення» — so a customer arrived at a list and
never at a summary. The obvious second answer, a customer dashboard of its own,
is the one this guardrail forbids: **a screen both audiences reach is one screen
that knows who is looking**. Two screens counting the same records is how «У
роботі» came to mean two different numbers once already.

- The screen guard and the redirect are gone. `/overview` renders one component
  that branches on the role: support keeps its five tiles, the recently-updated
  list across every client and the client panel; a customer gets three tiles —
  **«Відкриті»**, **«Чекають на вас»**, **«Вирішені»** — and «Останні оновлення»
  of their own requests, drawn with the kit's `TaskRow` and `showAssignee={false}`.
- **«Чекають на вас»** is the mirror of support's **«Чекають на нас»** and is
  computed in `incidentQueueMetrics.mjs` beside it, not written out again on the
  page: `isWaitingOnClient` / `waitingOnClient`. It is deliberately not
  `!waitingOnUs` — a request nobody has written in yet waits on neither side,
  and negating the other predicate would have handed every new request to the
  customer as their move to make.
- **«Створити звернення»** is a primary in the `PageHeader`, and only on the
  customer's half. Only a client opens a request, so the control exists for the
  one reader who may use it and deliberately does not exist for support. It
  leads to `/{spaceId}?new=1`, because the composer lives in the space.
- Three things the customer's half never draws: **who is assigned** (routing is
  how the desk organises itself), the **clients panel** (there is one client and
  it is them), and any **resolution date** — a date a customer can read is a
  promised resolution time, which the owner rejected outright.
- The client rail is **«Огляд» · «Мої звернення» · «Налаштування»**, and `/`
  lands a client on `/overview`. The one address that still overrides it is
  `?new=1` from Ctrl+K: the composer is in the space, so that hop goes straight
  there rather than dropping the request the reader already made.
- **«Співробітники»** is off the client rail and off `MobileNav`. It pointed at
  `/settings?section=team`, and the settings rail names that same destination
  again on the screen it opens — one address named twice on one screen. The
  roster moves to `/team`.
- `isClientPortalRoute` admits `/overview` **by exact name**. If the product
  sends somebody somewhere, that list has to say so — the alternative is the
  loop this file already records: the page redirects forward, the layout bounces
  back, and the client cannot open qTicket at all. `overview` stays a
  `RESERVED_SEGMENT`, so a space that happens to carry that id is still refused
  as a space.
- The screen came off the `STAFF_ONLY` exemption in `tests/client-terminology.test.mjs`,
  and support's own word for the seat went with it: the tile and the rows say
  **«Без відповідального»**. A word kept one branch away from the person it is
  hidden from is a word this product has already leaked twice by moving the branch.

Still open: the command palette offers a client no «Огляд» entry, and
`WorkspaceHeader` still puts support's search placeholder — «Пошук звернень,
клієнтів і команди…» — over the customer's half of the screen.

### The event the desk waits for (2026-08-31)

Creating a request now tells the support staff on that customer's space. Until
this slice it told nobody: the only notification creation ever sent was
`assigned`, whose audience is the new task's assignees, and a customer's request
has none by definition — only a client opens one and support picks it up
afterwards. `notifyIssueAssigned` was handed an empty array and took its early
return, so a request filed at midnight waited for somebody to open the queue and
notice the unread dot on the client in the rail.

- The event is `incident_created`, and it is a **system** type: `/api/notifications`
  accepts only `REQUESTABLE_NOTIFICATION_TYPES`, so a browser cannot forge one.
  The create route is the sole author of it.
- It is emitted **server-side**, in `/api/issues`, because the recipients are the
  tenant's internal staff and the customer's browser is exactly the place that
  may not enumerate them.
- Recipients are the internal roles on `project.team` for that client space,
  minus the author. The customer's own colleagues are not an audience for their
  colleague's request. Where the roster names no support staff at all, it falls
  back to the organization's owners and admins — not as a wider default, but
  because a request nobody is told about is the defect being fixed.
- It has no preference switch. Internal staff have no notification settings at
  all (QuickTeam owns their account), so a per-user switch would be one nobody
  can reach; as a keyless type it always records in the bell and never emails,
  which is right while transactional email is off.
- `unreadInAppCount` filters by no type, so this also raises the qTicket unread
  badge on QuickTeam's rail — the cross-product counter gets its first event
  that a person actually waits for.

Product work still required:

- Run the complete tenant/client acceptance flow and correct every permission or
  usability problem it exposes.
- **Команда** and **Налаштування** are both audited (see the 2026-08-29 slices
  above): the duplicate roster is gone, and what stays is incident workflow,
  client access and read-only QuickTeam state. In-app notification preferences are no longer part of that
  retained set for internal roles — the owner removed the panel, and the
  consequence is recorded above.
- Run the acceptance flow against the two cross-product features that have
  never served a real request: the unread badge on QuickTeam's rail and
  «Створити завдання в QuickTeam». Both are implemented and tested on both
  sides (see [QTICKET.md](integrations/QTICKET.md)); both need
  `QUICKTEAM_QTICKET_SHARED_SECRET` on the two servers and
  `NEXT_PUBLIC_QUICKTEAM_URL` in qTicket's deployment, and neither has been
  exercised end to end. Billing entitlement follows only after the wider product
  has a server-side add-on contract.

### Confirmed MVP information architecture

Internal support users:

1. **Огляд** — support workload, status counts, unassigned incidents and recent
   activity across all client projects.
2. **Звернення** — one global queue with list and Kanban views; project/client,
   status, priority, assignee and date filters.
3. **Клієнти** — client projects, their team, configuration and incident counts.
4. **Команда** — the tenant's internal support team.
5. **Налаштування** — statuses, types, priorities, labels and the archive. The
   team and the brand are administered in QuickTeam's qTicket integration.

External client users:

1. **Мої звернення** — incidents in the one client project available to the
   signed-in user.
2. **Створити звернення** — a prominent action, not a buried task-manager modal.
3. **Співробітники** — available only to `client_admin`, who may invite
   `client_member` users into that same project.
4. **Звернення** — the same screen support opens, minus the internal controls:
   visible status, description, attachments and the shared conversation.

The inherited planning modules — sprints, the planning calendar, the timer,
time logs, timesheets, invoices and the analytics screens — have finished the
sequence they were put through: removed from qTicket surfaces, contained at the
request boundary, then audited and deleted with the code behind them. Two
things deliberately survive their screens and are not leftovers to clean up:
the `sprints` collection with its stored `issue.sprintId` values, and whatever
`analyticsRollups` documents an organization already has. They are that
organization's own record, and nothing rewrites them.

### Active build sequence and handoff rule

1. **Completed:** implement role-aware qTicket navigation and the internal
   **Огляд** screen using only shared components from `src/components/ui`.
2. **Completed:** turn the inherited cross-project board into the global
   **Звернення** queue and remove sprint/task-manager controls from that surface.
3. **Completed:** rebuild the external client entry and incident
   creation/detail around the simple client journey above while preserving the
   rule-enforced permission boundary.
4. **Completed:** rework the internal client-project entry reached from
   **Клієнти** around customer context, incidents, people and settings instead
   of a task board.
5. **Completed:** implement QuickTeam activation, staff selection,
   branding synchronization and one-time staff launch without sharing Firebase
   sessions or databases.
6. **Completed:** configure both deployments with the shared secret and verify
   the first synchronized staff launch against the test deployment.
7. **In progress:** execute the full internal/client acceptance flow with
   separate accounts and correct every concrete product or permission failure.
8. **Completed ahead of the acceptance flow, at the owner's instruction:** the
   incident-to-QuickTeam-task transfer, and the unread badge beside QuickTeam's
   qTicket row. The transfer is idempotent on the request id, creates the task
   through QuickTeam's own creation path, and leaves the request open with a
   link and one audit line. What remains for step 7 to prove is that both work
   against the deployed pair. Any later billing work belongs to QuickTeam;
   qTicket continues to consume only its active/inactive entitlement.

The exact next implementation task remains step 7: **Налаштування** is audited,
so what is left is **Команда**, the rest of the static role audit, and then the
two-sided flow with separate staff, client-admin and client-member sessions.
Fix every concrete failure it reveals. Every completed slice should be a reviewable Git commit and this
checkpoint should be updated in the same commit.
The next agent must read `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`,
`docs/UI_KIT_CONTRACT.md` and this file before continuing. Never place local
credentials, service-account JSON, `.env` values or session notes here.

## Confirmed open work

### qTicket MVP rollout

The focused competitor-pattern audit is complete. It used current first-party
documentation for [Zendesk closed customer access and internal notes](https://support.zendesk.com/hc/en-us/articles/4408883658906-Permitting-only-added-users-to-submit-tickets),
[Jira Service Management restricted portals, comments, queues and SLA](https://support.atlassian.com/jira-service-management-cloud/docs/set-up-and-manage-portal-access/),
[Freshdesk public/private notes and SLA](https://support.freshdesk.com/support/solutions/articles/231527),
and [Help Scout's no-self-registration customer portal](https://docs.helpscout.com/article/1777-set-up-and-manage-customer-portal).
The competitors validate behaviors, not qTicket's ownership model or UI.

| Product question | qTicket decision | MVP consequence |
| --- | --- | --- |
| Staff/customer identity and organization boundary | **Adopt** the restricted B2B portal pattern | Staff enters only from signed QuickTeam provisioning/launch; a client account exists only after a project-scoped invitation. No local registration or organization creation. |
| Client company visibility and administration | **Adapt** organization-level customer visibility | One qTicket client project is the customer's support space. `client_admin` invites only `client_member` into that project; no arbitrary cross-project sharing or request participants. |
| Public reply versus internal note | **Reject** | Every competitor here has a private note beside the reply; qTicket does not, and the owner removed it after it shipped. One incident, one conversation, and everything support writes in it the client reads. What stays staff-only is the `audit` feed, which records what changed rather than what anyone said. Do not reopen this as a draft, a hidden mention or a private quote. |
| Queue and assignment | **Adapt** | Keep one opinionated global incident queue with project, status, priority, assignee and date filters plus manual assignment. Reject custom queue builders, support groups and automatic routing until real volume proves they are needed. |
| SLA and business hours | **Reject** | The owner rejected the whole category: no service-level policy, no promised first-response or resolution time, no business-hours calendar, no automatic pause while an incident waits for the client, and no post-resolution satisfaction rating. «Очікує відповіді» stays a status a person chooses, and a resolution date stays a date a person sets. Do not reopen this as a smaller version of itself. |
| Request forms | **Adapt** | Incident types provide customer-friendly categories; add only proven type-specific required fields. Reject a general conditional form builder in the MVP. |
| Audit and notifications | **Adapt** | Everyone on an incident receives its replies and its status; the support audit is staff-only, and so are the notifications about it. Email remains disconnected until Resend is intentionally enabled. |
| Internal team administration | **Reject duplication** | QuickTeam remains authoritative for staff enablement, roles and profile data. qTicket keeps only operational pickers and contextual read-only profiles, refuses every mutation of a QuickTeam-managed seat, and offers no internal role and no link into an internal seat anywhere. The invite link exists again for clients only: it may carry `client_admin` or `client_member` and nothing else, refused at the create route, in the accept transaction and in Firestore Rules. Client employees remain qTicket-owned. |
| Pricing, billing and inherited planning modules | **Reject for qTicket MVP** | No local plans, prices, checkout, invoices, timesheets, sprints, calendar or AI surface. qTicket consumes only QuickTeam's signed active/inactive entitlement. |

Stop condition: do not copy a competitor UI or turn its complete feature list
into qTicket scope. Add a feature only when it closes a verified incident-service
workflow or security gap.
- Run the complete two-sided acceptance flow against a dedicated Firebase test
  project: tenant creates a client project, invites a client administrator,
  that administrator invites one employee, both clients create/reply to an
  incident, and support staff changes status, priority and assignee. The local
  rules emulator covers the boundary; this is the first real invitation/session
  smoke test. During the initial rollout no email provider is connected: the
  client administrator copies the generated login instruction into a messenger.
- **Completed:** the user-facing terminology pass on qTicket routes. The
  canonical collection and the inherited internal code stay `issues`/task-oriented
  and were not touched; what changed is what anybody reads. Every surface now
  says **«звернення»** — one record, one name, for the support team and the
  client alike. The two-vocabulary version of this («інцидент» for staff,
  «звернення» for the client) was the wrong fix: a customer's list and an
  agent's queue that are visibly not the same thing is a product with a seam in
  it, and every shared screen had to remember which reader it was addressing.
  `src/lib/content/incidentTerms.mjs` is the one table, and
  `tests/client-terminology.test.mjs` fails on the first task-manager word that
  comes back into the copy, the portal, the palette, the tab title, the
  notification labels or the published help.
- Still open in the same area, and not terminology: a `client_admin` who opens
  «Налаштування» → «Акаунт» is offered «Вийти з організації» and account
  deletion, and a client's incident breadcrumb is drawn by the internal detail
  screen. Both now use client wording; whether a client should be offered them
  at all is a product question for the acceptance flow.
- **Reversed:** the incident conversation briefly had «Відповідь клієнту» and
  staff-only «Внутрішня нотатка» modes, stored under a separately ruled
  `internalNotes` collection. The owner removed both. The conversation is one
  shared thread — see the guardrail — and the composer offers no choice about
  who reads what.
- Add the explicit server-to-server «Створити завдання у QuickTeam» action.
  The first version is manual, idempotent, records the QuickTeam task identity
  on the incident, and never shares Firebase sessions or databases.
- QuickTeam may later derive the add-on entitlement from its own commercial
  system. That is not a qTicket price-list or checkout task: qTicket continues
  to consume only the signed active/inactive value and never infers access from
  a browser-visible plan field.
- Create the production Firebase and Vercel projects only after the acceptance
  flow passes in the isolated test project. Transactional email is optional and
  remains disconnected while qTicket uses a temporary `vercel.app` domain;
  manual login instructions are the supported flow. Production credentials must
  be created for qTicket, not copied from QuickTeam.

### Safe organization deletion

- Implement an owner-only server API with a resumable/idempotent cascade.
- Delete all organization-scoped Firestore data and external files safely.
- Cover authorization, partial failure, and retry behavior before enabling the Settings action.

### Status categories

A status has a local label and a shared category (see the README). qTicket's
five built-in category labels are «Новий», «Прийнято», «У роботі», «Очікує
відповіді» and «Вирішено». An organization may add local statuses inside those
categories without changing what the global queue counts.

**«Скасовано» is no longer a category.** Dropped work is `cancelledAt` on the
task, because a status puts a task in a column and a task in a column is still
one of the tasks every report has to remember to subtract. An organization that
had created a status under the old «Скасовано» section keeps it as an ordinary
open status — deliberately visible rather than silently re-read as «Вирішено»,
which is what its stored `isDone: true` would otherwise have meant. The one-time
cleanup is by hand and takes a minute: cancel those records with the new action,
then delete the status in «Налаштування», in the statuses section. No script.

**«Очікує відповіді» is the shared waiting category.** Historical built-in
labels «На перевірці», `Review` and `In Review` are presented with the qTicket
label on read. Custom labels remain untouched. The historical ids
`code-review`, `qa` and `client-approval` still resolve to this category.

The global «Звернення» board groups by these categories. Moving a card resolves
the matching local status from that incident's client space, so a global drop
never writes a status that the client space does not own.

### Product polish

- Add a “hide completed” toggle to My Tasks, enabled by default.
- Implement a verified email-change flow with recent re-authentication.
- Continue accessibility and mobile-layout checks on the main workspace flows.
- Ask for the Web Notification permission. In-app exists and email is wired but
  disconnected; the one channel that reaches a laptop with the tab in the
  background is the one never requested.
- Recover from an expired session in one place. Two files translate an expired
  token into Ukrainian; everywhere else it surfaces as a generic failure, and a
  half-written form is lost with it.
- Give a failed background write a retry. The optimistic overlay rolls back
  correctly, and then the person is left to redo the action by hand with no
  record of what was lost.
- Set a bundle budget. Nothing fails today when a page's JavaScript doubles.

### Chat read state, and the card that announces it

One subject, two implementations, and that is why this area produces a new bug
report every few weeks. The workspace chat (`/chat`) keeps a per-room cursor in
`organizations/{orgId}/readState/{uid}_{channelId}` and carries the whole scroll
behaviour — jump-to-latest, a resize correction, an at-bottom threshold. The
task chat (`UnifiedTimeline`) keeps a `readBy` array on every comment and owns
the unread divider the workspace chat has never had. Repairing one leaves the
other holding its own half of the same defect.

All three passes are done — the git log carries what changed and why. The third
one was cost and hygiene: the task chat now asks the per-issue cursor what is
unread instead of a mark inside every message, and writes a mark only where the
✓✓ receipt genuinely needs one (the newest message of each author, which covers
everything older); the bell collapses a conversation into one row; read records
expire after thirty days without ever deleting a claim something could still
resend; and event-driven email failures land in the same outbox the
reminders use.

One item of that list was argued over at length — whether `birthday` was a dead
notification type — and the argument is now moot: qTicket does not greet the
customer's staff on their birthday, and `createBirthdayNotifications` is gone
with the rest of it. What the argument was actually about survives and was worth
fixing: three lists of notification types disagreed in three files with nothing
holding them together. The registry in `notificationChannels.mjs`
(`REQUESTABLE_NOTIFICATION_TYPES` / `SYSTEM_NOTIFICATION_TYPES`) and
`tests/notification-types.test.mjs` now do.

**Still open in this area**

- One implementation of reading and scrolling for both chats. Wave 1 moved the
  scroll behaviour across and wave 3 moved the read model across; the two screens
  still hold two copies of the code that does it. The unread line and the ✓✓
  receipts are a layer above that, not a second chat.
- «Позначити непрочитаним» for a single message. It exists for a task as a
  whole.
- Reactions in the task chat. They exist in the workspace chat; this is taste,
  not mechanics.

### Notification delivery

See [ARCHITECTURE.md](ARCHITECTURE.md) for the two paths and their guarantees.

- Point an external HTTP cron (cron-job.org, one-minute granularity) at
  `/api/cron/notifications`. No code change; fixes latency today. GitHub Actions
  stays wired as a fallback only.
- Finish write-time outbox materialisation in every event/deadline mutation
  path. Dispatch already uses the scheduled outbox; the bounded twenty-minute
  source materialiser remains as a safety net until this invariant is complete.
- Surface sweep health and per-recipient delivery failures in Settings; both are
  recorded and neither is visible.
- When QuickTeam moves to its own server: run the worker in-process on a real
  interval and drop the external trigger.
- Send a digest instead of an interruption per event. A daily or end-of-day
  summary («3 звернення на завтра, 1 прострочене») is usually the only kind of
  notification people keep switched on.

### Лічильники замість повного набору звернень

Екранів звітності вже немає, але питання лишилось: набір звернень читається
повністю там, де потрібне лише число. `projects/{id}.issueCounts` відповідає на
`total`/`delivered`/`overdue` без читання колекції (ARCHITECTURE → «Лічильники
задач на проєкті»), а решту рахує сам набір.

Замінити читання набору запитом `count()` поки не можна чесно, і ось чому:

- Немає поля, за яким «відкриті» можна порахувати `count()`. Закритість запису
  живе в категорії його статусу, а статуси налаштовуються по клієнтських
  просторах, тож запит мусив би бути `columnId in [...]` — а `in` тримає
  щонайбільше 30 значень.
- `archivedAt` і `cancelledAt` відсутні на документі, поки не виставлені, а
  Firestore не вміє питати «поля немає». `count()` без цього рахував би
  архівні й скасовані записи, тобто давав би відповідь, гіршу за поточну.
- `useIssues.js` і `issueCancel.mjs` навмисно фільтрують у місці читання, а
  не в запиті, саме тому, що кожен потік звернень і так обмежений простором.

Щоб це зрушити, потрібне денормалізоване поле стану на самому записі
(`open`/`delivered`), яке пишуть ті самі серверні маршрути, що вже пишуть
статус, плюс backfill `archivedAt`/`cancelledAt` у явний `null`. Робити його
варто лише після вимірювання реального обсягу даних: він змінює те, що картка
може показувати наживо, але не повинен створювати локальний тариф або штучне
обмеження qTicket.

Поки цього немає, вартість обмежена тим, що звернення — скінченна множина: вона
росте з обсягом роботи, а не з віком робочого простору.

### Operational facts worth knowing

- **The GitHub repository is public.** `ArthurMospan/qt-workspace` answers to an
  unauthenticated API call. Nothing secret is committed and the checks for that
  hold, but the data model, the Firestore rules and every internal route are
  readable by anyone. If that is deliberate it stays written down here; if it is
  not, it is one setting.
- **Production runs on Firestore's free read quota.** The queries are bounded
  now, and the day it is spent anyway the product says so instead of spinning —
  see `lib/utils/quotaState.mjs` and the test that holds the three surfaces to
  one sentence.

  There was a meter here too — `lib/utils/readMeter.mjs`, answering as
  `qtReads()` in the console — and it is gone. It reported five hooks of about
  thirty, saw nothing the server read, saw nothing the rules engine read, and
  lost everything on reload; so the one day the quota actually ran out it could
  not say what had spent it. Firestore's own console answered that in two
  clicks, and **Query Insights** answers the question the meter was built for —
  which query, how many executions, how many documents each — for every read in
  the project rather than for the five somebody remembered to instrument. Look
  there first, sorted by read operations.

  Rule stands regardless: scope and window every new read path.
- **The dashboard is the widest read in the product and the screen people
  return to most.** Its subscription therefore lives in
  `lib/hooks/useOrganizationIssues.js`, refcounted and keyed by what it reads,
  not inside the screen: a listener rebuilt on the way back in is a fresh query
  against that daily cap. A new screen that wants the same set asks this hook
  rather than opening a second copy of it.

## Unprioritized product backlog

Do not start these without an explicit owner decision:

- Mobile/PWA experience.
- Goals/OKR tracking.
- AI summaries and assistance of any kind.

Two entries left this list by being rejected rather than deferred, and they are
in the guardrails above: intake forms for external requests (a conditional form
builder), and user-configurable automation or routing rules.

Commercial billing, checkout and subscription contracts belong to QuickTeam,
not to the qTicket product backlog. qTicket consumes only the signed add-on
entitlement.
