# QuickTeam+ integration

QuickTeam Workspace connects to the separate QuickTeam+ portal without sharing its primary Firebase session or database. The integration lets a workspace user link a QuickTeam+ account, associate a workspace project with a portal project, read portal stages/materials, and participate in the linked portal project chat.

## Two current flows

The codebase still contains two distinct integrations:

- The modern `qtplusLink` flow uses OAuth, a sealed personal grant, and a named secondary Firebase app. It powers project linking, live stages/materials, and portal chat.
- The legacy `/{projectId}/portal` route uses the primary Workspace Firebase app and legacy hooks.

Do not mix their sessions or data contracts. Converging them is tracked in [the roadmap](../ROADMAP.md).

## Configuration

Required on the Workspace server:

```text
NEXT_PUBLIC_QTPLUS_URL=
QTPLUS_CLIENT_SECRET=
QTPLUS_TOKEN_KEY=
NEXT_PUBLIC_PORTAL_URL=
```

- `NEXT_PUBLIC_QTPLUS_URL` is the QuickTeam+ origin.
- `QTPLUS_CLIENT_SECRET` must match the `quickteam-workspace` OAuth client registered in QuickTeam+.
- `QTPLUS_TOKEN_KEY` must be a base64-encoded 32-byte key. It encrypts refresh tokens with AES-256-GCM and must remain stable across deployments.
- `NEXT_PUBLIC_PORTAL_URL` is still required by the legacy organization-level Settings toggle. It is not a synonym for `NEXT_PUBLIC_QTPLUS_URL`.

The callback registered in QuickTeam+ must be:

```text
<workspace-origin>/api/integrations/qtplus/callback
```

The browser uses a separately named Firebase app for the portal. Production defaults are in `src/lib/portal/firebase.js`; deployments may override them with:

```text
NEXT_PUBLIC_QTPLUS_FB_API_KEY=
NEXT_PUBLIC_QTPLUS_FB_AUTH_DOMAIN=
NEXT_PUBLIC_QTPLUS_FB_PROJECT_ID=
NEXT_PUBLIC_QTPLUS_FB_APP_ID=
```

## Account-link flow

1. `GET /api/integrations/qtplus/connect` verifies the Workspace session and redirects to QuickTeam+ `/oauth/authorize`.
2. The flow binds `state` to a single-use HTTP-only nonce cookie to prevent callback forgery.
3. `GET /api/integrations/qtplus/callback` exchanges the authorization code server-to-server.
4. The refresh token is encrypted and stored at `users/{uid}/private/qtplus`, a server-only Firestore path. Client-facing status responses never expose it.
5. `GET /api/integrations/qtplus/session` exchanges the stored grant for a short-lived custom token and signs the browser into the secondary portal Firebase app.
6. `DELETE /api/integrations/qtplus` revokes the upstream grant when possible, removes the local link, and signs out the secondary Firebase app.

## Project data flow

- The organization feature flag lives at `organizations/{orgId}/settings/integrations.qtPortalEnabled`; only owners/admins may change it.
- A Workspace project stores only link metadata in `projects/{projectId}.qtplusLink`.
- Available portal projects are queried by `team array-contains <portal uid>`.
- Stages are read from the portal `stages` collection by `projectId`.
- Materials are read from `stages/{stageId}/materials`.
- Portal chat uses `projects/{portalProjectId}/messages` and `typing`; chat writes are intentionally limited to the dedicated portal-chat hook.
- Workspace Firestore and portal Firestore rules remain authoritative. UI gates are defensive, not security boundaries.

The modern tab is available when the build has `NEXT_PUBLIC_QTPLUS_URL` and either the organization integration is enabled for an owner/admin or the project already has a link. A member cannot link or unlink projects.

## Unlink and disconnect

- Unlinking a project removes its `qtplusLink` metadata but leaves the user’s personal account grant connected.
- Disconnecting an account deletes the personal grant and best-effort revokes it upstream, but does not remove links from Workspace projects.

These operations are deliberately separate. A linked project may therefore need an explicit unlink after account disconnect.

## Known limitations

- Modern and legacy flows still use different public URL variables.
- Portal-project link uniqueness is indicated in the UI but not enforced server-side.
- A revoked grant on an already linked project does not yet have a complete reconnect UX.
- Some legacy Settings copy describes synchronization that the modern direct-read flow does not perform.
- Pure tests do not replace a live cross-repository OAuth and provider-rules smoke test.

## Troubleshooting

- `not_configured`: check the URL, client secret, and token-encryption key.
- `state`: restart the connection; the nonce cookie and callback state did not match.
- `exchange` or `upstream`: verify the QuickTeam+ origin, OAuth client registration, callback URL, and portal availability.
- `grant_invalid`: reconnect the account; the stored grant was revoked or expired.
- `permission-denied` while listing portal data: verify the connected QuickTeam+ user is on the portal project team and that the project/stage IDs match.
- A project still appears linked after disconnect: unlink the project separately; this is expected.

Relevant tests:

```text
npm run test:oauth-state
npm run test:qtplus-exchange
npm run test:qtplus-link-model
npm run test:qtplus-material-view
npm run test:secret-box
```
