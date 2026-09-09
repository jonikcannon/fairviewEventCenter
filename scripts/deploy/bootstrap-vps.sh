#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sudo bash bootstrap-vps.sh yourdomain.com your-github-repo-url [cert-email]
# Example:
#   sudo bash bootstrap-vps.sh fairview-event-center.com https://github.com/your-user/fairviewEventCenter.git hello@fairview-event-center.com

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0 <domain> <repo-url>"
  exit 1
fi

DOMAIN="${1:-}"
REPO_URL="${2:-}"
CERT_EMAIL="${3:-admin@${1:-example.com}}"
APP_USER="${SUDO_USER:-$USER}"
APP_ROOT="/var/www/fairview"
APP_DIR="${APP_ROOT}/app"
DATA_DIR="${APP_ROOT}/data"

if [[ -z "${DOMAIN}" || -z "${REPO_URL}" ]]; then
  echo "Missing required args."
  echo "Usage: sudo bash $0 <domain> <repo-url> [cert-email]"
  exit 1
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  echo "App user not found: ${APP_USER}"
  exit 1
fi

# Ubuntu 24.04+ ships needrestart, which opens an interactive "restart these
# services?" dialog after package installs. Under any non-tty stdout -- a pipe
# to tee, a CI log -- it cannot claim the terminal and the whole apt run is
# stopped by SIGTTOU, holding the dpkg lock indefinitely. Answering
# automatically keeps the install unattended.
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

echo "==> Installing packages"
apt-get update
apt-get install -y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef nginx certbot python3-certbot-nginx git curl build-essential ufw fail2ban rsync

NODE_MAJOR="$(command -v node >/dev/null 2>&1 && node -v | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -o Dpkg::Options::=--force-confold nodejs
else
  echo "==> Node.js already installed (v${NODE_MAJOR}, >= 20) -- leaving it alone. A shared box may run a newer"
  echo "    major version for another app; forcing an exact v20 match would downgrade it."
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "==> Creating app folders"
mkdir -p "${APP_ROOT}"
chown -R "${APP_USER}:${APP_USER}" "${APP_ROOT}"

su - "${APP_USER}" -c "mkdir -p '${APP_DIR}' '${DATA_DIR}/storage/uploads' '${DATA_DIR}/storage/inquiries' '${DATA_DIR}/storage/media'"

# The logs directory is deliberately created AFTER the checkout below. Creating
# it here would leave ${APP_DIR} non-empty, and `git clone` refuses a non-empty
# destination -- which made this script fail on every genuinely fresh box.
if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "==> Fetching repository into ${APP_DIR}"
  # init+fetch+checkout rather than `git clone`, because the directory may
  # already hold files (a previous partial run, or logs created early). Clone
  # cannot target a non-empty directory; this can.
  su - "${APP_USER}" -c "cd '${APP_DIR}' \
    && git init -q \
    && (git remote add origin '${REPO_URL}' 2>/dev/null || git remote set-url origin '${REPO_URL}') \
    && git fetch -q --depth 1 origin HEAD \
    && git checkout -q -f FETCH_HEAD \
    && git branch -f master FETCH_HEAD \
    && git symbolic-ref HEAD refs/heads/master \
    && git branch --set-upstream-to=origin/master master 2>/dev/null || true"
else
  echo "==> Repository exists, pulling latest"
  su - "${APP_USER}" -c "cd '${APP_DIR}' && git fetch -q origin && git reset --hard -q origin/master"
fi

su - "${APP_USER}" -c "mkdir -p '${APP_DIR}/logs'"

echo "==> Installing dependencies and building"
su - "${APP_USER}" -c "cd '${APP_DIR}' && npm ci && npm run build"

echo "==> Creating persistent data links"
if [[ -d "${APP_DIR}/storage" && ! -L "${APP_DIR}/storage" ]]; then
  rsync -a "${APP_DIR}/storage/" "${DATA_DIR}/storage/"
  rm -rf "${APP_DIR}/storage"
fi
ln -sfn "${DATA_DIR}/storage" "${APP_DIR}/storage"

# Gallery media now lives under the same persistent storage tree, at
# ${DATA_DIR}/storage/media/<category>. Migrate the two older layouts if present.
if [[ -d "${DATA_DIR}/gallery" && ! -L "${DATA_DIR}/gallery" ]]; then
  echo "==> Migrating ${DATA_DIR}/gallery to ${DATA_DIR}/storage/media"
  rsync -a "${DATA_DIR}/gallery/" "${DATA_DIR}/storage/media/"
  mv "${DATA_DIR}/gallery" "${DATA_DIR}/gallery.migrated"
fi

if [[ -d "${APP_DIR}/src/assets/gallery" && ! -L "${APP_DIR}/src/assets/gallery" ]]; then
  rsync -a "${APP_DIR}/src/assets/gallery/" "${DATA_DIR}/storage/media/"
  rm -rf "${APP_DIR}/src/assets/gallery"
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_ROOT}"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "==> Creating .env from shared template"
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
fi

sed -i "s|https://yourdomain.com|https://${DOMAIN}|g" "${APP_DIR}/.env"
sed -i "s|no-reply@yourdomain.com|no-reply@${DOMAIN}|g" "${APP_DIR}/.env"

echo "==> Starting API with PM2"
su - "${APP_USER}" -c "cd '${APP_DIR}' && pm2 start scripts/deploy/ecosystem.config.cjs --env production"
su - "${APP_USER}" -c "pm2 save"

pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" >/tmp/pm2-startup.txt
if grep -q "sudo" /tmp/pm2-startup.txt; then
  bash -lc "$(grep sudo /tmp/pm2-startup.txt | tail -n1 | sed 's/^.*sudo/sudo/')"
fi
rm -f /tmp/pm2-startup.txt

echo "==> Configuring Nginx"
# Resolves the visitor's real IP for rate limiting. `map` is only valid in the
# http context, so it cannot live in the site config.
install -D -m 644 "${APP_DIR}/scripts/deploy/nginx-realip.conf" \
        /etc/nginx/conf.d/fairview-realip.conf
# The site config includes this snippet at server level and inside every
# location that sets its own add_header, so it must exist before nginx -t runs.
install -D -m 644 "${APP_DIR}/scripts/deploy/nginx-security-headers.conf" \
        /etc/nginx/snippets/fairview-security.conf
cp "${APP_DIR}/scripts/deploy/nginx.fairview.conf" "/etc/nginx/sites-available/fairview"
sed -i "s|__DOMAIN__|${DOMAIN}|g" /etc/nginx/sites-available/fairview
sed -i "s|__APP_DIST__|${APP_DIR}/dist/fairview-event-center/browser|g" /etc/nginx/sites-available/fairview
sed -i "s|__UPLOADS_DIR__|${DATA_DIR}/storage/uploads|g" /etc/nginx/sites-available/fairview
sed -i "s|__GALLERY_DIR__|${DATA_DIR}/storage/media|g" /etc/nginx/sites-available/fairview

# Serve gallery media from R2 when a public CDN base URL is configured, else
# from local disk. Reading MEDIA_CDN_URL straight out of the app's .env keeps
# nginx and the API in agreement about where media lives.
MEDIA_CDN_URL="$(grep -E '^MEDIA_CDN_URL=' "${APP_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' | sed 's|/*$||')"
if [[ -n "${MEDIA_CDN_URL}" && "${MEDIA_CDN_URL}" != *".r2.cloudflarestorage.com"* ]]; then
  echo "==> Gallery media will be redirected to ${MEDIA_CDN_URL}"
  GALLERY_BODY="return 302 ${MEDIA_CDN_URL}\$request_uri;"
else
  echo "==> Gallery media will be served from ${DATA_DIR}/storage/media"
  GALLERY_BODY='alias '"${DATA_DIR}"'/storage/media/; autoindex off; expires 7d; add_header Cache-Control "public"; include snippets/fairview-security.conf;'
fi
sed -i "s|__GALLERY_LOCATION_BODY__|${GALLERY_BODY}|g" /etc/nginx/sites-available/fairview

ln -sfn /etc/nginx/sites-available/fairview /etc/nginx/sites-enabled/fairview
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Enabling UFW + fail2ban"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF

systemctl enable fail2ban
systemctl restart fail2ban

echo "==> Requesting TLS certificate"
certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" --non-interactive --agree-tos -m "${CERT_EMAIL}" --redirect || true

echo "Done."
echo "Next: edit ${APP_DIR}/.env with real secrets, then run:"
echo "  su - ${APP_USER} -c 'cd ${APP_DIR} && pm2 restart fairviewApi'"
