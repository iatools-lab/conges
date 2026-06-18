#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "ERREUR: .env absent. Lancez d'abord bash docker/deploy.sh"
  exit 1
fi

enable_https="$(grep -E '^ENABLE_HTTPS=' .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
enable_https="${enable_https%\"}"
enable_https="${enable_https#\"}"

if [ "${enable_https:-false}" != "true" ]; then
  echo "ENABLE_HTTPS=false: aucun renouvellement certbot Docker a faire."
  exit 0
fi

docker compose --profile tls run --rm certbot renew
docker compose restart nginx

echo "Renouvellement termine."
