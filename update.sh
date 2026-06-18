#!/usr/bin/env bash
# ===========================================================================
# update.sh — Mise à jour du projet upOwa Congés en production (Docker)
# Usage : sudo bash update.sh [OPTIONS]
#
# Options :
#   --skip-backup     Ne pas effectuer la sauvegarde PostgreSQL avant la MAJ
#   --skip-pull       Ne pas faire git pull (déploiement manuel)
#   --no-restart-all  Redémarrer uniquement les conteneurs impactés (pas nginx)
#   --dry-run         Afficher les commandes sans les exécuter
# ===========================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/conges}"
LOG_FILE="${LOG_FILE:-/var/log/conges-update.log}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

# ── Couleurs ────────────────────────────────────────────────────────────────
RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
RESET="\033[0m"

# ── Flags ───────────────────────────────────────────────────────────────────
SKIP_BACKUP=false
SKIP_PULL=false
NO_RESTART_ALL=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --skip-backup)    SKIP_BACKUP=true ;;
    --skip-pull)      SKIP_PULL=true ;;
    --no-restart-all) NO_RESTART_ALL=true ;;
    --dry-run)        DRY_RUN=true ;;
    *)
      echo -e "${RED}Option inconnue : $arg${RESET}" >&2
      exit 1
      ;;
  esac
done

# ── Helpers ─────────────────────────────────────────────────────────────────
log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo -e "${CYAN}${msg}${RESET}"
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

ok()   { echo -e "${GREEN}  ✔ $*${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${RESET}"; }
err()  { echo -e "${RED}  ✘ $*${RESET}" >&2; }

run() {
  if $DRY_RUN; then
    echo -e "${YELLOW}  [dry-run] $*${RESET}"
  else
    eval "$@"
  fi
}

# ── Vérifications préalables ─────────────────────────────────────────────────
if [ ! -f "$COMPOSE_FILE" ]; then
  err "docker-compose.yml introuvable : $COMPOSE_FILE"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  err "Docker non trouvé. Installez Docker puis relancez."
  exit 1
fi

if ! docker compose version &>/dev/null 2>&1; then
  err "docker compose (v2) non disponible."
  exit 1
fi

log "=== Démarrage de la mise à jour (timestamp: $TIMESTAMP) ==="

# ── 1. Sauvegarde PostgreSQL ──────────────────────────────────────────────────
if ! $SKIP_BACKUP; then
  log "Étape 1/6 : Sauvegarde de la base de données PostgreSQL..."
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/conges_${TIMESTAMP}.sql.gz"
  run "docker compose -f \"$COMPOSE_FILE\" exec -T postgres \
    pg_dump -U \"\${POSTGRES_USER:-conges}\" \"\${POSTGRES_DB:-conges}\" \
    | gzip > \"$BACKUP_FILE\""
  ok "Sauvegarde créée : $BACKUP_FILE"
  # Garder seulement les 10 dernières sauvegardes
  run "ls -t \"$BACKUP_DIR\"/conges_*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm --"
else
  warn "Sauvegarde ignorée (--skip-backup)."
fi

# ── 2. Récupération des changements ──────────────────────────────────────────
if ! $SKIP_PULL; then
  log "Étape 2/6 : Récupération des dernières modifications (git pull)..."
  run "git -C \"$(dirname "$0")\" pull --rebase --autostash"
  ok "Sources mises à jour."
else
  warn "git pull ignoré (--skip-pull)."
fi

# ── 3. Reconstruction des images Docker ──────────────────────────────────────
log "Étape 3/6 : Reconstruction des images (backend + nginx/frontend)..."
run "docker compose -f \"$COMPOSE_FILE\" build --pull backend nginx"
ok "Images reconstruites."

# ── 4. Arrêt et redémarrage des services ─────────────────────────────────────
log "Étape 4/6 : Redémarrage des services..."
if $NO_RESTART_ALL; then
  run "docker compose -f \"$COMPOSE_FILE\" up -d --no-deps backend"
  ok "Seul le backend a été redémarré."
else
  run "docker compose -f \"$COMPOSE_FILE\" up -d --remove-orphans"
  ok "Tous les services redémarrés."
fi

# ── 5. Attendre que le backend soit sain ─────────────────────────────────────
log "Étape 5/6 : Attente de la disponibilité du backend..."
MAX_WAIT=120
WAITED=0
until docker compose -f "$COMPOSE_FILE" exec -T backend \
    node -e "fetch('http://127.0.0.1:3000/api/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    &>/dev/null 2>&1; do
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    err "Le backend n'est pas disponible après ${MAX_WAIT}s."
    err "Vérifiez les logs : docker compose logs --tail=50 backend"
    exit 1
  fi
  sleep 3
  WAITED=$((WAITED + 3))
  echo -n "."
done
echo ""
ok "Backend opérationnel (${WAITED}s)."

# ── 6. Nettoyage des images inutilisées ──────────────────────────────────────
log "Étape 6/6 : Nettoyage des images Docker obsolètes..."
run "docker image prune -f --filter 'until=24h'"
ok "Nettoyage terminé."

# ── Résumé ───────────────────────────────────────────────────────────────────
log "=== Mise à jour terminée avec succès (${TIMESTAMP}) ==="
echo ""
echo -e "${GREEN}Résumé des services :${RESET}"
docker compose -f "$COMPOSE_FILE" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
  docker compose -f "$COMPOSE_FILE" ps
