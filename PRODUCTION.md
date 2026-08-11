# Production deployment

## Automated production smoke test

After `Vision AI CI` succeeds on `main`, GitHub Actions starts `Vision AI Production Smoke`.
The smoke job waits until Render reports the same Git commit, then checks readiness,
the PWA manifest/service worker, and verifies that private API endpoints reject anonymous access.
It performs no writes and creates no production accounts, scans, or collections.

Run the same check locally with:

```powershell
$env:VISION_AI_SMOKE_URL="https://hethong-nhandienhinhanh.onrender.com"
npm run smoke:production
```

## Optional Gemini image enhancement

Gemini is an explicit, one-shot cloud enhancement. Local YOLO/COCO detection runs first;
the browser sends a compressed 1024px copy only after the signed-in user chooses
`Phân tích AI nâng cao`. The API key never reaches browser JavaScript.

Configure these Render environment variables:

```dotenv
VISION_AI_GEMINI_API_KEY=AIza...
VISION_AI_GEMINI_MODEL=gemini-3.5-flash
VISION_AI_GEMINI_REQUESTS_PER_HOUR=20
```

The backend validates and recompresses the image, enforces an account/IP rate limit,
requests structured JSON, and keeps the local result unchanged on timeout, quota, or
provider failure. Free-tier images may be used by the provider to improve its products,
so cloud analysis must remain opt-in.

The production stack contains one FastAPI container and Caddy as the HTTPS reverse proxy. PostgreSQL remains on Aiven and images remain on Cloudinary.

## Prerequisites

- A Linux VPS with Docker Engine and Docker Compose.
- A public domain with an `A`/`AAAA` record pointing to the VPS.
- TCP ports 80 and 443, and UDP 443 open.
- Rotated Aiven and Cloudinary credentials in `backend/.env`.

## Configure

Copy `.env.production.example` to `.env.production` and set the public domain. In `backend/.env`, set:

```dotenv
VISION_AI_DATABASE_URL=postgres://...
VISION_AI_CLOUDINARY_URL=cloudinary://...
VISION_AI_CORS_ORIGINS=https://vision.example.com
```

Never copy an `.env` file into the Docker image or commit it to Git.

## Launch

```bash
docker compose --env-file .env.production -f compose.production.yml up -d --build
docker compose --env-file .env.production -f compose.production.yml ps
```

Caddy obtains and renews the TLS certificate automatically after DNS resolves to the server. Verify `https://YOUR_DOMAIN/api/health`; it should report PostgreSQL and Cloudinary.

## Update

```bash
git pull
docker compose --env-file .env.production -f compose.production.yml up -d --build
```

The browser service worker detects the new frontend build and offers the in-app update action.
# Production release flow

Schema changes are managed by Alembic and are never applied by FastAPI startup.

```powershell
cd backend
alembic upgrade head
```

Render Free does not support pre-deploy commands. Add `VISION_AI_DATABASE_URL` and
`VISION_AI_ENCRYPTION_KEY` to the GitHub `production` environment; the CI migration
job upgrades Aiven after tests pass. Then set Render's health check path to
`/api/health/ready` and Auto-Deploy to **After CI Checks Pass**. Paid Render services
may instead use `cd backend && alembic upgrade head` as a pre-deploy command.

Render Free blocks common SMTP ports, so account email defaults to the Resend HTTPS
API via `VISION_AI_RESEND_API_KEY`. Set `VISION_AI_SMTP_FROM_EMAIL` to a verified
sender and enable `VISION_AI_REQUIRE_EMAIL_PROVIDER` after configuration. SMTP remains
available for a VPS or local environment.

The Model Center benchmark stores per-user latency, optional browser memory and
ground-truth accuracy at `/api/model-evaluations`. No benchmark image is uploaded.
