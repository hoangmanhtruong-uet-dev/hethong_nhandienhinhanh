# Recovery and incident runbook

## Aiven PostgreSQL backup and restore

Aiven managed backups remain the first recovery layer. In Aiven Console, verify the
service **Backups** view shows recent restore points and never test a restore directly
against production. Create a temporary Aiven service/database and restore there first.

Create an independent logical backup with PostgreSQL client tools installed:

```powershell
$env:VISION_AI_DATABASE_URL="postgresql://...sslmode=require"
.\scripts\backup-aiven.ps1
```

The script creates `backups/vision-ai-*.dump` plus a SHA-256 manifest and removes
logical backups older than 14 days. Copy encrypted backups to storage outside this
computer; the repository intentionally ignores them.

Restore only to a dedicated empty/test database:

```powershell
$env:VISION_AI_RESTORE_DATABASE_URL="postgresql://RESTORE_TARGET...sslmode=require"
.\scripts\restore-aiven.ps1 -BackupFile .\backups\vision-ai-YYYYMMDD-HHMMSS.dump -ConfirmRestore
cd backend
alembic upgrade head
```

After restore, compare row counts for `users`, `scans`, `collections`, and `feedback`,
then log in and open several historical images. PostgreSQL backups contain Cloudinary
references, not the image bytes, so Cloudinary needs its own retention/versioning plan.

## Cloudinary deletion

Deletion is storage-first. The API removes the database row only after Cloudinary
returns `ok` or `not found`. If Cloudinary is unavailable, the API returns `502` and
keeps the database record so the user can retry. Test this after credential rotation
by creating one disposable scan, deleting it, and confirming `GET /api/scans/{id}` is
`404`.

## Failure responses

| Situation | API/UI behavior | Operator action |
| --- | --- | --- |
| Phone offline | UI reports no network and keeps local AI result | Reconnect; retry sync/cloud analysis |
| Server timeout | `504 request_timeout`, request ID, Retry-After | Inspect Render logs using request ID |
| PostgreSQL unavailable | `503 database_unavailable` | Check Aiven status/connections, then readiness |
| Cloudinary unavailable | `502`; database record retained on delete | Check Cloudinary status/quota and retry |
| Too many requests | `429 rate_limited`, Retry-After | Check abusive IP patterns and edge logs |
| Camera permission denied | Explicit permission guidance; upload remains available | Enable camera in browser/OS settings |
| Camera missing/busy/broken | Specific message and upload fallback | Close other camera apps or inspect hardware |

The in-process limiter reduces small bursts but cannot absorb volumetric DDoS. For a
public launch, place Cloudflare in front of a custom domain (WAF, rate limiting, bot
protection) or use equivalent Render edge protection. Never rely on Python workers as
the DDoS boundary.
