# Production deployment

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
