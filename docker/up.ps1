$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RootDir

if (-not (Test-Path ".env")) {
  & (Join-Path $PSScriptRoot "prepare-env.ps1")
}

docker compose up -d --build postgres backend nginx
docker compose ps