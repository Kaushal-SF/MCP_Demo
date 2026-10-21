# Node.js / backend review

> APIs, async code, data access and operability for Node.js services.

## API design

- [ ] Request input is validated at the boundary (schema validation), with clear 4xx errors.
- [ ] Status codes are correct (400/401/403/404/409/422/5xx) and error bodies are consistent.
- [ ] Breaking changes to endpoints or payloads are versioned or announced.
- [ ] List endpoints are paginated.

## Async and errors

- [ ] Every promise is awaited or deliberately handled; no floating promises.
- [ ] Independent async work runs in parallel (`Promise.all`); dependent work is sequential.
- [ ] Errors keep their cause; logs include context but no secrets.
- [ ] External calls have timeouts and sensible retries.

## Data

- [ ] Queries are parameterised; no string-built SQL.
- [ ] Migrations are reversible or have a rollback plan, and are safe on large tables.
- [ ] N+1 queries are avoided; indexes exist for new query patterns.
- [ ] Multi-step writes use transactions where consistency matters.

## Configuration and operations

- [ ] Config comes from environment variables and is validated at startup.
- [ ] New dependencies are justified, maintained and licence-compatible.
- [ ] Structured logs at the right level; no `console.log` left behind.
- [ ] Health checks and graceful shutdown still work.

## Tests

- [ ] Unit tests for logic; integration tests for endpoints and data access.
- [ ] External services are mocked at the network boundary, not by patching internals.
