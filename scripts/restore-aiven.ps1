param(
    [Parameter(Mandatory = $true)][string]$BackupFile,
    [string]$TargetDatabaseUrl = $env:VISION_AI_RESTORE_DATABASE_URL,
    [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"
if (-not $ConfirmRestore) {
    throw "Restore is destructive. Re-run with -ConfirmRestore and a dedicated restore/test database URL."
}
if ([string]::IsNullOrWhiteSpace($TargetDatabaseUrl)) {
    throw "Set VISION_AI_RESTORE_DATABASE_URL or pass -TargetDatabaseUrl. Never default restore to production."
}
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) {
    throw "pg_restore was not found. Install PostgreSQL client tools first."
}

$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
if ([System.IO.Path]::GetExtension($resolvedBackup) -ne ".dump") {
    throw "Only a .dump file created by backup-aiven.ps1 is accepted."
}
$hashFile = "$resolvedBackup.sha256"
if (-not (Test-Path -LiteralPath $hashFile)) {
    throw "Missing SHA256 manifest: $hashFile"
}
$expectedHash = ((Get-Content -LiteralPath $hashFile -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedBackup).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
    throw "Backup checksum mismatch. Restore aborted."
}

$pgUrl = $TargetDatabaseUrl -replace '^postgresql\+psycopg://', 'postgresql://' -replace '^postgres://', 'postgresql://'
& pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction --dbname=$pgUrl $resolvedBackup
if ($LASTEXITCODE -ne 0) {
    throw "pg_restore failed. Target database may have rolled back the transaction."
}
Write-Output "Restore completed and checksum verified: $resolvedBackup"
