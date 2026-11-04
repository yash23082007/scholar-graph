# ScholarGraph

ScholarGraph is an evidence-first research workspace by Yash. Researchers can index their own files, ask questions against retrieved passages, gather web and scholarly metadata, and edit reports with links back to the evidence used.

## What works today

- Private email and password accounts, expiring HttpOnly sessions, and owner-scoped workspaces.
- PDF, DOCX, TXT, and Markdown uploads with parsing, duplicate detection, page and section references, search, and retry for files that need attention.
- Local or S3-compatible upload storage. Optional ClamAV scanning and local OCR for scanned PDF pages.
- Evidence-based document questions, Tavily web search, OpenAlex and Crossref metadata, and Groq/Gemini model adapters with fallback.
- Research runs with stored stage output, evidence records, cancellation, server-sent progress updates, and event replay using `Last-Event-ID`.
- A Markdown editor and preview, automatic draft saving, version history and line comparison, evidence links, Markdown download, and browser print-to-PDF.
- MongoDB-backed rate limits for auth and expensive research requests, audit records for signed-in changes, request IDs, JSON request/error logs, a token-protected Prometheus metrics endpoint, and separate liveness/readiness checks.
- Docker Compose, an Nginx reverse proxy, an optional Caddy HTTPS profile, an optional ClamAV service, and CI checks.

Source labels distinguish extracted file text, web excerpts, abstracts, and metadata-only records. A matching citation ID only confirms that the source exists in the run’s evidence; readers should inspect the linked passage to decide whether it supports a claim.

## Local setup

Requirements: Node.js 22.13 or newer and MongoDB. For local OCR, install Poppler and Tesseract; the Docker API image includes them.

1. Install packages with `npm ci`.
2. Copy `.env.example` to `.env`; set `MONGODB_URI` and add the server-side provider keys you want to use. Never put provider keys in `VITE_*` variables.
3. Start MongoDB, then run `npm run dev`.
4. Open `http://localhost:5173`, create an account, and upload your own source files.

Useful commands:

```sh
npm run build
npm test
npm run format:check
```

## Docker

The default Compose stack is for a local installation. It starts MongoDB, the API, and the web client at `http://localhost:8080`:

```sh
docker compose up --build
```

To require upload scanning, start with the ClamAV overlay:

```sh
docker compose -f docker-compose.yml -f docker-compose.security.yml up --build
```

For public HTTPS deployment, configure DNS, `DOMAIN`, `APP_URL=https://your-domain`, a strong `RATE_LIMIT_HASH_SECRET`, provider credentials, and an authenticated/TLS MongoDB URI. Then run `docker compose --profile production up --build`. Caddy obtains and renews certificates when the domain resolves to this host and ports 80/443 are reachable. See [DEPLOYMENT.md](DEPLOYMENT.md) for object storage, backups, secret rotation, and operational limits.

## Current limitations

- Research stage execution is still in-process. MongoDB stores runs and events and allows recovery after restart, but there is no separate durable multi-worker queue with retry policy or distributed cancellation yet.
- Account verification, password reset, two-factor authentication, and self-service account deletion are not implemented.
- Metrics dashboards, external error tracking, and browser end-to-end tests are not configured. CI currently runs formatting, type/build checks, and the Node unit tests.
- PDF export uses the browser print dialog’s “Save as PDF”; a server-generated PDF endpoint is not included.
- OCR and malware scanning are optional and must be enabled for the deployment. If scanning is not required, the upload screen reports that files were not scanned.
- Full text is not guaranteed for scholarly records. Crossref/OpenAlex records may contain metadata or abstracts only.

Use the app with your own provider credentials and source material. Provider response quality, quotas, and costs depend on the accounts configured by the operator.
