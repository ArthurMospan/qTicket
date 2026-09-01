# QuickTeam → qTicket integration

qTicket is a separate SaaS add-on. QuickTeam owns the internal organization,
its branding, add-on entitlement and the list of staff enabled for support.
qTicket owns client projects, incidents, external client identities and every
permission enforced inside the support product. The two products never share a
Firebase project, primary browser session or database.

## Contract status

Both repositories implement version 1: QuickTeam has the owner activation,
existing-member selection, signed provisioning and launch producer; qTicket has
the provisioning, launch and one-time token consumers. Production use still
requires the same shared secret on both deployments and a live two-account
acceptance check. A plain qTicket `/login` is client-only. The native staff form
is an opt-in development/recovery path, never production onboarding.

## Configuration

Both servers receive the same random secret with at least 32 characters:

```text
QUICKTEAM_QTICKET_SHARED_SECRET=
```

QuickTeam also needs the qTicket origin:

```text
NEXT_PUBLIC_QTICKET_URL=https://qticket.example.com
```

qTicket uses its existing `NEXT_PUBLIC_APP_URL` when it builds a one-time launch
URL. Secrets are server-only and never use a `NEXT_PUBLIC_` prefix.

## Signed server requests

QuickTeam calls the provisioning and launch endpoints server-to-server with:

```text
Content-Type: application/json
X-QT-Timestamp: <Unix seconds>
X-QT-Nonce: <random base64url value, at least 16 characters>
X-QT-Signature: <lowercase HMAC-SHA256 hex>
```

The signed bytes are the exact UTF-8 request body prefixed by:

```text
v1\n<Timestamp>\n<Nonce>\n<exact body>
```

The signature key is `QUICKTEAM_QTICKET_SHARED_SECRET`. qTicket accepts a
five-minute clock window, compares signatures in constant time and stores each
nonce before processing the payload. Reusing a nonce returns `409 replay`.

## Provisioning

`POST /api/integrations/quickteam/provision` receives the complete desired
staff snapshot, not a list of changes:

```json
{
  "version": 1,
  "sourceOrganizationId": "quickteam-org-id",
  "revision": 7,
  "entitlement": "active",
  "organization": {
    "name": "OneB",
    "logo": "https://cdn.example/logo.png",
    "sidebarTheme": "custom",
    "sidebarColor": "#1c1c1c",
    "timezone": "Europe/Kyiv"
  },
  "staff": [
    {
      "sourceUserId": "quickteam-user-id",
      "email": "owner@example.com",
      "name": "Arthur",
      "avatar": "https://cdn.example/avatar.png",
      "role": "owner"
    }
  ]
}
```

Rules of the snapshot:

- `revision` is a monotonically increasing integer per QuickTeam organization;
  an equal or older snapshot is an idempotent `unchanged` response.
- Exactly one selected staff member has `owner`. Other internal roles are
  `admin` and `member`; the latter is shown as «Менеджер підтримки» in qTicket.
- Client roles never arrive from QuickTeam. `client_admin` and `client_member`
  are qTicket-native, project-scoped identities.
- qTicket maps source ids to opaque stable ids. If the verified email already
  belongs to a qTicket Firebase account, that account is linked instead of
  creating a duplicate identity.
- That linking stops at a customer. A qTicket membership is one document per
  person per organization holding one role, so a staff seat written over a
  `client_admin` or `client_member` does not add a relationship — it replaces
  one, hands an external person every other customer's queue, and retroactively
  moves everything they ever wrote from «клієнт написав» to «підтримка
  відповіла». Such a member is **skipped**: no seat, no identity mapping, no
  profile rewrite, and no Firebase account touched. The response lists them
  under `conflicts` (`sourceUserId`, `email`, `requestedRole`, `currentRole`) so
  QuickTeam can tell the administrator why that colleague has no qTicket seat.
  The remedy is a different address, or removing the client seat in qTicket
  first — never a silent conversion. The mirror direction has always been
  refused: qTicket will not invite an existing staff member as a customer.
- The `owner` of a snapshot is the one collision that refuses the whole
  snapshot with `409 client_seat_conflict` and writes nothing, because the
  organization document names exactly one and half of that state is not a state.
- Staff absent from a newer complete snapshot lose their membership, receive an
  archived seat and are removed from every qTicket client-project roster. Their
  incidents, comments, audit history and time records are not rewritten.
- Branding is copied into `organization.portalBranding` with source
  `quickteam`. The external client shell draws this snapshot even though the
  staff shell and client-facing portal branding are separate concerns.
- Provisioning does not copy QuickTeam projects or tasks. A qTicket client
  project is a support boundary owned by qTicket.
- A snapshot with `entitlement: "inactive"` immediately refuses new launches
  and makes existing staff/client sessions lose organization access on their
  next server call or Firestore read. It preserves the organization, client
  identities, incidents, discussion and audit history so a newer active
  snapshot can restore the same support space.
- That preservation is what a *suspension* means, and it presupposes something
  to suspend. A first snapshot for an organization qTicket has never seen, whose
  entitlement is already `inactive`, is not a suspension: it describes a
  QuickTeam organization that is not a qTicket customer. qTicket writes nothing
  at all for it — no organization, no staff seats, and no Firebase identities —
  and answers `status: "skipped"`. A seat is what puts an organization in the
  workspace switcher, and nothing later takes it back out, so an organization
  that was never a customer would otherwise stay in every one of its staff
  members' switchers for good, refusing every read they made of it. QuickTeam
  may therefore send the whole estate; only its customers land here.

The response contains the stable qTicket `organizationId`, applied `revision`
and `status: applied | unchanged | skipped`, plus `conflicts` when the snapshot
named somebody who already holds a client seat.

## Staff launch and session separation

The browser never carries the shared secret and QuickTeam never receives a
qTicket Firebase custom token.

1. An authenticated QuickTeam server calls
   `POST /api/integrations/quickteam/launch` with a signed body:

   ```json
   {
     "version": 1,
     "sourceOrganizationId": "quickteam-org-id",
     "sourceUserId": "quickteam-user-id",
     "returnTo": "/overview"
   }
   ```

2. qTicket verifies that the add-on is active and that this user is in the
   provisioned internal staff snapshot.
3. qTicket returns a `launchUrl` containing an opaque 256-bit code valid for 90
   seconds.
4. QuickTeam redirects the browser to that URL.
5. `/login/quickteam` sends the code to
   `POST /api/integrations/quickteam/consume`. qTicket deletes the code in a
   transaction before returning its own Firebase custom token to its own
   browser origin.
6. The qTicket client signs into qTicket Firebase and creates the regular
   `qt_session` cookie. QuickTeam cookies and tokens never cross this boundary.

Launch codes are single-use. An expired, consumed or revoked staff launch is a
new launch from QuickTeam, never a reusable fallback password.

## Unread badge

QuickTeam draws one number beside its own qTicket rail row, so somebody working
in QuickTeam can see that a client wrote without opening the other product.

`POST /api/integrations/quickteam/unread` is signed the same way and receives:

```json
{
  "version": 1,
  "sourceOrganizationId": "quickteam-org-id",
  "sourceUserId": "quickteam-user-id"
}
```

It answers `{ "version": 1, "unread": 3 }` and nothing else — no incident title,
no client name, no issue key. A badge is a reason to open qTicket, not a copy of
the bell that lives inside it; the copy would be a second inbox to keep
truthful. It refuses exactly as a launch does: `inactive` (403) when the add-on
is off for that organization, `not_enabled` (403) when the person holds no
internal qTicket seat. An organization that turned qTicket off stops publishing
counts about itself.

Two deliberate exceptions to the rules above:

- **No nonce is recorded.** Every other signed endpoint stores the nonce before
  processing and answers `409 replay` to a repeat. This one is asked on every
  QuickTeam rail mount and changes nothing, while a nonce costs a Firestore
  transaction with a write in it — the tighter of the two free-tier budgets. A
  replayed read returns the number the caller already had. The signature and the
  five-minute clock window still apply.
- **QuickTeam caches the answer** for 60 seconds per organization and user, so a
  browser reloading QuickTeam does not turn into one cross-service request per
  page view. The badge is allowed to be a minute stale; it is a hint, and the
  number that matters is the one inside qTicket.

A failure to reach qTicket is not a failure of the QuickTeam rail: the badge is
simply absent, and the row still opens the product.

## Transferring a request into a QuickTeam task

The one call that goes the other way: qTicket signs, QuickTeam verifies. Same
secret, same headers, same five-minute window; qTicket reads QuickTeam's origin
from `NEXT_PUBLIC_QUICKTEAM_URL`.

Support opens a request, chooses **«Створити завдання в QuickTeam»**, and picks
the QuickTeam project in a dialog. Two endpoints answer it:

- `POST /api/integrations/qticket/projects` — the projects that person may write
  to in QuickTeam, asked at the moment of choosing. qTicket keeps no copy of
  them; a stale copy is how somebody is offered a place they can no longer
  write to.
- `POST /api/integrations/qticket/tasks` — creates the task. The body carries
  `projectId` and an `incident` — its qTicket id, key, title and the description
  qTicket composed, including the link back. QuickTeam invents no prose about a
  record it cannot read.

**Idempotent on the qTicket request id.** QuickTeam claims
`qticketTransfers/{hash}` before it writes the task and deletes the claim if the
write fails, so a second press returns the first task (`status: "existing"`)
rather than making a second one, and a failed attempt does not lock the request
out. A press that arrives while another is still in flight is refused with
`transfer_in_progress`.

The task is written through QuickTeam's own `createIssueForActor` — the same
path its composer uses — so the issue key, the project counters, the audit row
and the reminder rows are the ones any task there would have. The person who
pressed the button is its author; QuickTeam authorizes them by the
`sourceUserId` provisioning gave qTicket, and refuses when the add-on is
inactive, when that person is not in the staff selection, or when their seat is
gone.

**The request stays a request.** Nothing here closes it, moves it or hides it:
the client keeps writing in it and support keeps answering. The incident
document is not written at all — a transfer is not activity the customer was
shown, and it must not push their request to the top of their own list.

What is written is two support-side documents:
`issues/{id}/internal/quickteam` (task id, key, project, url) and one audit
line, «Створено завдання в QuickTeam», under the fixed id `quickteam-transfer`
so a repeated press restates the same fact rather than adding a second line.
Both are staff-only in `firestore.rules`: where a supplier tracks the work is
routing, and routing is what this product deliberately does not show a client —
their board draws no assignee and their history is not readable, and a link into
somebody else's tracker is the same fact in a longer form.

## Source of truth

| Data | Authority |
| --- | --- |
| Internal organization identity and branding | QuickTeam |
| Add-on entitlement | QuickTeam provisioning/commercial authority |
| Enabled owner/admin/manager directory | QuickTeam selection |
| qTicket client projects and their support roster | qTicket |
| External client identities and invitations | qTicket |
| Incidents, shared client discussion and workflow | qTicket |
| A transferred task after explicit export | QuickTeam |

The incident-to-task action above is that separate idempotent contract. It
reuses neither the staff launch code nor any session, and turns neither database
into a mirror of the other: qTicket stores a link to the task, QuickTeam stores
the id of the request it came from, and neither reads the other's records.
