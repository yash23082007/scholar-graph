# ScholarGraph Task Checklist

## Repository baseline

- [x] Inspect the repository and product/build prompt.
- [x] Preserve the existing Vite + React research workspace.
- [x] Create roadmap, architecture and task tracking documents.
- [x] Restore missing stylesheet and make the current app buildable (verification pending dependency install).
- [x] Add root TypeScript/build configuration; lockfile pending dependency install.
- [x] Add `.env.example` with placeholders only; keep the existing `.env` private.

## Phase 1 — Foundation, auth and workspaces

- [x] Modular Express API entrypoint and health/readiness response.
- [x] Request IDs, consistent errors, same-origin write checks, baseline security headers and in-process auth throttles.
- [x] Mongoose connection and indexed User, Session and Workspace models.
- [x] Register/login/session/logout with scrypt password hashes and opaque HttpOnly cookies.
- [x] Same-origin protection and auth rate limits (single-process baseline).
- [x] Authenticated workspace list/create/read/update/delete routes.
- [x] Owner-scoped queries; cross-user integration test remains to be added with a test database.
- [x] Client API module and auth/session screens/states.
- [x] Dashboard loads current-user workspace records; old seeded workspace is labeled a preview.
- [x] README local setup and Phase 1 configuration.
- [ ] Run typecheck/build and relevant tests after dependencies are available.

## Later phases

- [ ] Upload lifecycle, limits, local/object storage, deletion and deduplication.
- [ ] TXT/MD, PDF.js and Mammoth extraction; page/section chunks and status UI.
- [ ] Lexical/hybrid retrieval, source-grounded answers and ask-while-indexing.
- [ ] Tavily + OpenAlex/Crossref adapters, budgets, provenance and deduplication.
- [ ] Agent schemas, provider abstraction and bounded Researcher → Writer → Critic → Editor flow.
- [ ] Prompt Studio versioning and per-agent model configuration.
- [ ] Durable worker queue, persisted SSE events/replay, retries, cancellation and polling.
- [ ] Markdown preview/editor, evidence ledger, draft versions and exports.
- [ ] Security review, evaluation corpus, tests, deployment and operational docs.
