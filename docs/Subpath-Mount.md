# Main-origin mount

Target application base: `/interlock-expeditions/`. The standalone build and handler retain `/` as their default. The source repository and existing D1 database remain separate from BinSite.

## Frontend artifact

From this repository, call:

```powershell
./scripts/Publish.ps1 -BasePath '/interlock-expeditions/' -Destination '<BinSite absolute path>/public/interlock-expeditions/'
```

`-Output` optionally selects the intermediate .NET publish directory; `-NoRestore` uses restored packages. A mounted build requires an explicit destination. The artifact has `<base href="/interlock-expeditions/">` and relative navigation, API and device-module paths, with an independent `_framework` directory.

Merge the generated `_headers` and `_redirects` into the main site's root configuration. Redirects contain only host/account/help/privacy/membership and `control/:roomId` / `room/:roomId`; they never redirect assets or `_framework`. Header paths are scoped below the application prefix. Main Pages invocation routes must include `/interlock-expeditions/api/*`. The bare prefix redirects to its slash-terminated base.

## Selected backend: fixed-destination authenticated relay

Only `server/mount-gateway.mjs` needs to be copied into `integrations/mounted/interlock-expeditions/server/` on the main host. It has no imports. A main Pages function at `functions/interlock-expeditions/api/[[path]].js` can import `relayMountedRequest` and call it with the original `{request,env}`. It reads only `INTERLOCK_GATEWAY_SECRET`; the main host does not receive Interlock's database binding or original PRIVATE_SALT.

The fixed main origin is `https://muhammetozeski-binsite.pages.dev`; the only destination is `https://muhammetozeski-interlock-expeditions.pages.dev/api/`. The legacy handler calls the same file's `authenticateMountedRequest(request,env)` using `TRUSTED_GATEWAY_SECRET`. The original PRIVATE_SALT and D1 remain exclusively at the legacy service. Secret provisioning and deployment are separate owner/integration actions; values are never written to this repository.

The versioned HMAC binds method, exact logical mounted path/query, unchanged browser Origin, body digest and Unix-seconds timestamp. It also binds a digest of the forwarded content type, app cookies, player headers and a gateway-derived client rate identity. Signatures are accepted only within 60 seconds in either direction. This preserves per-client request limiting without relying on a relay transport's connection address. No credentials are logged or returned through a gateway-management endpoint.

Only current app GET/POST routes are forwarded, with a 12,000-byte streaming body limit and no automatic transport retry. Browser-supplied gateway headers and unrelated cookies are discarded; only ie_account/ie_guest and the typed player headers can cross the relay. Off-origin POSTs and preview hosts are rejected before signing. The legacy service constructs the logical main-host Request only after validating the transport signature, retaining the original Origin for its usual CSRF check. Returned app cookies must already have the correct mounted scope; unknown/domain-scoped cookies are refused, not blindly rewritten. Provider webhooks are never relayed and remain on the original endpoint. Existing domain request identifiers keep their original replay semantics.

## Optional direct-mount source manifest and prerequisite

Minimal relative runtime files under `integrations/mounted/interlock-expeditions/`:

- `functions/api/[[path]].js`
- `server/accounts.mjs`
- `server/billing.mjs`
- `server/rooms.mjs`
- `server/engine.mjs`
- `server/security.mjs`
- `server/paths.mjs`
- `server/mount-gateway.mjs`
- `content/episodes.mjs`
- `content/further-episodes.mjs`

The entry exports `onRequest({request,env})`. Preserve the real main-host Request URL and Origin. Set `APP_BASE_PATH='/interlock-expeditions/'`; the handler verifies/removes its own prefix and keeps its existing same-Origin check.

Direct-mount env names are `DB`, `PRIVATE_SALT` and the optional `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CLUB_PRICE`. Proposed main aliases are `INTERLOCK_DB`, `INTERLOCK_PRIVATE_SALT`, `INTERLOCK_STRIPE_SECRET_KEY`, `INTERLOCK_STRIPE_WEBHOOK_SECRET`, `INTERLOCK_STRIPE_CLUB_PRICE`. Map only these product-specific values, with no general payment fallback.

Existing D1: name `interlock-expeditions`, ID `f59d2c9d-a1be-4bcc-bb1b-3ba3d3a2a976`; standalone binding `DB`. Reuse it without changing records or schema.

**The exact original PRIVATE_SALT is required for a direct mount.** It derives printable invitation codes and per-player reconnect HMACs, not only rate-limit identities. A replacement or rate-secret derivative would break existing codes/access. The reviewed initializer generates this value in memory only when the original Pages project is created and sends it as secret_text. It writes only public hosting metadata locally. No original value was found in the current process or the known root ignored-config locations during preparation. Cloudflare's redacted secret response is not a recoverable value. Do not activate the direct main-host handler with a replacement salt.

## Sessions, links and payment returns

Host cookie `ie_account` and guest cookie `ie_guest` retain `HttpOnly; Secure; SameSite=Strict`; mounted set/clear cookies use Path `/interlock-expeditions/api`. The old deployment still defaults to Path `/api`. Cookies and device storage from the old hostname cannot transfer automatically. A host recovery key reopens the same account using the same database. Existing guests may continue on the old hostname; a new main-host player is a separate join unless their existing capability is restored through an explicitly implemented migration.

Invitations are built from `Navigation.BaseUri` and retain the room ID/code. The API returns room IDs and invitation codes rather than hardcoded room URLs. Billing checkout success/cancel/portal returns use the real Request origin plus the configured application base. The old deployment's `/api/billing/webhook` and original HMAC remain untouched.

## Preparation evidence

The real prefix publish completed locally. Its base tag, relative assets, explicit SPA routes and scoped header output were manually read. A combined 21-assertion actual in-memory SQLite request check with StageFold covered mounted account/room/guest access, set/clear cookie scope, recovery, wrong-prefix and cross-Origin refusal. With the same test database/salt, a guest also reconnected through the unchanged legacy endpoint. A further 21 gateway checks used actual HMAC and SQLite handlers to verify a signed account creation/read, stripped unrelated cookies/browser gateway signature, unchanged Origin/salt, body/path/query/origin/authority/signature tamper refusal, timestamp rejection, no rejected-request database effects, no webhook/preview relay, streaming body bounds and unchanged direct legacy account/webhook routing. No production salt, room, account or database was changed by these fixtures. Native main-host browser acceptance remains part of the eventual integration.
