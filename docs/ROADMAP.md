# qTicket roadmap

This file contains current owner guardrails and confirmed open work. Completed implementation history belongs in Git, not in long-lived task documents. If this document conflicts with current code, rules, or tests, the implementation wins and this file should be corrected.

## Product guardrails

- qTicket is a shared multi-tenant SaaS add-on activated for an existing QuickTeam organization. It has no standalone registration or organization creation. QuickTeam provisions the tenant, branding and selected support staff; qTicket then owns client spaces, invitations and incidents. qTicket, QuickTeam, and QuickTeam+ remain separate products and data stores that may all exist in parallel.
- Organization roles are `owner`, `admin`, `member`, `client_admin`, and `client_member`. The first three belong to the tenant's support team. Client roles are restricted to their assigned project: they can see and create incidents and reply in an incident, while workflow, assignment, priority, and settings remain internal-only. A client admin may invite only client members into that same project.
- Staff identity and incident-to-task transfer integrate with QuickTeam through explicit server-side contracts. External clients authenticate in qTicket's own Firebase project; project-scoped invitations are bound to the verified email returned by the sign-in provider. Do not couple the products' primary Firebase sessions or data models.
- QuickTeam is the authority for the internal organization, branding,
  entitlement and enabled support staff. qTicket must refuse direct changes to
  synchronized internal seats, ownership and entitlement. qTicket remains the
  authority for client projects, external invitations, incidents and workflow.
- `issues` is the canonical incident collection. `tasks` is legacy/read-only and must not receive new features. The internal collection name stays stable during the fork; user-facing qTicket copy calls these records incidents.
- qTicket does not publish a price list, sell or switch subscriptions, or use a
  browser-visible plan as a security boundary. QuickTeam owns the add-on's
  commercial state and sends only the server-side `active`/`inactive`
  entitlement that qTicket enforces.
- QuickTeam owns the internal support directory: activation, enabled staff,
  roles, identity and removal. qTicket may render that synchronized directory
  read-only for assignment and support operations, but must not duplicate its
  administration. A separate **Команда** surface earns primary navigation only
  if it adds incident-specific operational value such as workload or assigned
  clients; a copied name/role roster belongs in contextual pickers and profiles
  instead. External client employees remain qTicket-owned because
  `client_admin` manages them inside one client project.
- **The owner has rejected these outright. Do not propose them, do not build a
  smaller version of one, and do not leave a placeholder that implies one is
  coming.** Service-level policies and any promised first-response or
  resolution time; business-hours calendars; an automatic pause while an
  incident waits for the client; satisfaction ratings after resolution (CSAT);
  conditional form builders; canned-response macros; an inbound support
  mailbox; automatic routing or assignment rules; a knowledge base; any qTicket
  billing, price list or checkout; and the inherited planning calendar, sprints
  and timesheets. What survives from those categories is deliberately manual:
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
  suite passes all 85 tests, including the client reply transaction the product
  actually sends, the project-scoped client boundary, entitlement revocation and
  stale project-roster denial.
- The role model already exists in code and rules: internal `owner`, `admin`,
  `member`; external `client_admin`, `client_member`. External users can create,
  read and discuss incidents in their client project, but cannot control the
  workflow, priority, assignment or organization settings.

Completed product slice on 2026-08-28:

- Internal primary navigation is now **Огляд**, **Інциденти**, **Клієнти**,
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
  instead of the inherited project board. It has a focused incident queue and
  support metrics, separate client/support rosters, a project-scoped client
  administrator invitation, and an internal-only settings summary. It no
  longer subscribes to sprints, project analytics, timers or QuickTeam+ UI.
- The product baseline passes lint, the complete unit suite, production build,
  all 85 Firestore rules tests, all 42 local visual scenarios, and the UI Kit
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
  **Люди** tab with `client_admin`/`client_member` scope.
- QuickTeam-managed organization, branding, entitlement and support seats are
  read-only in qTicket. Inherited migration, rates, deletion and unrelated
  integration panels are removed from qTicket settings navigation.
- The incident composer and detail view no longer expose audio tasks, sprints,
  time tracking, estimates, task hierarchy, task links or QuickTeam+ chat.
  Internal support keeps status, responsible staff, priority, type, resolution
  target, labels, description, attachments and the shared client conversation.
- Direct visits to inherited task-manager routes are now contained at the
  request boundary: `/analytics` and `/calendar` return to **Огляд**, while
  `/sprints` and `/chat` return to **Інциденти**. The active organization is
  preserved and legacy view filters are discarded.
- Public help is now a qTicket catalogue of 13 implemented topics. Articles for
  sprints, time tracking, invoices, analytics, planning calendars, YouTrack and
  workspace chat remain inherited implementation material and are not
  published as available qTicket features.
- Notification settings expose only in-app delivery. Email and Telegram remain
  hidden until a real provider is configured and verified; the beta does not
  promise channels that cannot deliver.
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
  Admin SDK. Every calendar route now requires an internal support role, while
  `calendarEvents` stays server-only for every browser role in Firestore Rules;
  client accounts cannot trigger birthday/reminder jobs or mutate legacy events.
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

Product work still required:

- Run the complete tenant/client acceptance flow and correct every permission or
  usability problem it exposes.
- Audit **Команда** and **Налаштування** by ownership and incident value. Remove
  duplicate QuickTeam administration and inherited task-manager panels; retain
  only incident workflow, client access, in-app notifications and read-only
  QuickTeam state until another integration has an accepted support scenario.
- Add the explicit, idempotent server-side transfer from an incident to a
  QuickTeam task. Billing entitlement follows only after the wider product has a
  server-side add-on contract.

### Confirmed MVP information architecture

Internal support users:

1. **Огляд** — support workload, status counts, unassigned incidents and recent
   activity across all client projects.
2. **Інциденти** — one global queue with list and Kanban views; project/client,
   status, priority, assignee and date filters.
3. **Клієнти** — client projects, their team, configuration and incident counts.
4. **Команда** — the tenant's internal support team.
5. **Налаштування** — organization, workflows, invitations and integrations.

External client users:

1. **Мої звернення** — incidents in the one client project available to the
   signed-in user.
2. **Створити інцидент** — a prominent action, not a buried task-manager modal.
3. **Співробітники** — available only to `client_admin`, who may invite
   `client_member` users into that same project.
4. **Інцидент** — visible status, description, attachments and shared
   conversation; no workflow, priority, assignee or organization controls.

Sprints, planning calendars, time tracking, invoices, AI task estimation and
QuickTeam+ portal controls are not primary qTicket navigation. Do not delete
their inherited backend code merely to hide them; remove them from qTicket
surfaces first, then delete only when references and migrations are understood.

### Active build sequence and handoff rule

1. **Completed:** implement role-aware qTicket navigation and the internal
   **Огляд** screen using only shared components from `src/components/ui`.
2. **Completed:** turn the inherited cross-project board into the global
   **Інциденти** queue and remove sprint/task-manager controls from that surface.
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
8. Only after that flow is accepted, implement the incident-to-QuickTeam-task
   transfer contract. Any later billing work belongs to QuickTeam; qTicket
   continues to consume only its active/inactive entitlement.

The exact next implementation task remains step 7: audit **Команда** and
**Налаштування**, continue the static role audit, and then run the two-sided
flow with separate staff, client-admin and client-member sessions.
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
| Public reply versus internal note | **Adopt** | Public `comments` remain shared with clients. Staff-only `internalNotes` are a separate Firestore collection, explicitly selected in the composer, excluded from client subscriptions and notifications, and protected by rules. Support-side `audit` is staff-only. |
| Queue and assignment | **Adapt** | Keep one opinionated global incident queue with project, status, priority, assignee and date filters plus manual assignment. Reject custom queue builders, support groups and automatic routing until real volume proves they are needed. |
| SLA and business hours | **Reject** | The owner rejected the whole category: no service-level policy, no promised first-response or resolution time, no business-hours calendar, no automatic pause while an incident waits for the client, and no post-resolution satisfaction rating. «Очікує відповіді» stays a status a person chooses, and a resolution date stays a date a person sets. Do not reopen this as a smaller version of itself. |
| Request forms | **Adapt** | Incident types provide customer-friendly categories; add only proven type-specific required fields. Reject a general conditional form builder in the MVP. |
| Audit and notifications | **Adapt** | Clients receive public replies and customer-facing status; staff receives internal notes and the support audit. In-app delivery stays split by audience. Email remains disconnected until Resend is intentionally enabled. |
| Internal team administration | **Reject duplication** | QuickTeam remains authoritative for staff enablement, roles and profile data. qTicket keeps only operational pickers and contextual read-only profiles, refuses every mutation of a QuickTeam-managed seat, and no longer offers an internal role or an invite link anywhere. Client employees remain qTicket-owned. |
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
- Finish the user-facing terminology pass on qTicket routes. The canonical
  collection and inherited internal code may remain `issues`/task-oriented,
  but a client must never be asked to create, edit or filter a «завдання».
- **Completed:** incident conversation now has explicit «Відповідь клієнту» and
  staff-only «Внутрішня нотатка» modes. The latter is stored under separately
  ruled `internalNotes`; clients cannot subscribe to it or the support audit.
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

### QuickTeam+ convergence and hardening

- Converge the modern OAuth/secondary-Firebase flow and the legacy portal route instead of growing both independently.
- Remove the split configuration between `NEXT_PUBLIC_QTPLUS_URL` and `NEXT_PUBLIC_PORTAL_URL`.
- Enforce a clear uniqueness policy for portal-project links.
- Provide a reconnect path for revoked/invalid grants on already linked projects.
- Tighten provider rules and add live cross-repository smoke coverage before a broad client rollout.

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
cleanup is by hand and takes a minute: cancel those tasks with the new action,
then delete the status in «Налаштування» → «Статуси інцидентів». No script.

**«Очікує відповіді» is the shared waiting category.** Historical built-in
labels «На перевірці», `Review` and `In Review` are presented with the qTicket
label on read. Custom labels remain untouched. The historical ids
`code-review`, `qa` and `client-approval` still resolve to this category.

The global «Інциденти» board groups by these categories. Moving a card resolves
the matching local status from that incident's client space, so a global drop
never writes a status that the client space does not own.

### Product polish

- Add a “hide completed” toggle to My Tasks, enabled by default.
- Implement a verified email-change flow with recent re-authentication.
- Continue accessibility and mobile-layout checks on the main workspace flows.
- Ask for the Web Notification permission. In-app, email and Telegram exist;
  the one channel that reaches a laptop with the tab in the background is the
  one never requested.
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
resend; and event-driven email and Telegram failures land in the same outbox the
reminders use.

One item of that list turned out to be wrong as written. **`birthday` is not a
dead type.** `ALLOWED_TYPES` does reject it, but that route is not how it is
sent: `createBirthdayNotifications` in `lib/server/reminderJobs.js` writes it
straight through the Admin SDK on the daily greeting sweep, and it reaches real
bells. The route rejects it on purpose — a greeting is addressed to a whole
organization on somebody else's behalf, and no browser should be able to send
one. What was actually wrong was that three lists disagreed in three files with
nothing holding them together; the registry in `notificationChannels.mjs`
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
  summary («3 задачі на завтра, 1 прострочена») is usually the only kind of
  notification people keep switched on.

### Задачі в аналітиці: лічильники замість повного набору

Час у звітах більше не читається сирим — денні підсумки в `analyticsRollups`
відповідають на «скільки годин за період» одним документом на проєкт на день
(див. ARCHITECTURE → «Аналітика»). Задачі так і лишились єдиною колекцією, яку
екран аналітики читає повністю.

Це не забули — це поки що не можна зробити чесно, і ось чому:

- Немає поля, за яким «відкриті» можна порахувати `count()`. Закритість задачі
  живе в категорії її статусу, а статуси налаштовуються по проєктах, тож запит
  мусив би бути `columnId in [...]` — а `in` тримає щонайбільше 30 значень.
- `archivedAt` і `cancelledAt` відсутні на документі, поки не виставлені, а
  Firestore не вміє питати «поля немає». `count()` без цього рахував би
  архівні й скасовані задачі, тобто давав би відповідь, гіршу за поточну.
- Дві знахідки з «Що потребує уваги» взагалі не виражаються запитом:
  «заблоковані залежностями» читає `issueLinks`, «без оцінки» — категорію
статусу проєкту. Списки за ними доводиться будувати з повного набору.
- А `useIssues.js` і `issueCancel.mjs` навмисно фільтрують у місці читання, а
  не в запиті, саме тому, що кожен потік задач і так обмежений проєктом.

Щоб це зрушити, потрібне денормалізоване поле стану на самій задачі
(`open`/`delivered`), яке пишуть ті самі серверні маршрути, що вже пишуть
статус, плюс backfill `archivedAt`/`cancelledAt` у явний `null`. Це той самий
крок, що вже описаний в ARCHITECTURE → «Що лишилось дорогим навмисно» як
лічильники на документі проєкту. Робити його варто лише після вимірювання
реального обсягу даних: він змінює те, що картка може показувати наживо, але не
повинен створювати локальний тариф або штучне обмеження qTicket.

Поки цього немає, вартість обмежена вікном і тим, що задача — скінченна
множина: вона росте з обсягом роботи, а не з віком робочого простору.

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
- Intake forms for external requests.
- Goals/OKR tracking.
- User-configurable automation rules.
- AI project summaries and task assistance.
- A client-safe AI status digest delivered through QuickTeam+.

Commercial billing, checkout and subscription contracts belong to QuickTeam,
not to the qTicket product backlog. qTicket consumes only the signed add-on
entitlement.
