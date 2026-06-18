#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

random_hex() {
  local byte_count="$1"

  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$byte_count"
    return
  fi

  node -e "console.log(require('crypto').randomBytes(Number(process.argv[1])).toString('hex'))" "$byte_count"
}

if [ -f "$ENV_FILE" ]; then
  echo ".env existe deja: $ENV_FILE"
  exit 0
fi

session_secret="$(random_hex 48)"

cat > "$ENV_FILE" <<EOF
DOMAIN_NAME=conges.upowa.org
SERVER_IP=203.0.113.10

POSTGRES_DB=conges_db
POSTGRES_USER=conges_user
POSTGRES_PASSWORD=CHANGE_ME_POSTGRES_PASSWORD

AUTH_SESSION_SECRET=$session_secret
AUTH_SESSION_TTL_HOURS=12
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
EOF

chmod 600 "$ENV_FILE" 2>/dev/null || true

echo ".env cree: $ENV_FILE"
echo "Renseignez DOMAIN_NAME, SERVER_IP, POSTGRES_PASSWORD et AUTH_ADMIN_PASSWORD_HASH dans .env avant de lancer docker/deploy.sh."
echo "Vous pouvez aussi partir du modele DEPLOYMENT_PARAMETERS.env.example, puis copier vers .env."
