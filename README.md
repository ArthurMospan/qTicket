# qTicket

Multi-tenant incident and client-support SaaS built with Next.js 16, React 19 and Firebase. qTicket is an optional product alongside QuickTeam: a subscribing organization configures its support space, creates projects for its clients, and invites each client into the appropriate project.

The codebase starts from the QuickTeam workspace so it can preserve the same `/ui-kit`, interaction language, and proven task mechanics. qTicket, QuickTeam, and QuickTeam+ remain separate applications and data stores. The inherited `issues` collection is the canonical incident record until a deliberate migration says otherwise; all user-facing qTicket copy calls it an incident.

## Requirements

- Node.js 22+
- Java 21+ for the Firestore emulator
- A Firebase project for local development
- Cloudinary credentials for file uploads
- No email provider is required for the current manual-invitation rollout

## Environment

Create `.env.local` with:

```text
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_GITHUB_LOGIN_ENABLED=false

FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_PORTAL_URL=

# Transactional email (leave blank for the current no-email rollout)
RESEND_API_KEY=
BREVO_API_KEY=
EMAIL_FROM=
EMAIL_LOGIN_ENABLED=false
AUTH_OTP_SECRET=

# Optional AI call-to-tasks.
# Ліміти Gemini рахуються на ключ, тож сюди можна покласти кілька ключів через
# кому — запити ходять по них по черзі й переходять на наступний, щойно один
# упреться в квоту. GEMINI_API_KEYS — синонім, обидві змінні складаються.
GEMINI_API_KEY=
GEMINI_API_KEYS=
GEMINI_MODEL=gemini-flash-latest

# Optional OneB login
NEXT_PUBLIC_ONEB_CLIENT_ID=
NEXT_PUBLIC_ONEB_REDIRECT_URI=
NEXT_PUBLIC_ONEB_SCOPES=
ONEB_CLIENT_SECRET=

# Optional QuickTeam+ integration
NEXT_PUBLIC_QTPLUS_URL=
QTPLUS_CLIENT_SECRET=
QTPLUS_TOKEN_KEY=

# Optional Telegram integration
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=

# Scheduled calendar/deadline notifications (production)
CRON_SECRET=

```

`NEXT_PUBLIC_*` values are shipped to the browser. Never put Admin SDK, Cloudinary secret, email-provider secret, API keys or other credentials in a public variable.

The current rollout deliberately leaves `RESEND_API_KEY`, `BREVO_API_KEY`, `EMAIL_FROM`, and `AUTH_OTP_SECRET` blank, keeps `EMAIL_LOGIN_ENABLED=false`, and uses Google as the client sign-in provider. Creating an invitation still writes a pending, project-scoped access grant. qTicket then shows a ready-to-copy instruction for a messenger: the invited person opens `/login?mode=client` and signs in with the Google account whose verified email exactly matches the address entered by the client administrator. The invitation is accepted automatically after that first sign-in. No email is sent, and the interface must not claim otherwise.

GitHub login is optional. Enable the GitHub provider in Firebase and set `NEXT_PUBLIC_GITHUB_LOGIN_ENABLED=true` only after its OAuth client ID and secret are configured; qTicket hides that button by default so a client is never offered a provider that cannot work.

Transactional email can be enabled later without changing the invitation model. Delivery prefers Resend when both provider keys are configured; Brevo is the fallback. Resend requires a verified sending domain, Brevo requires a verified sender, and `EMAIL_FROM` must match that provider configuration. Email-code login remains a separate opt-in and stays disabled unless `EMAIL_LOGIN_ENABLED=true`.

## First test deployment without email

Keep qTicket isolated from QuickTeam at every step below: create a new Firebase
project, a new GitHub repository and a new Vercel project. Do not copy
QuickTeam's Firebase Admin key or reuse its Firestore database.

### 1. Create the Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/), click **Add
   project** and use a distinct name such as `qTicket Test`. Pick a distinct,
   readable project id when Firebase offers it. Google Analytics is optional and
   can stay disabled for the first test.
2. On **Project overview**, click the web icon **`</>`**, enter `qTicket Web`,
   leave Firebase Hosting unchecked and click **Register app**.
3. Keep the displayed `firebaseConfig` open. Its values map directly to the six
   `NEXT_PUBLIC_FIREBASE_*` variables listed above. These browser values identify
   the project; they are not the Admin SDK secret.
4. Open **Build → Authentication → Get started → Sign-in method → Google**,
   switch **Enable** on, select the project support email and click **Save**.
   Do not enable GitHub or email-link login yet.
5. Open **Authentication → Settings → Authorized domains → Add domain** and add
   `localhost`. New Firebase projects may not add it automatically. After the
   Vercel deployment, return here and add its exact hostname, for example
   `qticket-test.vercel.app`, without `https://` and without a path.
6. Open **Build → Firestore Database → Create database**. Choose the Standard
   edition, the default database, **Production mode**, and a European location.
   `eur3 (Europe)` is the preferred multi-region location for the first hosted
   project when it is offered. This location cannot be changed later.
7. Open the gear beside **Project overview → Project settings → Service
   accounts → Firebase Admin SDK → Generate new private key → Generate key**.
   Store the downloaded JSON outside this repository. Never commit it and never
   paste the whole file into an issue or chat. Copy only its `client_email` and
   `private_key` values into the private environment variables described below.

Create `C:\Users\Arthu\QuickTeam\qTicket\.env.local` locally. Use the six web
values from `firebaseConfig`; use the Admin JSON only for the two private
server values:

```text
NEXT_PUBLIC_FIREBASE_API_KEY=<firebaseConfig.apiKey>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<firebaseConfig.authDomain>
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<firebaseConfig.projectId>
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<firebaseConfig.storageBucket>
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<firebaseConfig.messagingSenderId>
NEXT_PUBLIC_FIREBASE_APP_ID=<firebaseConfig.appId>
NEXT_PUBLIC_GITHUB_LOGIN_ENABLED=false

FIREBASE_CLIENT_EMAIL=<service-account client_email>
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

NEXT_PUBLIC_APP_URL=http://localhost:3000
EMAIL_LOGIN_ENABLED=false
```

The literal `\n` sequences in the private key are intentional; the server
converts them back to line breaks. Keep Resend, Brevo, `EMAIL_FROM` and
`AUTH_OTP_SECRET` absent or blank.

Once the project id is known, deploy the reviewed rules and indexes from this
folder. The explicit `--project` prevents an accidental deploy to QuickTeam:

```powershell
npx firebase login
npx firebase deploy --project YOUR_QTICKET_PROJECT_ID --only firestore
```

### 2. Create the Cloudinary environment

1. Sign in to [Cloudinary Console](https://console.cloudinary.com/). Prefer a
   separate qTicket product environment; a separate free account is also fine
   for the test.
2. Open **Settings → API Keys**. Copy **Cloud name**, **API key** and **API
   secret** into `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and
   `CLOUDINARY_API_SECRET` in `.env.local`.
3. `CLOUDINARY_API_SECRET` is server-only. Never name it with a
   `NEXT_PUBLIC_` prefix and never send it to a client browser.

### 3. Create GitHub and Vercel projects

1. In GitHub click **New repository**, name it `qTicket`, choose **Private** and
   create it empty: do not add a README, `.gitignore` or license. This folder is
   not initialized as a Git repository yet; once the empty repository URL is
   available, initialize and push this folder as its first commit.
2. In the [Vercel dashboard](https://vercel.com/dashboard), select the correct
   team, click **Add New… → Project**, import the new `qTicket` repository and
   keep **Framework Preset: Next.js**. If the repository contains qTicket at its
   root, leave **Root Directory** as `.`.
3. Before deploying, expand **Environment Variables**. Add the same Firebase
   and Cloudinary variables used locally, plus `EMAIL_LOGIN_ENABLED=false` and
   `NEXT_PUBLIC_GITHUB_LOGIN_ENABLED=false`. Omit all Resend/Brevo variables.
   Add `FIREBASE_PRIVATE_KEY` as the same one-line value containing literal
   `\n`; mark private server values as sensitive when Vercel offers that option.
4. Set `NEXT_PUBLIC_APP_URL` to the expected Vercel origin if its hostname is
   already known; otherwise deploy once, copy the assigned `https://…vercel.app`
   URL, update this variable under **Project → Settings → Environment
   Variables**, and redeploy from **Deployments → latest deployment → … →
   Redeploy**.
5. Add the Vercel hostname to Firebase **Authentication → Settings → Authorized
   domains**. No custom domain and no Resend configuration are required for this
   test deployment.

Environment-variable changes apply only to a new Vercel deployment. A successful
deployment with the wrong old values is still running with the wrong old values
until it is redeployed.

### 4. Run the two-sided acceptance check

Use separate Chrome profiles or an incognito window and at least two Google
accounts whose addresses you know exactly.

1. The tenant owner signs in, completes onboarding, creates the support
   organization and creates one project for the test client.
2. Open **Команда → Запросити**, choose **Адміністратор клієнта**, choose that
   one project, enter the client's Google email and click **Запросити**.
3. Because email is disabled, click **Скопіювати інструкцію** and send that text
   to the client in a messenger.
4. The client opens the copied `/login?mode=client` address and signs in with the
   exact invited Google account. They must see only their project, create an
   incident and reply in its discussion. They must not be able to change status,
   priority, assignee or project settings.
5. As that client administrator, open **Налаштування → Співробітники клієнта →
   Запросити співробітника**, enter a second Google address, click **Надати
   доступ**, copy the instruction and sign the employee in separately.
6. The employee must see the same single client project and its incidents, but
   must not see the button for inviting more people.
7. Return as internal support staff, answer in the incident, change its status,
   priority and assignee, and confirm both client accounts can see those changes
   without gaining the controls themselves.

Do not start the production Firebase/Vercel setup until this complete test passes
against the isolated test project.

For Telegram, create one bot through BotFather, put its token and username in the server-only variables above, and use a random webhook secret (32+ characters). The app registers `/api/integrations/telegram/webhook` when a user or organization starts a connection. `NEXT_PUBLIC_APP_URL` must therefore be a public HTTPS origin outside local development.

Calendar and deadline notifications are generated by the protected `/api/cron/notifications` job, so they do not depend on anyone having QuickTeam open. During hosted testing, point an external HTTP scheduler at `?mode=dispatch` every minute and `?mode=materialise` every twenty minutes (or call the default `full` mode every minute). Set the same `CRON_SECRET` in the deployed environment and in the scheduler. The GitHub Actions schedule remains a fallback only because scheduled workflow timing is not punctual enough for reminders.

The scheduled outbox tracks retries and each channel separately. Dispatch reads only rows ready for an attempt; materialisation uses its own watermark so frequent dispatch calls cannot hide an outage. The complete design and the later move to an in-process scheduler on the own server are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Local development intentionally has no Telegram credentials by default, but an existing production binding can still be disconnected from localhost.

The inherited QuickTeam+ integration is not qTicket authentication. qTicket will use an explicit server-side QuickTeam contract for staff identity, add-on entitlement, and the manual “create QuickTeam task” action. External clients authenticate in qTicket's own Firebase project; their pending invitation is matched against the verified email returned by Google or GitHub. The products must not share primary Firebase sessions or databases.

## Commands

```bash
npm run dev
npm run lint
npm run test:unit
npm run test:rules:emulator
npm run build
npm run kit:scan
npm run kit:drift
npm run kit:audit
npm run kit:props
npm run kit:states
npm run kit:a11y
npm run test:visual
```

On Windows with Firebase CLI 15 and Node 24, the rules assertions can finish successfully while the CLI reports an error during emulator shutdown. Always check the Node test summary (`pass`, `fail`) separately from that known teardown error.

## Security model

- Firebase ID tokens authenticate API requests.
- `/api/auth/session` exchanges an ID token for an HTTP-only Firebase session cookie used by Next.js Proxy.
- Firestore rules remain authoritative for browser Firestore access.
- Organizations and memberships are created only by authenticated server routes (`/api/organizations` for the first pair, the invitation APIs for the rest); every `create` on both collections is refused from a browser.
- Roles are `owner`, `admin`, `member`, `client_admin`, and `client_member`. Owner, admin, and member are the tenant's internal support team. Owner and admin manage the organization; an admin may also change internal roles. The owner seat moves only through the ownership-transfer route, and the owner cannot be deactivated or demoted while holding it.
- Client roles are scoped by `project.team`. They may see all incidents in their assigned client project, create an incident, read its history, reply, and attach files. They cannot change status, priority, assignee, organization/project settings, or access internal support channels. Firestore rules and server routes enforce the boundary; hiding controls is only defensive UI.
- A `client_admin` may invite only `client_member` users, into exactly one project the client admin already belongs to. A `client_member` cannot invite users. Internal owners/admins retain organization-wide administration.
- The inherited internal `member` role remains a support agent to avoid weakening proven QuickTeam mechanics during the fork; it is not a client role.
- Owners and admins may delete another person's comment or group-channel message, never edit one. Direct rooms are neither readable nor moderatable by them.
- Taking access away deletes the `orgMemberships` document and archives it under `orgMembershipArchive`, and removes the person from `project.team`. Their tasks, comments, watches and time logs are never rewritten. Restoring the archived seat returns the same role, position and projects. Leaving on your own uses the same route and needs no privilege.
- Projects and incidents are created through server APIs so plan limits, sequential incident keys and audit records are atomic.
- Incident hierarchy, logical links and status transitions are validated by server APIs; external clients cannot bypass their execution invariants.
- Invoice creation reserves and freezes its exact raw time-log sources transactionally.
- `timerStates/{uid}` is account-owned and server-written: one active timer and one pending log at most, shared across organizations, tabs and devices.
- API keys live under a server-only Firestore path and are stored as SHA-256 hashes. The clear-text token is returned only once.
- Cloudinary signing, notifications/email, invitations and integration endpoints are authenticated and rate-limited.
- User documents are private; shared team profile fields and presence are organization-scoped.

## Data model

Primary collections:

- `organizations`, `orgMemberships` and `orgMembershipArchive` (deactivated seats, server-only)
- `projects` (client workspaces) and `stages`
- `issues` (incidents), with `comments` and `audit` subcollections
- `issueLinks`, `sprints`, `timeLogs`, `timerStates`, `invoices`
- `notifications`; presence under `organizations/{orgId}/presence`
- `system/notificationSweep` — the scheduled sweep's watermark and last counts. Server-written only; Firestore rules have no `system` match, so browsers cannot read or forge it.
- organization-scoped `channels`, `messages` and `readState`

Archiving, cancelling and deleting a task are separate, and mean three different things.

**Архівувати** sets `archivedAt` through `/api/issues/[issueId]/archive`. The work happened and is over: the task leaves every working list and stays in the record — the timesheet, the invoice, and the numbers for the period it was worked in are unchanged. No expiry.

**Скасувати** sets `cancelledAt` through `/api/issues/[issueId]/cancel`. The work is not going to happen: the task leaves the record as well, and stops counting in progress, workload, velocity, billing, deadlines and search. It is filtered out at every stream that publishes issues rather than at each reader, so nothing downstream has to remember it exists. Refused when the task's hours are already fixed into an invoice — settled work can only be archived. No expiry.

**Видалити** moves the record into a `deletedIssues` tombstone with a 24-hour `purgeAfter`, after which the sweep removes it.

All three are reversible until the tombstone is purged; «Налаштування» → «Архів» lists projects, archived tasks, cancelled tasks and still-restorable deletions.

`tasks` is a legacy collection and is closed to browsers entirely — nothing in the product reads it, and its old rule was the last org-wide read path that ignored project scope. New development must use `issues`.

### Issue IDs

Each project owns an internal short `issuePrefix` (for example `ENG` or `DES`)
and an atomic `issueCounter`. Every project-scoped writer — the app, Telegram
and the public task API — consumes that same sequence, so keys such as `ENG-12`
are stable and unique inside the organization. The prefix is generated
automatically from the project name as 2–8 URL-safe ASCII letters or numbers,
with at least one letter;
it is not an editable project setting. The server transaction picks the first
readable free variant (`ENG`, `ENG2`, `ENG3`, ...) when names would collide.
Projects created before this field existed claim a free ASCII prefix inside
their next settings or task-creation transaction. Existing non-ASCII task keys
remain searchable, but links use the safe document id instead of putting those
keys into a URL; displayed legacy `WS-*` keys remain openable as aliases.

Workspace search ranks an exact issue key above titles and descriptions. In
chat, typing `#` plus at least two characters opens the same authorized search;
the selected `#ENG-12` reference renders as a task preview and opens the issue.

### Statuses have two layers

`organizations/{orgId}/settings/workflow` holds the organization's statuses. Each one carries a free label and a `category`, which is one of exactly five fixed values: `backlog`, `todo`, `in-progress`, `review`, `done`. Labels are local — an organization may have as many as it likes, named whatever it likes. Categories are shared, and every surface that spans projects reads them: «Мої завдання» builds its columns from categories, and `done` is what closes a task, so `completedAt`, progress, velocity, overdue and invoices all follow the category and nothing else. `isDone` is still written, derived from the category, for documents and clients that predate it.

`review` — «На перевірці» — is work handed over and waiting on somebody else: a review, a QA pass, a client's approval. It neither closes a task nor delivers anything, which is the point of having it. A task sitting there is still open, still blocks whatever it blocked, and can still run past its deadline, while the person who wrote it is no longer the one it is waiting on. Dropped work is not a category at all: see «Скасувати» above.

The rules live in [src/lib/utils/statusCategories.mjs](src/lib/utils/statusCategories.mjs) and are shared by the client and the server routes. A workflow saved before categories existed needs no migration: its category is derived from what it already says (an explicit `isDone`, a built-in id, the entry column), and the terminal set it had is preserved exactly. The next save through `/api/organizations/{organizationId}/workflow` writes the resolved categories out, and that API refuses a workflow with nothing to finish in or nothing to start in.

A project board's columns are that project's statuses, and `projects/{id}.hiddenColumns` may switch some off. A board that spans projects cannot use status names as columns for that reason, which is what categories are for: a drop on a category column writes a status of that category belonging to the task's own project, so no cross-project drop can be refused by a project setting.

## Development rules

- Read the versioned Next.js guides in `node_modules/next/dist/docs/` before changing framework APIs.
- Do not run migrations from browser login flows. Use reviewed Admin SDK scripts against an explicit project.
- Do not add direct client creates/deletes for projects, issues, memberships or API keys.
- Any Firestore rule change must include or update emulator assertions in `tests/firestore.rules.test.mjs`.

## Documentation

- [The rules a change must obey](AGENTS.md)
- [How the task model, view state, read state and notification delivery work](docs/ARCHITECTURE.md)
- [UI Kit contract](docs/UI_KIT_CONTRACT.md)
- [Product guardrails and open work](docs/ROADMAP.md)
- [Data migration runbooks](docs/MIGRATIONS.md)
- [QuickTeam+ integration](docs/integrations/QUICKTEAM_PLUS.md)
- [Telegram integration](docs/integrations/TELEGRAM.md)
- [YouTrack migration](docs/integrations/YOUTRACK_MIGRATION.md)
