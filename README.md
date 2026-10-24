# Interlock Expeditions

Browser-based cooperative adventures in which two crews hold different information and operate the same server-controlled machines. A ready episode is the starting point: hosts do not need to write a puzzle or build a spreadsheet before their guests can play.

[Play Interlock Expeditions](https://muhammetozeski-interlock-expeditions.pages.dev) · [Public source](https://github.com/muhammetozeski/InterlockExpeditions)

Choose one of six original adventures, create a free host identity, and invite two devices to opposite crews. Each holds a different instruction card and controls part of the same actual machine. Solve crossed circuits, navigate a hidden loading floor, balance real calculated loads, align symbol rings and coordinate the final launch. Hosts can pause, replace invitations, remove players and resume real persisted progress.

Free hosts have two active rooms with six guest devices each. All six stories are available. The Club integration supports larger hosting capacity, but live checkout is unavailable until actual owner provider configuration is supplied. Similar event and scavenger-hunt services exist; audience, revenue and demand for this particular product have not been established.

## Source organization

- `src/InterlockExpeditions.Portal`: the English .NET 10 Blazor interface.
- `functions/api` and `server`: account, room, player, game and billing operations.
- `content`: original episode definitions and server-side puzzle rules.
- `schema`: persistent D1 database definitions.
- `scripts`: build, verification and deployment operations.
- `public`: deployable browser assets.

Start with [project knowledge](docs/INDEX.md). For continuation context, use the [handover guide](Walkthrough/Guide.md).

## Product boundaries

Role-specific information is sent only to authorized room participants. Episode source and solutions are public source material, so they are not advertised as cryptographically secret or cheat-proof. Real room identities and player records still require access checks. No invented participants or generated activity counts are used.

Default appearance is dark. A runtime script computes rendered foreground/background contrast and corrects unreadable text. Product styling is independent of other sites.

Free play must work without payment or external service keys. Payment and advertising remain disabled unless the owner supplies actual provider configuration; only verified provider state can enable a paid allowance.

## Build and evidence

Use .NET 10 and Node 24 or newer. Run `npm run verify`, then `pwsh -File scripts/Publish.ps1`. The local Release build has completed with zero warnings/errors. Reusable verification covers 174 real-SQL/engine checks, 30 provider-fixture billing checks and 10 contrast-function checks. A separate live acceptance completed all six first-episode stations with actual production C# clients and two real guest identities, then erased its temporary accounts. See [publication evidence](docs/Publication.md) for the distinction between executed API, fixture and native read evidence.

Main-origin mounting: [Subpath mount](docs/Subpath-Mount.md).
