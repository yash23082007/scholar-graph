# ScholarGraph delivery checklist

`[x]` implemented in the repository, `[~]` partly implemented, `[ ]` still outstanding. Tests that require MongoDB or a browser are not marked verified unless they have actually run.

## Product and interface

- [x] Replace the disconnected sample desk with the real authenticated workspace.
- [x] Create a ScholarGraph book-and-citation mark, favicon, consistent visual theme, responsive workspace layout, and “Built by Yash” credit.
- [x] Add reduced-motion-aware transitions and progress animation.
- [x] Provide clear pages for overview, documents, questions, reports, and instructions.
- [x] Keep source coverage and unsupported citation references visible; citation ID checks do not claim semantic proof.
- [x] Add live run stages, reconnecting event stream, evidence links, Markdown preview/editor, autosave, restore, version history, and line comparison.
- [x] Add Markdown download and print-to-PDF through the browser print dialog.
- [ ] Add a dedicated accessibility audit and mobile device/browser QA.
- [ ] Add and review Privacy Policy and Terms of Service before public launch.

## Storage and documents

- [x] Local uploads and S3-compatible / R2 storage adapter.
- [x] Upload size/type limits, SHA-256 duplicate detection, ClamAV adapter, and safe generated storage keys.
- [x] Upload retry/reprocess endpoint for files that fail parsing.
- [x] PDF page extraction, DOCX heading sections, Markdown/TXT extraction, and optional local OCR.
- [x] Document pagination, name search, status and parse warnings.
- [ ] Browser upload integration tests and malware fixture tests.
- [ ] OCR quality evaluation for a representative set of scanned PDFs and languages.

## Scholarly research and AI

- [x] Tavily web search, OpenAlex and Crossref metadata adapters, source provenance and coverage labels.
- [x] Crossref caching, transient retry/backoff, polite-pool contact, request spacing, and DOI/title deduplication.
- [x] Groq/Gemini provider adapters with fallback and provider-level unit tests.
- [x] Server-only API credentials; provider availability is shown from runtime configuration.
- [ ] AI usage limits, cost budgets, and provider usage monitoring.
- [ ] Integration tests against OpenAlex/Crossref and provider timeout/error paths.
- [ ] Evaluate semantic citation support. Current checks only verify that an evidence ID exists.

## Reports and jobs

- [x] MongoDB-persisted research runs, stage output, evidence, and replayable SSE events with `Last-Event-ID`.
- [x] Run cancellation state and restart recovery for queued records.
- [x] Draft autosave, explicit version save, restore, diff, evidence inspection, Markdown export, print styles.
- [~] Research execution still runs in-process; recovery does not provide a leased multi-worker queue.
- [ ] Persistent worker queue with leases, retries/backoff, timeouts, worker concurrency, and multi-instance cancellation.
- [ ] PDF export endpoint or generated artifact and dedicated print QA.
- [ ] Browser end-to-end coverage for live runs, editor autosave, draft restore/diff, and export.

## Security and operations

- [x] Owner-scoped MongoDB queries, scrypt passwords, opaque HttpOnly sessions, CSRF origin checks, and upload URL SSRF validation.
- [x] MongoDB-shared auth/research rate limits with expiring buckets.
- [x] Append-only audit records for authenticated write routes; structured JSON request/error logs and request IDs.
- [x] Separate liveness/readiness endpoints, Docker Compose, Nginx proxy, optional Caddy HTTPS, optional ClamAV overlay, and CI checks.
- [x] Document MongoDB backup/restore, secret rotation, deployment configuration, and current scaling limits.
- [ ] Cross-user authorization integration tests against an isolated test database.
- [ ] Metrics exporter, production dashboard, external error tracking, and alerting.
- [ ] Account verification, password reset, two-factor authentication, and self-service account deletion.
- [ ] CI deployment/release workflow and documented rollback procedure.
- [ ] Run Docker Compose and HTTPS deployment verification in an environment with Docker access.

## Current verification

- [x] Unit tests cover Groq/Gemini selection and fallback, Tavily mapping, Crossref caching/retry, scholarly deduplication, retrieval, Markdown extraction, malformed text, password/session helpers, and URL safety.
- [ ] MongoDB integration, upload integration, browser end-to-end, and deployed-stack checks still need to run.
