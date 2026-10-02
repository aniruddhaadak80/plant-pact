# Security Policy

## Supported versions

Only the latest deployed version is supported. This is a single-deploy
application, not a versioned package.

| Version | Supported |
| --- | --- |
| latest on `main` | yes |
| anything older | no |

## Reporting a vulnerability

Email **security@users.noreply.github.com** or open a
[private advisory](https://github.com/aniruddhaadak80/plant-pact/security/advisories/new).
Please do not open a public issue for a suspected vulnerability.

Include: what an attacker can do, the steps to do it, the affected route or
file, and the session/cookie state you used. You should get an acknowledgement
within a few days.

## What is already in place

**Ownership.** There are no accounts. A pact belongs to an unguessable v4 UUID
held in an HTTP-only, `SameSite=Lax` cookie. Every read and write is scoped by
it, so cross-session access returns `404` rather than data. This is covered by
tests in `tests/service.test.ts`.

**Input.** All request bodies go through `src/lib/validation.ts`, which enforces
string lengths, numeric ranges and enum membership. Strings are length-capped
before they are stored or echoed. The agent endpoint parses the same way.

**SQL.** Every query is parameterised. The only identifier interpolated into SQL
is the schema name, and `resolveSchema()` rejects anything that is not a plain
SQL identifier.

**Output.** React escapes rendered user content by default; there is no
`dangerouslySetInnerHTML` anywhere in the application. The printable care card
escapes every interpolated value.

**Upstream requests.** Weather requests are restricted to `api.open-meteo.com`
and `archive-api.open-meteo.com`; taxonomy requests to `api.gbif.org`. Anything
else throws before a socket is opened. All are time-bounded at 8 seconds with
at most three attempts.

**Errors.** Unexpected failures return a generic code and a request-free message.
Stack traces and environment values never reach the client.

**Secrets.** There are none to leak: the app requires no API keys. The only
production variable is a Postgres connection string.

## Known limitations, stated plainly

**Rate limiting is best-effort.** Anonymous writes are capped at 20 per minute
per session and 40 pacts per session, but the counter is an in-memory bucket.
On Vercel each instance has its own memory, so a determined caller can multiply
their budget across cold starts. This stops casual abuse and runaway scripts; it
is not a defence against a motivated attacker. The honest fix is a shared
limiter (Upstash Redis or Vercel KV) behind the same `checkRate` interface.

**Anonymous data is not access-controlled by a secret.** The session cookie is a
bearer token. On a shared or compromised machine, whoever has the cookie has the
pacts. That is the documented trade-off of an account-free design.

**Tombstones are retained.** Deleting a pact hides the row but keeps its audit
events. That is deliberate, so a prediction cannot be quietly erased, but it does
mean the metadata remains in the database.

**Toxicity flags are conservative and general.** They are not a veterinary
assessment, and the UI says so wherever they appear.