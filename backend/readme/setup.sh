#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# CONFIGURATION A MODIFIER AVANT EXECUTION
###############################################################################

APP_DIR="/var/www/conges"

MONOREPO_REPO_URL="A_CHANGER_URL_DEPOT_CONGES.git"
APP_BRANCH="main"

BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"

DB_NAME="conges"
DB_USER="conges_user"
DB_PASSWORD="A_CHANGER_MOT_DE_PASSE_DB"
DB_HOST="localhost"
DB_PORT="5432"
DB_SCHEMA="public"

BACKEND_PORT="3000"
FRONTEND_PORT="8080"
FRONTEND_PUBLIC_URL="https://conges.example.com"
BACKEND_PUBLIC_URL="https://api-conges.example.com"
VITE_API_URL="${BACKEND_PUBLIC_URL}/api/v1"

AUTH_SESSION_SECRET="A_CHANGER_SECRET_ALEATOIRE_MINIMUM_32_CARACTERES"
AUTH_SESSION_TTL_HOURS="12"
GOOGLE_CLIENT_ID="449904699288-upv55q520qi2tc3gbg6vh4ouf1lp31md.apps.googleusercontent.com"

EMAIL_MODE="prod"
MAIL_HOST="smtp-relay.gmail.com"
MAIL_PORT="465"
MAIL_USER="conges@upowa.org"
MAIL_PASS="A_CHANGER_MOT_DE_PASSE_SMTP"
MAIL_FROM="Conges <conges@upowa.org>"
RH_AUTO_REJECT_DAYS="7"

PM2_BACKEND_NAME="conges-backend"
PM2_FRONTEND_NAME="conges-frontend"
BACKEND_ENTRY="dist/main.js"

###############################################################################
# NE PAS MODIFIER SOUS CETTE LIGNE SAUF BESOIN SPECIFIQUE
###############################################################################

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=${DB_SCHEMA}"

echo "==> Installation des paquets systeme"
sudo apt-get update
sudo apt-get install -y ca-certificates curl git postgresql postgresql-contrib nginx

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installation de Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Installation de PM2 et serve"
sudo npm install -g pm2 serve

echo "==> Creation du dossier projet"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"

echo "==> Creation ou mise a jour de la base PostgreSQL"
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

echo "==> Recuperation du depot conges"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$APP_BRANCH"
  git -C "$APP_DIR" checkout "$APP_BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$APP_BRANCH"
else
  git clone --branch "$APP_BRANCH" "$MONOREPO_REPO_URL" "$APP_DIR"
fi

echo "==> Generation backend/.env"
cat > "$BACKEND_DIR/.env" <<EOF
NODE_ENV=production
DATABASE_URL="${DATABASE_URL}"
PORT=${BACKEND_PORT}
CORS_ORIGINS="${FRONTEND_PUBLIC_URL}"
AUTH_SESSION_SECRET="${AUTH_SESSION_SECRET}"
AUTH_SESSION_TTL_HOURS=${AUTH_SESSION_TTL_HOURS}
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}"
EMAIL_MODE="${EMAIL_MODE}"
MAIL_HOST="${MAIL_HOST}"
MAIL_PORT=${MAIL_PORT}
MAIL_USER="${MAIL_USER}"
MAIL_PASS="${MAIL_PASS}"
MAIL_FROM="${MAIL_FROM}"
RH_AUTO_REJECT_DAYS=${RH_AUTO_REJECT_DAYS}
EOF

echo "==> Generation frontend/.env"
cat > "$FRONTEND_DIR/.env" <<EOF
VITE_API_URL="${VITE_API_URL}"
VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}"
EOF

echo "==> Installation et build backend"
cd "$BACKEND_DIR"
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build

echo "==> Installation et build frontend"
cd "$FRONTEND_DIR"
npm ci
npm run build

echo "==> Demarrage PM2 backend"
pm2 delete "$PM2_BACKEND_NAME" >/dev/null 2>&1 || true
cd "$BACKEND_DIR"
pm2 start "$BACKEND_ENTRY" --name "$PM2_BACKEND_NAME" --update-env

echo "==> Demarrage PM2 frontend"
pm2 delete "$PM2_FRONTEND_NAME" >/dev/null 2>&1 || true
cd "$FRONTEND_DIR"
pm2 start serve --name "$PM2_FRONTEND_NAME" -- dist -l "$FRONTEND_PORT" --single

pm2 save

echo "==> Installation terminee"
echo "Frontend local : http://localhost:${FRONTEND_PORT}"
echo "Backend local  : http://localhost:${BACKEND_PORT}/api/v1"
echo "Configurer ensuite Nginx/HTTPS pour :"
echo "- ${FRONTEND_PUBLIC_URL} -> localhost:${FRONTEND_PORT}"
echo "- ${BACKEND_PUBLIC_URL} -> localhost:${BACKEND_PORT}"
