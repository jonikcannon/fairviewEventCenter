#!/usr/bin/env bash
set -euo pipefail

# Zero-downtime style deploy for this app.
# Run on server as app user from anywhere:
#   bash /var/www/fairview/app/scripts/deploy/deploy.sh

APP_DIR="${APP_DIR:-/var/www/fairview/app}"
DEPLOY_FRONTEND="${DEPLOY_FRONTEND:-true}"
RELOAD_NGINX="${RELOAD_NGINX:-true}"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "App directory not found: ${APP_DIR}"
  exit 1
fi

cd "${APP_DIR}"

echo "==> Pulling latest code"
git fetch --all --prune
# Naming the remote and branch explicitly: a bare `git pull --ff-only` fails on
# a branch with no upstream tracking, which is the state a fresh clone or a
# hand-provisioned box can easily be left in -- and it fails at step one of the
# deploy, before anything useful has happened.
git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"

echo "==> Installing dependencies"
npm ci

if [[ "${DEPLOY_FRONTEND}" == "true" ]]; then
  echo "==> Building frontend"
  npm run build
fi

echo "==> Restarting API"
pm2 reload fairviewApi --update-env

if [[ "${RELOAD_NGINX}" == "true" ]]; then
  echo "==> Reloading Nginx"
  sudo systemctl reload nginx
fi

# A reload that leaves the API down should fail the deploy rather than pass
# quietly. pm2 reports the process as online before the app has finished
# binding, so poll the endpoint instead of trusting pm2's status.
echo "==> Verifying the API responds"
for attempt in $(seq 1 15); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/products || true)"
  if [[ "${CODE}" == "200" ]]; then
    echo "API healthy (HTTP ${CODE}) after ${attempt} attempt(s)"
    break
  fi
  if [[ "${attempt}" == "15" ]]; then
    echo "API did not return 200 after the deploy (last: HTTP ${CODE:-no response})"
    pm2 logs fairviewApi --lines 40 --nostream || true
    exit 1
  fi
  sleep 2
done

echo "Deploy complete"
