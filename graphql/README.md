# Layer 7: GraphQL (Apollo Server + Vitest)

The same contacts domain as a GraphQL API, built with [Apollo Server](https://www.apollographql.com/docs/apollo-server)
and sharing the REST API's store, token checks and input schema. The Python companion
repo tests a GraphQL API built with Strawberry: [backend-tests-py](https://github.com/lana-20/backend-tests-py).

| File | What it is |
|---|---|
| [`src/schema.ts`](src/schema.ts) | SDL and resolvers |
| [`src/depth-limit.ts`](src/depth-limit.ts) | A validation rule that rejects queries nested deeper than 5 levels |
| [`schema.graphql`](schema.graphql) | The printed schema, committed: the contract |
| [`tests/graphql.test.ts`](tests/graphql.test.ts) | 20 tests over real HTTP |
| [`tests/schema.test.ts`](tests/schema.test.ts) | Snapshot: the schema must match `schema.graphql` |
| [`check-breaking.sh`](check-breaking.sh), [`breaking-self-test.sh`](breaking-self-test.sh) | GraphQL Inspector breaking-change gate, and a test that it fails when it should |

## What is tested

- **Queries and mutations with variables**, including a create-then-read round trip.
- **Cursor pagination**: following `nextCursor` returns each of the caller's contacts exactly once.
- **Auth.** No, unknown or expired token: the whole request gets HTTP 401 and
  `UNAUTHENTICATED`. Scopes are checked per field: a read-only token can't run mutations
  (`FORBIDDEN`), and `Contact.messages` needs `messages:read`.
- **The error shape.** With a read-only token, `{ contacts { items { name messages { body } } } }`
  returns HTTP 200 with the contacts *and* one `errors[]` entry per denied `messages`
  field, each with a `path` such as `["contacts", "items", 0, "messages"]`.
- **Depth limiting.** `Contact.messages -> Message.contact -> ...` is a cycle, so one small
  query could ask for a huge response. Queries deeper than 5 levels (fragments included)
  are rejected with HTTP 400 before any resolver runs.
- **Request errors**: syntax errors, unknown fields and wrong variable types are 400s,
  and no error includes a stack trace.

## How testing GraphQL differs from REST

- **One endpoint, mostly HTTP 200.** A resolver error doesn't change the status: you must
  assert on `errors[]` in the body, not only on the status code. Only whole-request
  failures (parse, validation, authentication here) use 4xx.
- **Partial data.** A response can contain both `data` and `errors`. A `null` in a
  non-null field bubbles up to the nearest nullable parent, so schema nullability is
  part of the contract and worth testing.
- **The schema is the contract**, and it is introspectable. Snapshot it, review the diff,
  and diff it in CI (GraphQL Inspector) the way the REST layer diffs OpenAPI with oasdiff.
- **Clients choose the shape**, so the risks include queries that are too expensive:
  depth limits (here), complexity or cost limits, and persisted queries.

| | |
|---|---|
| **Risk covered** | Schema drift and breaking changes, auth gaps per field, wrong error shapes, abusive queries. |
| **Cost** | About 0.1 s for 21 tests; Inspector takes a few seconds in CI. |
| **Flake risk** | Low: one server per test on a free port, fresh seeded store. |
