#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REQUESTS="${PREPROD_LOAD_REQUESTS:-100}"
CONCURRENCY="${PREPROD_LOAD_CONCURRENCY:-10}"
HTTP_PORT="${NGINX_HTTP_PORT:-8080}"
BASE_URL="${PREPROD_BASE_URL:-http://127.0.0.1:${HTTP_PORT}}"
SMTP_RECIPIENT="${PREPROD_SMTP_RECIPIENT:-}"
BACKUP_FILE="$(mktemp "${TMPDIR:-/tmp}/conges-backup-XXXXXX.dump")"
LOAD_RESULTS="$(mktemp "${TMPDIR:-/tmp}/conges-load-XXXXXX.txt")"
RESTORE_DB=""

cleanup() {
  if [ -n "$RESTORE_DB" ]; then
    docker compose exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
  fi
  rm -f "$BACKUP_FILE" "$LOAD_RESULTS"
}
trap cleanup EXIT

for command in docker curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERREUR: commande absente: $command" >&2
    exit 1
  fi
done

docker compose config --quiet

POSTGRES_USER="$(docker compose exec -T postgres printenv POSTGRES_USER | tr -d '\r')"
POSTGRES_DB="$(docker compose exec -T postgres printenv POSTGRES_DB | tr -d '\r')"
if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_DB" ]; then
  echo "ERREUR: configuration PostgreSQL introuvable dans le conteneur." >&2
  exit 1
fi

echo "[1/6] Santé et supervision des conteneurs"
docker compose ps
curl --fail --silent --show-error "$BASE_URL/healthz" >/dev/null
curl --fail --silent --show-error "$BASE_URL/api/v1/healthz" >/dev/null

unhealthy="$(docker compose ps --format json | grep -c '"Health":"unhealthy"' || true)"
if [ "$unhealthy" -ne 0 ]; then
  echo "ERREUR: au moins un conteneur est unhealthy." >&2
  exit 1
fi

echo "[2/6] Sauvegarde PostgreSQL"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc >"$BACKUP_FILE"
test -s "$BACKUP_FILE"

echo "[3/6] Restauration dans une base temporaire"
RESTORE_DB="conges_restore_check_$(date +%s)"
docker compose exec -T postgres createdb -U "$POSTGRES_USER" "$RESTORE_DB"
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DB" --no-owner --no-privileges <"$BACKUP_FILE"
table_count="$(docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$RESTORE_DB" -Atc "select count(*) from information_schema.tables where table_schema='public';" | tr -d '\r')"
if [ "${table_count:-0}" -lt 1 ]; then
  echo "ERREUR: la base restaurée ne contient aucune table." >&2
  exit 1
fi

echo "[4/6] SMTP"
email_mode="$(docker compose exec -T backend printenv EMAIL_MODE | tr -d '\r')"
if [ "$email_mode" = "off" ] || [ -z "$email_mode" ]; then
  echo "SMTP ignoré: EMAIL_MODE=off"
else
  docker compose exec -T -e PREPROD_SMTP_RECIPIENT="$SMTP_RECIPIENT" backend node -e '
    const nodemailer = require("nodemailer");
    const port = Number(process.env.MAIL_PORT || 0);
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port,
      secure: port === 465,
      ...(process.env.MAIL_USER && process.env.MAIL_PASS
        ? { auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS } }
        : {}),
    });
    (async () => {
      await transporter.verify();
      if (process.env.PREPROD_SMTP_RECIPIENT) {
        await transporter.sendMail({
          from: process.env.MAIL_FROM,
          to: process.env.PREPROD_SMTP_RECIPIENT,
          subject: "Test préproduction Congés",
          text: "La connexion et la livraison SMTP de préproduction fonctionnent.",
        });
      }
    })().catch((error) => { console.error(error); process.exit(1); });
  '
fi

echo "[5/6] TLS et en-têtes de sécurité"
if [[ "$BASE_URL" == https://* ]]; then
  headers="$(curl --fail --silent --show-error --tlsv1.2 -I "$BASE_URL/healthz")"
  grep -qi '^strict-transport-security:' <<<"$headers"
  grep -qi '^content-security-policy:' <<<"$headers"
else
  echo "TLS ignoré: PREPROD_BASE_URL ne commence pas par https://"
fi

echo "[6/6] Charge légère (${REQUESTS} requêtes, concurrence ${CONCURRENCY})"
seq "$REQUESTS" | xargs -P "$CONCURRENCY" -I {} sh -c \
  'curl --silent --output /dev/null --write-out "%{http_code}\n" "$1/api/v1/healthz"' _ "$BASE_URL" \
  >"$LOAD_RESULTS"
failed="$(grep -vc '^200$' "$LOAD_RESULTS" || true)"
if [ "$failed" -ne 0 ]; then
  echo "ERREUR: ${failed}/${REQUESTS} requêtes de charge ont échoué." >&2
  exit 1
fi

echo "Tous les contrôles de préproduction ont réussi."
