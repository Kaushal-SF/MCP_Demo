# General code review

> Language-agnostic essentials for any pull request.

## Purpose and scope

- [ ] The description explains what changed, why, and how it was tested.
- [ ] The PR does one thing; unrelated refactors or formatting are split out.
- [ ] Linked issue or ticket requirements are actually met.

## Correctness

- [ ] Edge cases are handled: empty, null/undefined, very large, duplicate, concurrent.
- [ ] Errors are handled or propagated deliberately, never swallowed silently.
- [ ] No obvious off-by-one, wrong comparison, or inverted condition.

## Tests

- [ ] New or changed behaviour has tests, including at least one failure path.
- [ ] Tests assert outcomes, not implementation details, and do not depend on order or timing.
- [ ] CI is green.

## Readability and maintainability

- [ ] Names say what things are and do; no unexplained abbreviations.
- [ ] Comments explain _why_ where the code cannot; no commented-out code.
- [ ] No duplicated logic that should reuse an existing helper.
- [ ] No unused imports, variables, files or debug output.

## Operations

- [ ] No secrets, tokens or personal data in code, logs or fixtures.
- [ ] Config changes, migrations or feature flags are documented and backward compatible.
- [ ] User-facing changes are reflected in docs or the changelog.
