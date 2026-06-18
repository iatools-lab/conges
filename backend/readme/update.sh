#!/usr/bin/env bash
# Wrapper legacy: redirige vers le script Docker principal.
# Usage: bash backend/readme/update.sh [OPTIONS]

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
ROOT_UPDATE_SCRIPT="$PROJECT_ROOT/update.sh"

if [ ! -f "$ROOT_UPDATE_SCRIPT" ]; then
	echo "Erreur: script introuvable: $ROOT_UPDATE_SCRIPT" >&2
	exit 1
fi

echo "==> Script legacy detecte: delegation vers update Docker"
echo "==> Executing: bash $ROOT_UPDATE_SCRIPT $*"

exec bash "$ROOT_UPDATE_SCRIPT" "$@"
