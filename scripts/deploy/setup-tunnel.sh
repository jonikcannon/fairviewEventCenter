#!/usr/bin/env bash
set -euo pipefail

# Create a remotely-managed Cloudflare Tunnel for this app and point the
# domain at it. Replaces the LAN-only / quick-tunnel access path.
#
# Run ON the server:
#   CF_API_TOKEN="$(cat ~/.cf-token)" bash scripts/deploy/setup-tunnel.sh
#
# The API token needs, per Cloudflare's tunnel-permissions docs:
#   Account : Cloudflare Tunnel : Edit   (create the tunnel + its config)
#   Zone    : DNS               : Edit   (the docs list DNS as the extra
#                                         permission needed to route traffic
#                                         to a public hostname)
#   Zone    : Zone              : Read   (look the zone up by name)
# Scope it to fairview-event-center.com alone, not "All zones".
#
# Idempotent: re-running reuses an existing tunnel of the same name and
# updates records in place rather than duplicating them.

DOMAIN="${DOMAIN:-fairview-event-center.com}"
TUNNEL_NAME="${TUNNEL_NAME:-fairview-prod}"
ORIGIN_URL="${ORIGIN_URL:-http://localhost:80}"
APP_DIR="${APP_DIR:-/var/www/fairview/app}"
API="https://api.cloudflare.com/client/v4"

# Default the token from ~/.cf-token (mode 600) so it never has to be passed on
# a command line, where it would land in shell history. [:space:] rather than an
# escaped \r\n so a CRLF-written file is handled without quoting hazards.
if [[ -z "${CF_API_TOKEN:-}" && -r "${HOME}/.cf-token" ]]; then
  CF_API_TOKEN="$(tr -d '[:space:]' < "${HOME}/.cf-token")"
fi
: "${CF_API_TOKEN:?Set CF_API_TOKEN (e.g. CF_API_TOKEN=\"\$(cat ~/.cf-token)\")}"

cf() {
  curl -sS -H "Authorization: Bearer ${CF_API_TOKEN}" \
          -H "Content-Type: application/json" "$@"
}

# Cloudflare returns HTTP 200 with {"success":false} on logical failures, so
# every call has to be checked on the body, not the status code.
check() {
  local body="$1" what="$2"
  if [[ "$(jq -r '.success' <<<"${body}")" != "true" ]]; then
    echo "FAILED: ${what}" >&2
    jq -r '.errors[]? | "  [\(.code)] \(.message)"' <<<"${body}" >&2
    exit 1
  fi
}

echo "==> Verifying API token"
BODY="$(cf "${API}/user/tokens/verify")"
check "${BODY}" "token verification"
echo "    token is $(jq -r '.result.status' <<<"${BODY}")"

echo "==> Resolving account ID"
# The R2 account ID already in .env is the Cloudflare account ID, which saves
# needing an Account:Read scope on the token just to discover it.
ACCOUNT_ID="$(grep -m1 '^R2_ACCOUNT_ID=' "${APP_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' \r' || true)"
if [[ -z "${ACCOUNT_ID}" ]]; then
  BODY="$(cf "${API}/accounts?per_page=50")"
  check "${BODY}" "listing accounts"
  ACCOUNT_ID="$(jq -r '.result[0].id' <<<"${BODY}")"
fi
echo "    account ${ACCOUNT_ID:0:8}…"

echo "==> Resolving zone for ${DOMAIN}"
BODY="$(cf "${API}/zones?name=${DOMAIN}")"
check "${BODY}" "zone lookup"
ZONE_ID="$(jq -r '.result[0].id // empty' <<<"${BODY}")"
if [[ -z "${ZONE_ID}" ]]; then
  echo "FAILED: ${DOMAIN} is not a zone in this account." >&2
  echo "Register it (or add the site) in the Cloudflare dashboard first." >&2
  exit 1
fi
echo "    zone ${ZONE_ID:0:8}… ($(jq -r '.result[0].status' <<<"${BODY}"))"

echo "==> Finding or creating tunnel '${TUNNEL_NAME}'"
BODY="$(cf "${API}/accounts/${ACCOUNT_ID}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false")"
check "${BODY}" "listing tunnels"
TUNNEL_ID="$(jq -r '.result[0].id // empty' <<<"${BODY}")"

if [[ -n "${TUNNEL_ID}" ]]; then
  echo "    reusing existing tunnel ${TUNNEL_ID}"
else
  # config_src:"cloudflare" makes this a remotely-managed tunnel, which the
  # Cloudflare One guidance prefers for new deployments. tunnel_secret is not
  # required on create -- the connector authenticates with the run token below.
  BODY="$(cf -X POST "${API}/accounts/${ACCOUNT_ID}/cfd_tunnel" \
    --data "$(jq -n --arg n "${TUNNEL_NAME}" \
              '{name:$n, config_src:"cloudflare"}')")"
  check "${BODY}" "creating tunnel"
  TUNNEL_ID="$(jq -r '.result.id' <<<"${BODY}")"
  echo "    created tunnel ${TUNNEL_ID}"
fi

echo "==> Publishing ingress config"
# config_src:"cloudflare" above means routing lives in the dashboard/API, not
# in a local config.yml -- so the connector needs no on-disk config at all.
INGRESS="$(jq -n --arg d "${DOMAIN}" --arg u "${ORIGIN_URL}" '{
  config: {
    ingress: [
      { hostname: $d,            service: $u, originRequest: {} },
      { hostname: ("www." + $d), service: $u, originRequest: {} },
      { service: "http_status:404" }
    ]
  }
}')"
BODY="$(cf -X PUT "${API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" --data "${INGRESS}")"
check "${BODY}" "publishing ingress config"
echo "    ${DOMAIN} and www -> ${ORIGIN_URL}"

echo "==> Pointing DNS at the tunnel"
CNAME_TARGET="${TUNNEL_ID}.cfargotunnel.com"
for NAME in "${DOMAIN}" "www.${DOMAIN}"; do
  REC="$(jq -n --arg n "${NAME}" --arg c "${CNAME_TARGET}" \
        '{type:"CNAME", name:$n, content:$c, proxied:true, ttl:1}')"
  EXISTING="$(cf "${API}/zones/${ZONE_ID}/dns_records?name=${NAME}")"
  check "${EXISTING}" "listing DNS records for ${NAME}"
  REC_ID="$(jq -r '.result[0].id // empty' <<<"${EXISTING}")"
  if [[ -n "${REC_ID}" ]]; then
    BODY="$(cf -X PUT "${API}/zones/${ZONE_ID}/dns_records/${REC_ID}" --data "${REC}")"
    check "${BODY}" "updating record ${NAME}"
    echo "    updated  ${NAME}"
  else
    BODY="$(cf -X POST "${API}/zones/${ZONE_ID}/dns_records" --data "${REC}")"
    check "${BODY}" "creating record ${NAME}"
    echo "    created  ${NAME}"
  fi
done

echo "==> Installing the connector as a system service"
BODY="$(cf "${API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/token")"
check "${BODY}" "fetching connector token"
RUN_TOKEN="$(jq -r '.result' <<<"${BODY}")"

# A previous install has to go before another can be laid down.
sudo cloudflared service uninstall >/dev/null 2>&1 || true
sudo cloudflared service install "${RUN_TOKEN}"
sudo systemctl enable --now cloudflared
unset RUN_TOKEN

echo "==> Retiring the temporary quick tunnel"
sudo systemctl stop cf-quick 2>/dev/null || true
sudo systemctl reset-failed cf-quick 2>/dev/null || true

echo "==> Updating nginx server_name"
NGINX_CONF=/etc/nginx/sites-available/fairview
sudo cp "${NGINX_CONF}" "${NGINX_CONF}.bak.$(date +%s)"
sudo sed -i -E "s/^([[:space:]]*server_name[[:space:]]+).*/\1${DOMAIN} www.${DOMAIN};/" "${NGINX_CONF}"
if sudo nginx -t >/dev/null 2>&1; then
  sudo systemctl reload nginx
  echo "    server_name -> ${DOMAIN} www.${DOMAIN}"
else
  echo "    nginx rejected the change; rolling back" >&2
  sudo cp "$(ls -t ${NGINX_CONF}.bak.* | head -1)" "${NGINX_CONF}"
  sudo nginx -t
fi

echo "==> Aligning CLIENT_ORIGIN with the public URL"
# Only matters if a cross-origin request is ever made; the app calls /api
# relatively, so this is correctness hygiene rather than a live dependency.
if grep -q '^CLIENT_ORIGIN=' "${APP_DIR}/.env" 2>/dev/null; then
  sudo sed -i -E "s#^CLIENT_ORIGIN=.*#CLIENT_ORIGIN=https://${DOMAIN}#" "${APP_DIR}/.env"
  pm2 restart fairviewApi --update-env >/dev/null 2>&1 || true
  echo "    CLIENT_ORIGIN -> https://${DOMAIN}"
fi

cat <<EOF

Done. Tunnel ${TUNNEL_NAME} (${TUNNEL_ID}) is serving:

  https://${DOMAIN}
  https://www.${DOMAIN}

  systemctl status cloudflared     # connector health
  journalctl -u cloudflared -f     # live logs

DNS may take a minute to propagate on a freshly registered domain.
EOF
