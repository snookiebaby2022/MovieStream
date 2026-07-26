# Deploy FlixNova from this PC to the VPS over SSH.
# Example:
#   .\deploy-remote.ps1 -HostName 75.119.137.174 -User root -KeyPath $env:USERPROFILE\.ssh\id_ed25519

param(
  [Parameter(Mandatory = $true)][string]$HostName,
  [string]$User = 'root',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\id_ed25519",
  [int]$Port = 22,
  [string]$AppDir = '/var/www/moviestream'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $KeyPath)) { throw "SSH key not found: $KeyPath" }

$remote = @"
set -e
cd '$AppDir'
git fetch origin
git reset --hard origin/main
cd backend
npm install --omit=dev
pm2 restart moviestream --update-env || pm2 start ../ecosystem.config.js --name moviestream
nginx -t && systemctl reload nginx || true
echo 'DEPLOY_OK'
git rev-parse --short HEAD
"@

Write-Host "Deploying to ${User}@${HostName}:${Port} ($AppDir) ..."
ssh -i $KeyPath -p $Port -o StrictHostKeyChecking=accept-new "${User}@${HostName}" $remote
Write-Host "Done. Hard-refresh the site (Ctrl+F5)."
