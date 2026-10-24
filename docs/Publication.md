# Publication and verification

Permanent source: `C:\E\Claude\WebSiteleri\InterlockExpeditions`.

Public repository: [InterlockExpeditions](https://github.com/muhammetozeski/InterlockExpeditions). Live origin: [Interlock Expeditions](https://muhammetozeski-interlock-expeditions.pages.dev).

The first deployment built the actual .NET 10 Blazor portal and published Pages Functions backed by this product's real D1 database. [The initial Actions run](https://github.com/muhammetozeski/InterlockExpeditions/actions/runs/40121035576) succeeded. Cloudflare setup creates only the named product resources, binds DB and stores PRIVATE_SALT as a secret. No credential is committed. `hosting.json` and `wrangler.toml` contain resource identifiers rather than credentials.

The live first-episode acceptance used a temporary native .NET application that compiled the actual production `ExpeditionApi.cs` and models. Separate cookie containers created two temporary host accounts and two opposite-crew guests. Twenty-one HTTPS checks covered the complete six-station journey, distinct identities, role-card/map separation, wrong-role rejection, owner and room isolation, actual relay/load results, concurrent Check, paused mutation rejection and private-key restoration from a fresh client. Both temporary host accounts and their cascading rooms were deleted in finally cleanup. No recovery keys or invitation/player keys were printed. This was actual API/C# integration evidence, not a native browser clicking test.

Local verification commands, from the permanent project root:

```powershell
npm run verify
dotnet build src\InterlockExpeditions.Portal\InterlockExpeditions.Portal.csproj --configuration Release --no-restore --nologo
pwsh -File scripts\Publish.ps1 -NoRestore
```

The current reusable checks report 174 actual-SQL/engine assertions, 30 billing/SQL provider-fixture assertions and 10 contrast/correction assertions. The Release build completed with zero warnings/errors. The cached local package restore used `C:\Users\Portakal\.nuget\packages`; no new local runtime package was downloaded. CI uses its own .NET setup and publishes compiled browser assets.

`scripts/Initialize-Hosting.ps1` applies the sorted idempotent schema files and preserves existing secret values by patching only intended fields. `scripts/Configure-Payments.ps1` is a separate explicit owner operation; no Stripe credentials have been configured and paid checkout is closed. No advertising loader is present. Provider billing fixtures are not presented as real payment acceptance.

Generated `public/_framework`, compiled local bin/obj, publish output and local secrets are ignored. Source, original content, production schema, operational scripts and documentation are retained. Tests keep their data in memory; the temporary C# acceptance harness lives under a NewTemp directory and is not deployed.

The full initial six-episode release was deployed by [Actions run 40123284129](https://github.com/muhammetozeski/InterlockExpeditions/actions/runs/40123284129) at commit 76d45a5. Direct HTTPS checks observed all six episode IDs with six stations each, closed unconfigured membership and the explicit dark/style/script markers. The later owner setup source adds binding-name/type inspection without changing live game behavior.
