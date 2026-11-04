# Deployment and operations

## Production configuration

Use a managed MongoDB deployment with TLS and a dedicated database user. Set `MONGODB_URI_DOCKER` to its connection string, and keep it in the deployment secret store. The bundled MongoDB service is intended for a local single-host installation.

For an HTTPS host:

1. Point the public DNS `A`/`AAAA` record at the deployment host and allow inbound TCP 80 and 443.
2. Set `DOMAIN` to the public hostname and `APP_URL` to its exact `https://` origin. Compose uses two trusted proxy hops (Caddy and Nginx); set `TRUST_PROXY_HOPS=1` if your topology has only one trusted reverse proxy.
3. Configure provider keys and a unique `RATE_LIMIT_HASH_SECRET` (at least 32 random bytes).
4. Choose object storage for a multi-instance deployment. Set `STORAGE_DRIVER=s3` and configure the S3 or R2 bucket, endpoint, region, and credentials. Grant the API only the bucket operations it needs and keep the bucket private.
5. Require malware scanning by setting `REQUIRE_CLAMAV=true` and starting the ClamAV Compose overlay, or configure a reachable scanner service.
6. Start with `docker compose --profile production up --build`.

Caddy obtains and renews certificates. The browser app and API share one HTTPS origin; Nginx proxies `/api/` and disables buffering so event streams remain live. The API and MongoDB are not published on host ports by the Compose file. Keep the host firewall restricted to 80/443 and administrative access.

`OCR_ENABLED=true` enables local PDF rendering and Tesseract OCR in the API container. OCR is bounded by `OCR_MAX_PAGES` and `OCR_TIMEOUT_MS`; it runs locally on uploaded files.

## Health and logs

- `GET /api/health/live` reports whether the process responds.
- `GET /api/health/ready` reports database, storage, and required scanner readiness. Use readiness for traffic routing and liveness for process restart decisions.
- API request and error logs are newline-delimited JSON on stdout, with request IDs, route templates, status codes, and durations. They omit request bodies, credentials, and client IP addresses.
- Signed-in write requests create audit records in MongoDB. Audit records contain the actor ID, request ID, route template, status, and timestamp; they do not contain document or report content.

`GET /api/metrics` exposes low-cardinality Prometheus text metrics only when `METRICS_TOKEN` is set. Send `Authorization: Bearer <token>` and scrape it from a trusted monitoring network. The endpoint is disabled with `404` when no token is configured.

Forward container logs, health checks, and metrics to your monitoring service. This repository does not include a hosted error tracker or admin dashboard; add those before relying on the service for production operations.

## Backups and restore

Back up MongoDB and uploaded objects on separate schedules. Local Compose uploads live in the `uploads` volume; S3/R2 uploads need the storage provider’s versioning or backup policy as well.

For the local Compose MongoDB volume, create an archive:

```sh
docker compose exec -T mongo mongodump --archive --gzip --db scholargraph > scholargraph.archive.gz
```

Restore into a maintenance window after stopping the API and preserving a copy of the current database:

```sh
docker compose stop api
docker compose exec -T mongo mongorestore --drop --archive --gzip --db scholargraph < scholargraph.archive.gz
docker compose start api
```

Test restores on a separate environment before treating the backup as valid. For managed MongoDB, use its supported backup and point-in-time recovery features. Keep backup encryption keys separate from the backup files.

## Secret rotation

- **Database:** create a replacement database user, update `MONGODB_URI_DOCKER`, roll the API, verify readiness, then revoke the old user.
- **Groq, Gemini, Tavily, OpenAlex, and S3/R2:** create replacement credentials in the provider console, update the deployment secret, recreate the API, verify the affected feature, then revoke the old credentials.
- **Rate limit hashing:** rotate `RATE_LIMIT_HASH_SECRET` and recreate the API. This changes bucket identifiers; old rate-limit entries expire automatically.
- **Sessions:** session tokens are random and only their digests are stored. To revoke all sessions, delete the `sessions` collection documents during a maintenance window; users will need to sign in again.

Do not commit `.env` files, database archives, or provider credentials. Prefer your platform’s secret manager over environment files on a public host.

## Scaling limit

Rate limits and audit records are stored in MongoDB and are shared by API instances. Research stage execution still runs inside the API process; do not scale this version to multiple workers for research execution until the durable queue and worker lease/retry design is implemented. Stored run events can be replayed, but persistence does not make the current in-process runner multi-worker safe.
