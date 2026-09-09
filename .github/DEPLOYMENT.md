# Production deployment

The Angular site and the Express API run together on one Ubuntu server
(`utctigers@192.168.4.55`): Nginx serves the built app and proxies `/api/` to the
PM2-managed Express process on port 3000.

## Why a self-hosted runner

The server is on a **private LAN**. `192.168.4.55` is not routable from the
internet, so GitHub's hosted runners cannot reach it — no SSH key, secret or
firewall rule changes that, because there is no path to the address at all.

A self-hosted runner installed on the server solves it by reversing the
direction: the runner dials **out** to GitHub and waits for work. That means:

- no inbound firewall rule or port forwarding
- no SSH private key stored in GitHub
- no secrets to rotate

The runner executes `scripts/deploy/deploy.sh` against the live app directory,
which is exactly what the manual path runs, so CI and hand-deploys cannot drift.

## One-time setup

On the server, as `utctigers` (**not** root):

```bash
# 1. Bootstrap the box, if it has not been done yet.
sudo bash scripts/deploy/bootstrap-vps.sh fairview-event-center.com <repo-url> you@example.com

# 2. Fill in real secrets.
nano /var/www/fairview/app/.env

# 3. Install the CI runner. Get the token from
#    Settings -> Actions -> Runners -> New self-hosted runner (it expires in ~1 hour).
cd /var/www/fairview/app
bash scripts/deploy/setup-runner.sh <repo-url> <registration-token>
```

`setup-runner.sh` resolves the current runner release rather than pinning a
version, installs it as a systemd service so it survives reboots, and grants
passwordless sudo for **only** `systemctl reload nginx` — not blanket sudo.

## Deploying

- **Automatic:** every push to `master`.
- **Manual:** the *Deploy production* workflow, via *Run workflow*.
- **From a LAN workstation:** `npm run deploy` (see below).

Each deploy pulls, runs `npm ci`, rebuilds the frontend, reloads PM2, reloads
Nginx, then **verifies the API actually answers** before reporting success. A
deploy that leaves the API down fails the job and prints the last 40 lines of
`pm2 logs` rather than passing quietly.

`concurrency: production-deploy` with `cancel-in-progress: false` means two
pushes in quick succession queue rather than overlapping mid-`npm ci`.

## Deploying from this workstation

The dev machine is on the same subnet, so it can deploy directly — useful before
the runner is installed, and as a fallback when CI is down:

```bash
npm run deploy
```

It needs key-based SSH once:

```bash
ssh-keygen -t ed25519 -C "deploy to fairview"     # if you have no key yet
ssh-copy-id utctigers@192.168.4.55
```

On Windows, without `ssh-copy-id`:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh utctigers@192.168.4.55 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

This deploys whatever is on the server's tracked branch — `deploy.sh` does a
`git pull`, so push your commits first.

## Repository variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEPLOY_APP_DIR` | `/var/www/fairview/app` | Where the app is checked out on the server |

No repository **secrets** are needed. The build runs on the server, where the R2
credentials already live in `.env`, so they never enter CI.

## Serving the site publicly

A LAN address cannot serve `fairview-event-center.com` on its own. Reaching it from the
internet needs one of:

- **Cloudflare Tunnel** (`cloudflared`) — outbound only, no port forwarding, and
  it fits the existing Cloudflare setup. Recommended.
- **Port forwarding** on the router plus a static IP or dynamic DNS — exposes the
  box directly and needs TLS handled locally.

The deploy pipeline is independent of this choice; it works today for a
LAN-only server.

## Server prerequisites

Repository checked out at `DEPLOY_APP_DIR`, Node.js, PM2 running `fairviewApi`,
Nginx configured from `scripts/deploy/nginx.fairview.conf`, and a Git remote the
app user can pull from. The production `.env` stays on the server and is never
deployed; it holds `CLIENT_ORIGIN`, the `R2_*` credentials and the rest of the
production configuration.

`API_BASE_URL` must stay unset: site and API share one origin, so the browser
calls `/api` relatively.
