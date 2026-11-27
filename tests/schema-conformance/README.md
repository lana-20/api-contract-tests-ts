# Layer 1: provider schema conformance

**Question it answers:** does every response the API sends match what `openapi/openapi.yaml` promises?

**How:** [`responses.test.ts`](responses.test.ts) is a table of scenarios, one or more per documented
`(operation, status)` pair. Each scenario sends a request to the real app (in-process with
Fastify's `inject()`, so there is no network or port) and passes the response to
[`expectToMatchSpec`](../support/contract.ts), which checks:

- the status code is documented for that operation
- the `Content-Type` is one the spec lists (and a `204` has no body)
- every required response header is present (`Location`, `WWW-Authenticate`)
- the body validates against the JSON Schema in the spec, with Ajv's 2020-12 build (OpenAPI 3.1 schemas are JSON Schema 2020-12)
- no undocumented fields, because the response schemas set `additionalProperties: false`

A final test fails if the spec documents a response that no scenario produces, so the
suite cannot quietly fall behind the spec.

[`validator.test.ts`](validator.test.ts) tests the checker itself: each rule gets a response that
must fail. One test swaps in a buggy handler that returns the stored record (with its
internal `ownerId`) and checks the leak is caught.

| | |
|---|---|
| **Risk covered** | Provider drift: a renamed or missing field, a wrong status, a leaked internal field, an error that isn't problem+json. |
| **Not covered** | Whether a *specific consumer* still works (that is Pact's job), or behavior the schema can't express (ownership, idempotency). |
| **Cost** | About 0.5 s for 52 tests. Adding a scenario is one table row. |
| **Flake risk** | None: in-process, no ports, seeded data, a fresh app per test. |

Why not let Fastify validate responses? Fastify's serializer drops properties that are not
in the response schema. That would hide exactly the "leaked field" bug this layer exists
to catch, so the app deliberately has no response schemas and the tests do the checking.
