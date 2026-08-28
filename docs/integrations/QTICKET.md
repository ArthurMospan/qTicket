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

The response contains the stable qTicket `organizationId`, applied `revision`
and `status: applied | unchanged`.

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

The later incident-to-task action is a separate idempotent server contract. It
must not reuse the staff launch code or turn either database into a mirror of
the other.
