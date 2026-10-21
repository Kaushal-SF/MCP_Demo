# Security review

> Focused checks for changes touching auth, input handling, secrets, dependencies or infrastructure.

## Input and output

- [ ] All external input is validated (type, length, format) before use.
- [ ] Output is encoded for its context (HTML, SQL, shell, URLs); no `dangerouslySetInnerHTML`
      or `eval` with user data.
- [ ] File paths built from input are restricted (no `../` path traversal).
- [ ] Redirect targets and fetched URLs are allow-listed (no open redirect or SSRF).

## Authentication and authorisation

- [ ] Every new endpoint or action checks _who_ the user is and _whether_ they may do it.
- [ ] Authorisation happens on the server, never only in the UI.
- [ ] Sessions and tokens expire; logout and revocation work.

## Secrets and data

- [ ] No secrets, keys or tokens in code, config files, logs, tests or error messages.
- [ ] Sensitive data is encrypted in transit and at rest, and minimised.
- [ ] Error responses do not leak stack traces or internal details.

## Dependencies and supply chain

- [ ] New packages are well maintained, widely used and needed.
- [ ] Lockfile changes match manifest changes; no unexpected new transitive packages.
- [ ] `npm audit` (or equivalent) shows no new high or critical issues.

## Infrastructure and CI

- [ ] CI workflows use least-privilege `permissions` and pinned action versions.
- [ ] No secrets exposed to workflows triggered by untrusted forks.
- [ ] Containers run as non-root; infrastructure changes follow least privilege.
