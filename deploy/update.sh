#!/usr/bin/env bash
# Обновить MASL на сервере до свежего кода из GitHub: sudo bash deploy/update.sh
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
git -C "$DEPLOY_DIR/.." pull --ff-only
docker compose -f "$DEPLOY_DIR/compose.yml" --env-file "$DEPLOY_DIR/.env" up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "Обновлено"
