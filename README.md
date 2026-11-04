# ScholarGraph

ScholarGraph is an evidence-first research workspace: bring together documents, ask questions against source text, and create editable research outputs whose claims can be traced back to evidence. The first implementation milestone is private accounts and workspaces; document ingestion and AI research features are being added incrementally.

## Current implementation status

- React + TypeScript + Vite web client with a responsive dark account/workspace hub.
- Express API with MongoDB/Mongoose models for users, sessions and workspaces.
- Registration, login, session restoration, logout and owner-scoped workspace CRUD.
- Passwords are hashed with Node's scrypt implementation. Session IDs are random opaque tokens, stored hashed and issued in HttpOnly cookies.
- A clearly labeled preview of the earlier research desk is available after sign-in; its seeded documents/reports are sample content and are not connected to account workspaces.
- Document parsing, source-grounded Q&A, Tavily web research, Groq/Gemini model integrations, four-agent runs, prompt versioning, draft persistence, run events and Docker deployment are implemented.
- Durable multi-instance queues, S3-compatible object storage, scholarly metadata providers, OCR, browser end-to-end coverage and PDF export remain deployment hardening work.

## Requirements

- Node.js 20 or newer.
- MongoDB local or Atlas database. Authentication and workspace routes intentionally return `503` until MongoDB is configured; there is no insecure in-memory production fallback.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `MONGODB_URI`. Set `APP_URL=http://localhost:5173` for local Vite development.
3. Start MongoDB.
4. Run `npm run dev` and open `http://localhost:5173`.
5. Register an account. The API creates a private default workspace.

`npm run build` runs TypeScript checking and then Vite. `npm test` runs the Node test suite.

### Docker

Run the full local stack with MongoDB:

```bash
docker compose up --build
```

Set provider keys in the shell or a local `.env` file before starting Compose. The API listens on `http://localhost:4000`; the Vite development client remains available through `npm run dev`.

## Security and deployment notes

- Keep `.env` local; do not put API credentials in `VITE_*` variables or browser storage.
- Production must use HTTPS (`NODE_ENV=production`) so the session cookie is Secure. Use a strong database credential and restrict MongoDB network access.
- The current in-process request limiter is a single-instance development baseline. Use shared rate limiting for multi-instance deployments.
- Cookie writes require a matching `Origin`; set `APP_URL` to the exact browser origin.
- This is a portfolio/MVP foundation, not a commercial SaaS deployment recommendation. Provider quotas, deployment terms and costs need review before launch. Grok/xAI is usage-priced and optional BYOK; local Ollama is the no-token-bill path.

See [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [TASKS.md](TASKS.md) for scope and sequencing.
