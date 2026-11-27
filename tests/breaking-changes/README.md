# Layer 4: breaking-change detection (oasdiff)

**Question it answers:** does this pull request change the spec in a way that breaks
existing clients?

CI runs [oasdiff](https://github.com/oasdiff/oasdiff) (Docker image, pinned version)
to compare `openapi/openapi.yaml` on the PR with the copy on `main`, and fails on any
change oasdiff classifies as breaking. Examples: removing an endpoint, removing a
required response field, adding a required request field, narrowing an enum, changing
a type. Additive changes, such as a new optional field, pass.

- [`check.sh`](check.sh): `check.sh <base> <revision>`. Uses a local `oasdiff` if you have
  one (`brew install oasdiff`), otherwise the Docker image.
- [`self-test.sh`](self-test.sh): a test for the gate itself. The spec compared with itself
  must pass, and a copy broken in three ways by [`make-breaking-spec.ts`](make-breaking-spec.ts)
  must fail with all three findings reported. It checks the findings, not just the
  exit code, because an unreadable spec also exits non-zero.

**Demo:** the open pull request labeled `demo` removes `nextCursor` from the list
response. Its CI run shows the oasdiff job failing with
`response-required-property-removed`. It is kept open on purpose and will not be merged.

| | |
|---|---|
| **Risk covered** | Shipping a breaking API change by accident, caught at review time, before any code runs. |
| **Not covered** | Behavior changes that keep the same shape (for example, a field that now means something else). |
| **Cost** | Seconds. Occasionally you need an intentional breaking change; then you version the API or deprecate first. |
| **Flake risk** | None: a pure file diff. |
