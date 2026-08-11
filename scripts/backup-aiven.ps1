param(
    [string]$DatabaseUrl = $env:VISION_AI_DATABASE_URL,
    [string]$BackupDirectory = (Join-Path $PSScriptRoot "..\backups"),
    [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    throw "Set VISION_AI_DATABASE_URL or pass -DatabaseUrl."
}
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
    throw "pg_dump was not found. Install PostgreSQL client tools first."
}

$pgUrl = $DatabaseUrl -replace '^postgresql\+psycopg://', 'postgresql://' -replace '^postgres://', 'postgresql://'
$targetDirectory = [System.IO.Path]::GetFullPath($BackupDirectory)
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$backupPath = Join-Path $targetDirectory "vision-ai-$timestamp.dump"

& pg_dump --format=custom --compress=9 --no-owner --no-acl --dbname=$pgUrl --file=$backupPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath)) {
    throw "pg_dump failed; no valid backup was produced."
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backupPath).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$backupPath.sha256" -Value "$hash  $([System.IO.Path]::GetFileName($backupPath))" -Encoding ascii

$cutoff = (Get-Date).ToUniversalTime().AddDays(-[Math]::Abs($RetentionDays))
Get-ChildItem -LiteralPath $targetDirectory -Filter "vision-ai-*.dump" -File |
    Where-Object { $_.LastWriteTimeUtc -lt $cutoff } |
    ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        Remove-Item -LiteralPath "$($_.FullName).sha256" -Force -ErrorAction SilentlyContinue
    }

Write-Output "Backup created: $backupPath"
Write-Output "SHA256: $hash"
