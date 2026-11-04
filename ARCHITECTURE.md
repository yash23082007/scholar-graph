# ScholarGraph Architecture

## Current target

The initial implementation is a modular monolith: a React + TypeScript + Vite client and an Express API in Node.js, with MongoDB/Mongoose as the durable database. The existing Vite/React choice is retained because it is already present; the plan's Next.js option is not a requirement. Keep browser code and server-only credentials separate.

```text
Browser (React/Vite)
  ├─ pages/features: auth, dashboard, workspace, documents, runs, prompt studio
  └─ typed API client ── HTTP / SSE
                         │
Express API (Node)
  ├─ routes → validation → authentication → authorization → services
  ├─ domain modules: auth, workspaces, documents, questions, runs, prompts
  └─ repositories → MongoDB (Mongoose)
       │
       ├─ later: object storage adapter for original uploads
       ├─ later: durable queue + separate worker for parsing/agents
       ├─ later: Redis cache/fan-out (not authoritative storage)
       └─ later: provider adapters (Ollama, optional xAI BYOK, Tavily, OpenAlex)
```

## Boundaries

- **Web client:** presentation, form state, upload progress and connection/retry behavior. It never holds AI/search secrets and never decides authorization.
- **API:** validates every request, resolves the authenticated principal, authorizes workspace ownership before data access, and returns a consistent error envelope.
- **Auth:** opaque random session token in a Secure/HttpOnly/SameSite cookie; persist only a token hash and expiration. Passwords must use a maintained password hashing implementation (Argon2id or scrypt with calibrated parameters), never plaintext. Protect state-changing cookie-auth requests against CSRF and rate-limit auth endpoints.
- **Data:** users, sessions, workspaces, documents/chunks, source/evidence records, prompts/versions, runs/events, draft versions and exports are separate records. Index owner/workspace lookups. Store uploads outside MongoDB documents.
- **Worker:** later process one bounded idempotent stage at a time. Persist stage output/event before acknowledging queue delivery. Queue payloads carry identifiers only.
- **Evidence:** source content is untrusted data. Each claim points to stored evidence IDs and excerpts. Metadata-only and abstract-only records remain distinguishable from full text. Critic output is advisory; deterministic checks and human review remain visible.

## Phase 1 data model

- `User`: normalized unique email, display name, password hash, status, timestamps.
- `Session`: user ID, unique token hash, expiry, created/last-seen timestamps; TTL index for cleanup.
- `Workspace`: owner ID, name, description/settings, timestamps; `{ ownerId, updatedAt }` index.
- Future collections follow the product plan: documents, documentChunks, sourceRecords, evidenceItems, promptVersions, researchRuns, agentRuns, runEvents, draftVersions and exports.

## API conventions

- Prefix: `/api/v1` (health endpoint may remain `/api/health`).
- Errors: `{ error: { code, message, requestId? } }`; success responses use explicit resource objects.
- Validate params, query and body with schemas at the route boundary. Set body/file limits and reject unknown or malformed identifiers.
- Authenticate from the session cookie. Resolve workspace by both ID and owner ID in the same query; never trust a client-supplied owner ID.
- Initial endpoints: `POST /auth/register`, `POST /auth/login`, `GET /auth/session`, `POST /auth/logout`; `GET/POST /workspaces`, `GET/PATCH/DELETE /workspaces/:workspaceId`.

## Local development and deployment

Vite proxies `/api` to the local Express server. MongoDB can be local or Atlas via `MONGODB_URI`. Production secrets are server-only environment variables. A hosted deployment must select a worker/queue compatible with its runtime; Vercel functions are not persistent workers, and SSE must reconnect/replay from durable events. Free-tier limits and Vercel Hobby's non-commercial constraints must be rechecked before launch. Grok/xAI is optional paid BYOK; Ollama is local and cannot be reached by a hosted server without an explicitly designed authenticated bridge.

## Security and reliability risks

- Session cookie + CSRF controls; password hashing; login/register throttles.
- Per-route authz, no IDOR, and owner-scoped queries; test cross-user access.
- Strict CORS, request size limits, safe error responses, security headers and structured request IDs.
- Never render unsanitized Markdown HTML. Validate uploads by type/size and use generated storage keys.
- Prompt instructions cannot grant tool permissions; document/web content is untrusted.
- Provider adapters use timeouts, bounded retries and budgets; redact credentials from logs.
- Durable run event history lives in MongoDB; Redis is an optimization only.
