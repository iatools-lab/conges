#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

read_env_value() {
  local key="$1"
  local default_value="$2"
  local value

  value="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"

  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$default_value"
  fi
}

check_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERREUR: commande absente: $cmd"
    exit 1
  fi
}

check_host_port_available() {
  local port="$1"
  local bind_address="$2"
  local listeners

  if ! command -v ss >/dev/null 2>&1; then
    return
  fi

  listeners="$(ss -ltn "sport = :$port" 2>/dev/null || true)"
  if [ "$(printf '%s\n' "$listeners" | wc -l)" -le 1 ]; then
    return
  fi

  echo "ERREUR: le port ${bind_address}:${port} est deja utilise sur le serveur."
  echo "$listeners"
  echo ""
  echo "Choisissez des ports libres dans .env :"
  echo "  NGINX_HTTP_PORT=18080"
  echo "  NGINX_HTTPS_PORT=18443"
  echo ""
  echo "Puis relancez: bash docker/deploy.sh"
  exit 1
}

wait_for_postgres() {
  local postgres_user="$1"
  local attempts=30

  until docker compose exec -T postgres pg_isready -U "$postgres_user" -d postgres >/dev/null 2>&1; do
    attempts=$((attempts - 1))
    if [ "$attempts" -le 0 ]; then
      echo "ERREUR: PostgreSQL n'est pas pret."
      docker compose logs --tail=120 postgres || true
      exit 1
    fi
    sleep 2
  done
}

ensure_postgres_database() {
  local postgres_user="$1"
  local postgres_db="$2"

  echo "Verification/creation de la base PostgreSQL '$postgres_db'..."
  wait_for_postgres "$postgres_user"

  if ! docker compose exec -T postgres sh /docker-entrypoint-initdb.d/10-ensure-database.sh; then
    echo "ERREUR: impossible de verifier ou creer la base PostgreSQL '$postgres_db'."
    docker compose logs --tail=120 postgres || true
    exit 1
  fi
}

validate_postgres_config() {
  local postgres_db="$1"
  local postgres_user="$2"
  local postgres_password="$3"

  if [ -z "$postgres_db" ]; then
    echo "ERREUR: POSTGRES_DB est vide dans .env."
    exit 1
  fi

  if [ -z "$postgres_user" ]; then
    echo "ERREUR: POSTGRES_USER est vide dans .env."
    exit 1
  fi

  case "$postgres_password" in
    ""|"replace-with-generated-password"|"replace-with-your-postgres-password"|"CHANGE_ME_POSTGRES_PASSWORD")
      echo "ERREUR: POSTGRES_PASSWORD n'est pas renseigne dans .env."
      exit 1
      ;;
  esac
}

validate_mail_config() {
  local email_mode="$1"
  local mail_host="$2"
  local mail_port="$3"
  local mail_user="$4"
  local mail_pass="$5"
  local mail_from="$6"

  case "$email_mode" in
    off|"")
      return
      ;;
    dev|live|prod)
      ;;
    *)
      echo "ERREUR: EMAIL_MODE doit valoir off, dev, live ou prod. Valeur actuelle: $email_mode"
      exit 1
      ;;
  esac

  if [ -z "$mail_host" ] || [ -z "$mail_port" ] || [ -z "$mail_from" ]; then
    echo "ERREUR: configuration mail incomplete dans .env (MAIL_HOST/MAIL_PORT/MAIL_FROM)."
    exit 1
  fi

  if [ -z "$mail_user" ] || [ -z "$mail_pass" ]; then
    echo "AVERTISSEMENT: MAIL_USER ou MAIL_PASS vide. SMTP sera utilise sans authentification (mode relay)."
  fi
}

check_command docker
if ! docker compose version >/dev/null 2>&1; then
  echo "ERREUR: Docker Compose v2 est absent."
  echo "Installez Docker Compose puis relancez bash docker/deploy.sh."
  exit 1
fi

if [ ! -f .env ]; then
  bash docker/prepare-env.sh
fi

postgres_db="$(read_env_value POSTGRES_DB "")"
postgres_user="$(read_env_value POSTGRES_USER "")"
postgres_password="$(read_env_value POSTGRES_PASSWORD "")"
domain_name="$(read_env_value DOMAIN_NAME "app.example.com")"
nginx_bind_address="$(read_env_value NGINX_BIND_ADDRESS "0.0.0.0")"
nginx_http_port="$(read_env_value NGINX_HTTP_PORT "8080")"
nginx_https_port="$(read_env_value NGINX_HTTPS_PORT "8443")"
enable_https="$(read_env_value ENABLE_HTTPS "false")"
email_mode="$(read_env_value EMAIL_MODE "off")"
mail_host="$(read_env_value MAIL_HOST "")"
mail_port="$(read_env_value MAIL_PORT "")"
mail_user="$(read_env_value MAIL_USER "")"
mail_pass="$(read_env_value MAIL_PASS "")"
mail_from="$(read_env_value MAIL_FROM "")"

validate_postgres_config "$postgres_db" "$postgres_user" "$postgres_password"
validate_mail_config "$email_mode" "$mail_host" "$mail_port" "$mail_user" "$mail_pass" "$mail_from"

check_host_port_available "$nginx_http_port" "$nginx_bind_address"
check_host_port_available "$nginx_https_port" "$nginx_bind_address"

if [ "$enable_https" = "true" ] && { [ "$nginx_bind_address" != "0.0.0.0" ] || [ "$nginx_http_port" != "80" ]; }; then
  echo "ERREUR: ENABLE_HTTPS=true exige un acces public au port 80 du conteneur nginx."
  echo "Mettez dans .env: NGINX_BIND_ADDRESS=0.0.0.0 et NGINX_HTTP_PORT=80"
  exit 1
fi

echo "Build des images Docker backend et nginx/frontend..."
docker compose build backend nginx

echo "Demarrage PostgreSQL..."
docker compose up -d postgres

ensure_postgres_database "$postgres_user" "$postgres_db"

echo "Demarrage backend + nginx..."
if ! docker compose up -d backend nginx; then
  echo "ERREUR: echec du demarrage backend/nginx."
  docker compose ps || true
  docker compose logs --tail=200 backend || true
  docker compose logs --tail=200 nginx || true
  exit 1
fi

if [ "$enable_https" = "true" ]; then
  echo "Generation/renouvellement du certificat Let's Encrypt (conteneur certbot)..."
  if docker compose --profile tls run --rm certbot; then
    docker compose restart nginx
  else
    echo "ERREUR: certificat HTTPS non obtenu pour ${domain_name}."
    echo "Verifiez DNS et ouverture du port 80 vers ce serveur."
    exit 1
  fi
fi

docker compose ps
