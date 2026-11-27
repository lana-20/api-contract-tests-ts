# Layer 5: property-based and fuzz checks (fast-check)

**Question it answers:** does `POST /contacts` behave correctly for inputs nobody thought
to write down?

Instead of hand-picked examples, [fast-check](https://fast-check.dev) generates inputs
from rules that mirror the spec, and when a property fails it shrinks the input to a
minimal failing case. Light touch, one endpoint plus pagination:

| Property | What it generates |
|---|---|
| Any valid contact is created (201), conforms to the spec, and reads back unchanged | name, email and optional E.164 phone within the schema's limits |
| A contact with exactly one invalid field gets a 422 whose `errors` point at that field | a valid contact, then one field broken in one of several ways |
| Fuzz: any JSON body gets a documented response, never a 500 | arbitrary JSON values (`fc.jsonValue()`) |
| Following `nextCursor` returns every contact exactly once, in order | 0 to 30 extra contacts and page sizes 1 to 10 |

Each run gets a brand-new app, so runs cannot affect each other.

**Randomness vs. flakiness.** Runs are random by default, so each CI run explores new
inputs. That is not flakiness: a failure is a real bug, and fast-check prints the seed
and the shrunk input. Reproduce it exactly with `FC_SEED=<seed> npm run test:property`.

| | |
|---|---|
| **Risk covered** | Edge cases in validation and pagination (boundaries, odd strings, unexpected types), and crashes on unexpected input. |
| **Cost** | About 2 s for 330 generated cases. More runs find more, at linear cost. |
| **When not to use** | For every endpoint: generators take thought to write well, and example tests are clearer for known cases. |
