# Layer 6: Postman collections, run by Newman

The same API, tested the Postman way: a collection that QA, developers and support can
open in the Postman app, explore and run by hand, and that CI runs headless with
[Newman](https://github.com/postmanlabs/newman).

| File | What it is |
|---|---|
| [`contacts-api.postman_collection.json`](contacts-api.postman_collection.json) | The main collection: folders `auth`, `contacts`, `messages`, `errors` |
| [`auth-matrix.postman_collection.json`](auth-matrix.postman_collection.json) + [`auth-matrix.data.json`](auth-matrix.data.json) | A data-driven run: one request per operation, repeated for each row of the data file |
| [`local.postman_environment.json`](local.postman_environment.json) | `baseUrl` and the demo tokens |
| [`run.ts`](run.ts) | `npm run test:postman`: starts the API on a free port, runs both collections, stops the API |
| [`sync.ts`](sync.ts) | `npm run postman:sync` / `postman:check`: keeps the collection in step with the spec |

## What the collection shows

- **Collection-level auth and scripts.** The collection uses Bearer auth with `{{token}}`.
  A collection pre-request script sets `token` to Alice's full-access token, and requests
  in the `auth` folder override it in their own pre-request script (collection scripts run
  first). A collection-level test script runs after *every* request: any 4xx/5xx must be
  `application/problem+json`, match the `Problem` schema, and repeat the HTTP status in the body.
- **JSON Schema checks derived from the spec.** Tests call
  `pm.response.to.have.jsonSchema(schemas.Contact)`. The `schemas` collection variable is
  not written by hand: `npm run postman:sync` copies `Contact`, `ContactPage`, `Message` and
  `Problem` out of `openapi.yaml`, with every `$ref` inlined.
- **Chained requests.** `contacts` runs create -> get -> update -> delete -> get (404),
  saving the new id with `pm.collectionVariables.set('contactId', ...)`. A pre-request script
  generates a unique email, so the collection can be re-run against the same server.
  `messages` sends a message with a fresh `Idempotency-Key` and then retries with the same key.
- **Status, header and error-shape checks** with `pm.test` / `pm.expect`, for example the
  exact `WWW-Authenticate` challenge on a 401 and the field pointers on a 422.

## Data-driven auth matrix (`--iteration-data`)

`auth-matrix.data.json` has one row per way a token can be wrong (no header, a non-Bearer
scheme, an unknown token, an expired token, a token without scopes) with the expected
status, problem type and challenge. Newman runs all six requests once per row: 5 x 6 = 30
requests, 90 assertions. This is the Postman counterpart of `test.each` in
[`tests/auth-matrix`](../tests/auth-matrix). Postman cannot vary the HTTP method from data,
so the operations are requests and the token cases are rows.

## How it was created and how it stays in sync

1. **Imported from the spec** with `openapi-to-postmanv2` (the converter behind Postman's
   *Import > OpenAPI*):
   `npx openapi-to-postmanv2 -s openapi/openapi.yaml -o imported.json -p -O folderStrategy=Tags`.
   That gives one request per operation, grouped by tag, with no tests.
2. **Hand-curated:** regrouped into `auth`/`contacts`/`messages`/`errors`, given tests,
   collection-level auth and scripts, chained variables and the environment file.
3. **Kept in sync:** a re-import would throw the curation away, so instead CI runs
   `npm run postman:check`, which fails when:
   - the `schemas` variable differs from the spec (fix: `npm run postman:sync`), or
   - an operation in the spec has no request in the collection (fix: add one by hand).

## Reports

Newman writes an `htmlextra` report per collection (`reports/newman/*.html`, published on
the Pages site) and Allure results via `newman-reporter-allure`, so the Postman results
appear in the same Allure report as the Vitest layers.

## Postman/Newman vs. the Vitest contract tests: when each one fits

| | Postman + Newman | Vitest contract tests |
|---|---|---|
| Best for | A shared, clickable collection that QA, developers and support all use: exploring an API, reproducing a bug, manual checks, onboarding | The CI gate: exhaustive, fast, reviewed like code |
| Strengths | No code needed to run; scripts and environments are approachable; easy to hand to another team | Full language, type checking, refactoring, property-based tests, Pact, test doubles (for example a store that throws to get a 500) |
| Weaknesses | JSON diffs are hard to review; logic is spread across many small scripts; hard to share helpers | Less approachable for non-developers |

Both run here because they serve different people. The Vitest suites are the gate; the
collection is the shared, human-friendly view of the same contract.

| | |
|---|---|
| **Risk covered** | The same contract, through the tool other teams use; the collection itself drifting from the spec. |
| **Cost** | About 2 s for 149 assertions; editing is done in the Postman app, and reviewing JSON diffs takes care. |
| **Flake risk** | Low: an in-process server on a free port with fresh seed data per collection; no fixed ports or sleeps. |
