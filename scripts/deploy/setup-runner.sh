#!/usr/bin/env bash
set -euo pipefail

# Install the GitHub Actions self-hosted runner on this Ubuntu server.
#
# Run ON THE SERVER, as the app user (utctigers), NOT as root:
#
#   bash scripts/deploy/setup-runner.sh <repo-url> <registration-token>
#
# Get the registration token from:
#   GitHub repo -> Settings -> Actions -> Runners -> New self-hosted runner
# It expires after about an hour, so fetch it immediately before running this.
#
# Why a self-hosted runner rather than SSH from a GitHub-hosted runner:
# this server is on a private LAN, so GitHub's cloud runners cannot reach it at
# all. The runner here dials OUT to GitHub and waits for work, which needs no
# inbound firewall rule, no port forwarding, and no SSH key stored in GitHub.

REPO_URL="${1:-}"
REG_TOKEN="${2:-}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_NAME="${RUNNER_NAME:-$(hostname)-fairview}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,fairview}"
APP_DIR="${APP_DIR:-/var/www/fairview/app}"

if [[ -z "${REPO_URL}" || -z "${REG_TOKEN}" ]]; then
  echo "Usage: bash $0 <repo-url> <registration-token>"
  echo "Example: bash $0 https://github.com/you/fairviewEventCenter.git ABCDEF..."
  exit 1
fi

if [[ "${EUID}" -eq 0 ]]; then
  echo "Do not run this as root. The runner must run as the app user that owns"
  echo "${APP_DIR} and the pm2 process (for example: utctigers)."
  exit 1
fi

# The runner clones nothing itself -- it only executes deploy.sh against the
# live app directory, so that directory has to exist and be owned by this user.
if [[ ! -d "${APP_DIR}" ]]; then
  echo "App directory not found: ${APP_DIR}"
  echo "Run scripts/deploy/bootstrap-vps.sh first."
  exit 1
fi
if [[ ! -O "${APP_DIR}" ]]; then
  echo "Warning: ${APP_DIR} is not owned by $(whoami). The deploy will likely fail on git pull."
fi

echo "==> Installing prerequisites"
sudo apt-get update -qq
sudo apt-get install --yes --no-install-recommends curl tar jq >/dev/null

echo "==> Resolving the latest runner release"
LATEST="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name)"
VERSION="${LATEST#v}"
if [[ -z "${VERSION}" || "${VERSION}" == "null" ]]; then
  echo "Could not determine the latest runner version."
  exit 1
fi
echo "    runner ${VERSION}"

ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64) RUNNER_ARCH="x64" ;;
  aarch64|arm64) RUNNER_ARCH="arm64" ;;
  *) echo "Unsupported architecture: ${ARCH}"; exit 1 ;;
esac

mkdir -p "${RUNNER_DIR}"
cd "${RUNNER_DIR}"

TARBALL="actions-runner-linux-${RUNNER_ARCH}-${VERSION}.tar.gz"
if [[ ! -f "${TARBALL}" ]]; then
  echo "==> Downloading ${TARBALL}"
  curl -fsSL -o "${TARBALL}" \
    "https://github.com/actions/runner/releases/download/v${VERSION}/${TARBALL}"
fi

if [[ ! -f "./config.sh" ]]; then
  echo "==> Unpacking"
  tar xzf "${TARBALL}"
fi

# Re-registering over an existing runner fails, so clear any previous config.
if [[ -f ".runner" ]]; then
  echo "==> Removing the previous runner registration"
  sudo ./svc.sh stop 2>/dev/null || true
  sudo ./svc.sh uninstall 2>/dev/null || true
  ./config.sh remove --token "${REG_TOKEN}" || true
fi

echo "==> Registering with GitHub"
./config.sh \
  --unattended \
  --replace \
  --url "${REPO_URL%.git}" \
  --token "${REG_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS}" \
  --work "_work"

echo "==> Installing the runner as a service"
sudo ./svc.sh install "$(whoami)"
sudo ./svc.sh start

# deploy.sh reloads Nginx. Grant exactly that one command without a password,
# rather than giving the runner blanket sudo.
SUDOERS_FILE="/etc/sudoers.d/fairview-deploy"
echo "==> Allowing passwordless 'systemctl reload nginx' for $(whoami)"
echo "$(whoami) ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx, /bin/systemctl reload nginx" \
  | sudo tee "${SUDOERS_FILE}" >/dev/null
sudo chmod 0440 "${SUDOERS_FILE}"
sudo visudo -cf "${SUDOERS_FILE}"

echo
echo "Runner installed."
sudo ./svc.sh status || true
echo
echo "It should now appear under Settings -> Actions -> Runners as: ${RUNNER_NAME}"
echo "Labels: ${RUNNER_LABELS}"
echo
echo "Push to master, or run the 'Deploy production' workflow manually, to deploy."
