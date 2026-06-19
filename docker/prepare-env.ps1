$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$EnvFile = Join-Path $RootDir ".env"

function New-RandomHex {
  param([int]$ByteCount)

  $bytes = New-Object byte[] $ByteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }

  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

if (Test-Path $EnvFile) {
  Write-Host ".env existe deja: $EnvFile"
  exit 0
}

$sessionSecret = New-RandomHex 48

$content = @"
DOMAIN_NAME=conges.upowa.org
SERVER_IP=203.0.113.10

POSTGRES_DB=conges_db
POSTGRES_USER=conges_user
POSTGRES_PASSWORD=CHANGE_ME_POSTGRES_PASSWORD

AUTH_SESSION_SECRET=$sessionSecret
AUTH_SESSION_TTL_HOURS=12
AUTH_GOOGLE_ONLY=true
AUTH_ADMIN_PASSWORD_HASH=CHANGE_ME_ADMIN_PASSWORD_HASH
GOOGLE_CLIENT_ID=449904699288-upv55q520qi2tc3gbg6vh4ouf1lp31md.apps.googleusercontent.com
RH_AUTO_REJECT_DAYS=7
ENABLE_SWAGGER=false

CORS_ORIGINS=https://conges.upowa.org,http://conges.upowa.org,http://203.0.113.10
FRONTEND_URL=https://conges.upowa.org
VITE_API_URL=/api/v1
RUN_PRISMA_MIGRATIONS=true

NGINX_BIND_ADDRESS=0.0.0.0
NGINX_HTTP_PORT=8080
NGINX_HTTPS_PORT=8443

EMAIL_MODE=prod
MAIL_HOST=smtp-relay.gmail.com
MAIL_PORT=465
MAIL_USER=conges@upowa.org
MAIL_PASS=
MAIL_FROM=Conges <conges@upowa.org>
DEV_EMAIL_RECIPIENT=

ENABLE_HTTPS=false
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($EnvFile, $content, $utf8NoBom)

Write-Host ".env cree: $EnvFile"
Write-Host "Renseignez DOMAIN_NAME, SERVER_IP et POSTGRES_PASSWORD dans .env avant de lancer docker/deploy.sh."
Write-Host "Vous pouvez aussi partir du modele DEPLOYMENT_PARAMETERS.env.example, puis copier vers .env."
