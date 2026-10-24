# Interlock Expeditions

Browser-based cooperative adventures in which two crews hold different information and operate the same server-controlled machines. A ready episode is the starting point: hosts do not need to write a puzzle or build a spreadsheet before their guests can play.

This independent product is being implemented. Publication and verification results are recorded only after they occur. Similar event and scavenger-hunt services exist; audience, revenue and demand for this particular product have not been established.

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
