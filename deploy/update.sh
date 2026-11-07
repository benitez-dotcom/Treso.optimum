#!/usr/bin/env bash
# Met à jour Tréso Optimum avec la dernière version de GitHub (lancé automatiquement
# par GitHub Actions à chaque publication, ou à la main : /opt/treso/deploy/update.sh).
set -euo pipefail
cd /opt/treso
git fetch --quiet origin main
git reset --quiet --hard origin/main
docker compose -f deploy/docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "Tréso Optimum à jour : $(git log -1 --format='%h %s')"
