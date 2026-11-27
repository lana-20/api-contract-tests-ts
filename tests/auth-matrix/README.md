# Layer 2: auth and error-code matrix

**Question it answers:** for every operation, does each way of being wrong produce the
right status, problem type and `WWW-Authenticate` challenge?

- [`auth.test.ts`](auth.test.ts) is a cross-product built with `describe.each` / `test.each`:
  every operation in the spec x {no header, non-Bearer scheme, empty token, unknown token,
  expired token, token without scopes, read-only token, valid token}. The operations and
  their required scopes are read from the spec, so a new endpoint is covered automatically.
- [`errors.test.ts`](errors.test.ts) is a table of error cases (400, 401, 404, 409, 422, 500), each
  with the exact problem type and the field pointer the client gets back, plus idempotent
  replay and a check that a 500 never leaks internals.

Rules the matrix pins down, which are easy to get wrong:

- **401 vs 403.** 401 = we don't know who you are (missing, unknown or expired token).
  403 = we know who you are, and the token lacks the scope. The 403 challenge names the
  missing scope (RFC 6750 section 3.1).
- **Auth before validation.** An anonymous request with an invalid body gets 401, not 422,
  so callers without a token learn nothing about the schema.
- **404 for someone else's resource**, not 403, so ids can't be probed.
- **400 vs 422.** 400 = we could not read the request (malformed JSON, missing required
  header). 422 = we read it and the content is invalid.

| | |
|---|---|
| **Risk covered** | Security regressions (a missing scope check), inconsistent error codes, leaking internals. |
| **Cost** | About 0.6 s for 64 tests. |
| **Flake risk** | None. The expired token is expired relative to an injected clock, not wall time. |
