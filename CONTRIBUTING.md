# Contributing to Plant Pact

Thanks for looking. This is a small project with a specific opinion about what
it is for, so read the shape of it before you change it.

## The one-paragraph version

Plant Pact predicts how long a gifted houseplant survives in a specific home,
using live weather and a trained model, and then collects the real outcome.
Three things must stay true after your change:

1. **Every number on screen is computed, never decorative.** No fake
   probabilities, no simulated weather, no counters that go up.
2. **The UI, the REST API and the MCP tools share one code path.** If you add a
   capability, add it to the service layer, not to a route handler. If you can
   only implement it in the browser, say so in the PR — it is probably a sign
   the logic belongs in `src/lib/`.
3. **Fallback data never masquerades as live.** If a value came from the sealed
   offline sample, the response and the page must say so.

## Getting it running

```bash
npm ci
npm run dev
```

No environment variables are required. Local development and the test suite run
on an embedded PGlite database (real Postgres compiled to WebAssembly) in
`./.pglite`, and the weather layer talks to the real Open-Meteo endpoints.

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest, 88 tests
npm run build       # production build
npm run train       # refit the model, rewrite src/lib/model/weights.ts
npm run corpus      # refetch training/cities.json from Open-Meteo
```

## Where things live

| Path | Responsibility |
| --- | --- |
| `src/lib/model/features.ts` | The ten features. Single source of truth for inference and training. |
| `src/lib/model/weights.ts` | **Generated.** Do not hand-edit; run `npm run train`. |
| `src/lib/engine/labeling.ts` | The published risk procedure that produces training labels. |
| `src/lib/engine/verdict.ts` | Projection path, breaking point, recommendation. |
| `src/lib/service.ts` | Every mutation. The only place business rules live. |
| `src/lib/db/` | Repository interface plus the Postgres and PGlite adapters. |
| `src/lib/integrity/chain.ts` | Canonical JSON and the SHA-384 seal chain. |
| `src/app/api/mcp/route.ts` | JSON-RPC 2.0 endpoint. Tools delegate to the service layer. |

## Changing the model

1. Change `features.ts` and add tests for the new values, including boundary and
   malformed-input cases.
2. If you add or rename a feature, update `FEATURE_KEYS` in `src/lib/types.ts`
   and `FEATURE_GROUPS` / `FEATURE_LABELS` in `features.ts`, or the UI will not
   group it.
3. Run `npm run train` and commit the regenerated `weights.ts`. The commit
   message should include the new held-out AUC.
4. Update the model card section of `/method` if the feature semantics changed.
5. The integrity test pins two seal digests. If you touch `canonicalJson` or the
   seal construction, those vectors **will** fail. That is intentional: recompute
   them deliberately and explain why in the PR, because changing them means
   every previously sealed pact becomes unverifiable.

## Adding a species

Add an entry to `CATALOGUE` in `src/lib/species.ts`. It is seeded into
`species_profiles` on first run and is idempotent, so re-running never touches a
user's pacts. Fill in the `gbif*` columns with real values from
`https://api.gbif.org/v1/species/match?name=<scientific name>` — do not invent
usage keys. Add a note that would actually help someone placing that plant, and
keep `careSource` honest.

## Pull requests

- Keep the diff scoped to one thing.
- Say what you verified and how. "Ran the journey on mobile" is worth more than
  "looks good".
- Do not suppress lint or type errors to get green. Fix the code.
- No new required environment variables. Plant Pact has no API keys by design;
  a feature that needs one belongs in a fork, not in this repository.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).