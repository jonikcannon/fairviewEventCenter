# Moving the site onto your own machine

This is the runbook for moving Fairview Event Center onto a new machine you
(the client) own and host — a box at your own location, on your own network.
**This is a machine swap, not a new project setup:** the domain, the
Cloudflare account (DNS + the R2 media bucket), Stripe, Google Sign-In, and
email are all already set up for this project and stay **exactly as they
are** — nothing about them changes. The only thing moving is which physical
computer actually runs the app. There's no existing production data (real
bookings, inquiries) to carry over, so there's no downtime window to plan
around either — this can go at whatever pace is convenient.

Because everything account-side is unchanged, you generally will **not** be
creating anything new in Cloudflare/Stripe/Google — you're reusing what
already exists. [CLIENT_SETUP.md](CLIENT_SETUP.md) is the reference for what
those accounts are and why, in case anything below is unfamiliar, but you
shouldn't need to work through it top to bottom.

## Who does what

| | Does what |
| --- | --- |
| **You / your IT** | Provide and physically maintain the machine. Run the setup commands in this guide (with Jonik on a call/chat if useful). Keep it powered on and connected to the internet. |
| **Jonik** | Provides the GitHub repository access and a couple of one-time tokens. Available to walk through any step live. After setup, pushes code changes — the site updates itself, nothing further needed from you. |

Nothing here requires giving Jonik permanent remote access to your machine.
Once Phase 5 below is done, updates arrive automatically over an *outbound*
connection your machine makes to GitHub — nobody needs to log into your
network from outside.

## Before you start: what the machine needs

- **Ubuntu 22.04 or 24.04 LTS**, freshly installed or already on hand. Server
  edition (no desktop GUI) is fine and normal.
- **Always on, wired ethernet.** This machine *is* the site — if it's off, or
  a laptop that gets closed and put to sleep, or on flaky Wi-Fi, the site is
  down. Treat it like a small appliance, not a workstation. A UPS (battery
  backup) is worth it if your power isn't rock solid.
- **Modest hardware is enough.** This is a fairly light Node.js app; photo/
  video storage already lives in Cloudflare R2, not on this box, so it
  doesn't need much local disk.
- **A regular user account with `sudo`**, not just `root`. The setup scripts
  specifically refuse to run as root for anything but the one-time bootstrap
  step, and everything afterward (PM2, the app itself, future deploys) runs
  as this ordinary user.
- **No port forwarding, no static public IP, nothing opened on your router.**
  Because your machine has no public address, reaching it from the internet
  uses a Cloudflare Tunnel instead (Phase 4) — it only ever makes *outbound*
  connections, so there's nothing to expose. The one thing to check with
  whoever manages your network/firewall: outbound HTTPS (port 443) must be
  allowed, which is almost always the default on any network.

## Phase 1 — Gather what already exists

Nothing here is created fresh — it's collected from wherever it currently
lives (the current machine, a password manager, or Jonik) and carried over
as-is:

1. **The current `.env` file.** This is the single most important thing to
   bring over — it holds the R2 credentials, Stripe keys, JWT secret, admin
   password hash, SMTP settings, and everything else, already correct for
   this project. Get a copy of it (e.g. from the machine currently running
   the site, or from Jonik) before starting Phase 3 — the new machine reuses
   these values rather than regenerating them. **Treat this file itself as a
   secret** — send it over a private channel, not pasted into chat/email in
   the clear.
2. **A Cloudflare API token scoped for the Tunnel step** (Phase 4). If one
   was used to set up the tunnel originally, it may still exist and be
   reusable — check **Cloudflare dashboard → My Profile → API Tokens**. If
   it's gone or you're not sure, create a new one the same way (**Create
   Token → Custom Token**), scoped to:
   - `Account : Cloudflare Tunnel : Edit`
   - `Zone : DNS : Edit`
   - `Zone : Zone : Read`
   - Scoped to the project's domain specifically, not "All zones."

   This is a fresh token even though the tunnel itself isn't new — it's only
   used once, locally, to run `setup-tunnel.sh` from the new machine, and
   doesn't need to be kept afterward.
3. **The GitHub repository URL** — same repo as always; ask Jonik if you
   don't already have it.

You do **not** need to touch Cloudflare's dashboard for DNS, the R2 bucket,
Stripe, or Google Sign-In at all — none of that changes. If for some reason
any of it needs to be recreated from scratch, [CLIENT_SETUP.md](CLIENT_SETUP.md)
is the full reference.

## Phase 2 — Get onto the machine

Everything from here runs **on the machine itself** — either at its own
keyboard/screen, or over SSH from another computer on the same network
(`ssh your-username@the-machines-local-ip`). Find its local IP with:

```bash
hostname -I
```

Worth writing down. It's also worth asking whoever manages your router to
give this machine a **fixed/reserved local IP** (a "DHCP reservation"), so it
doesn't change after a reboot — nothing below strictly depends on it staying
the same, but it makes troubleshooting and any future manual access simpler.

## Phase 3 — Install the app

Get the repository URL from Jonik (`https://github.com/<org>/fairviewEventCenter.git`
or similar), then, **as your sudo user**:

```bash
git clone <repo-url> ~/fairview-src
sudo bash ~/fairview-src/scripts/deploy/bootstrap-vps.sh your-domain.com <repo-url> you@your-domain.com
```

This one script installs Node.js, Nginx, PM2, and everything else needed;
checks out the app to `/var/www/fairview/app`; builds it; and starts it. It
takes a few minutes. **Two things in the output are expected, not errors:**

- **The TLS certificate request at the end will fail.** It tries to get a
  certificate from Let's Encrypt, which needs to reach your machine directly
  over the public internet — impossible for a machine with no public
  address. That's fine: Phase 4 below handles TLS a different way (Cloudflare
  issues and manages the certificate instead). The script already expects
  this and keeps going.
- The site is **not reachable from the internet yet** after this step —
  only Phase 4 makes that happen. You can, if curious, check it's running
  locally with `curl http://127.0.0.1/` on the machine itself, which should
  return HTML.

Now put the real `.env` in place — this is Phase 1's most important item.
The bootstrap step above already created a blank starter `.env` from
`.env.example`; replace it entirely with the existing project's real one
(copy it over by USB drive, `scp`, or paste it into `nano` — whatever's
easiest given how you received it in Phase 1):

```bash
nano /var/www/fairview/app/.env
```

**Reuse the existing values as-is — don't regenerate `JWT_SECRET`,
`ADMIN_PASSWORD_HASH`, `STRIPE_SECRET_KEY`, the R2 credentials, or anything
else already set.** They're all tied to this project's existing accounts
(and, for `JWT_SECRET`/`ADMIN_PASSWORD_HASH`, to the admin login you already
use), not to any one machine — there's no reason to change them just because
the app is now running somewhere else, and regenerating `JWT_SECRET` in
particular would only invalidate the admin session model for no benefit.

Double-check permissions after copying it in, since it holds real secrets:

```bash
chmod 600 /var/www/fairview/app/.env
```

Save the file, then restart the app so it picks up the real values:

```bash
pm2 restart fairviewApi
pm2 logs fairviewApi --lines 30 --nostream   # should show no errors
```

## Phase 4 — Make it reachable: Cloudflare Tunnel

This is the step that points `your-domain.com` at *this* machine instead of
the old one, with no port forwarding and no TLS certificate to manage by
hand, by having the machine dial *out* to Cloudflare instead of waiting for
connections in.

`setup-tunnel.sh` is idempotent and name-based (`TUNNEL_NAME` defaults to
`fairview-prod`) — run from the new machine, it finds the **same tunnel**
the old machine was using rather than creating a second one, and simply
issues a fresh connector credential for wherever it's run. You don't need to
know or change the tunnel's DNS records by hand; the script does that too
(and it's a no-op if they're already correct, which they will be — same
domain, same tunnel).

Save the Tunnel token from Phase 1 to the machine (never paste it directly
into a shared terminal/chat):

```bash
nano ~/.cf-token   # paste the token, save
chmod 600 ~/.cf-token
```

Then run:

```bash
cd /var/www/fairview/app
CF_API_TOKEN="$(cat ~/.cf-token)" DOMAIN=your-domain.com bash scripts/deploy/setup-tunnel.sh
```

This finds/creates the tunnel, points the domain's DNS at it, installs the
`cloudflared` connector **on this machine** as a system service (so it
survives reboots), and updates Nginx to match. It's safe to re-run if
something goes wrong partway through.

**If it fails with `is not a zone in this account`:** the API token is
scoped to the wrong zone, or was created before checking the domain's status
— see CLIENT_SETUP.md step 1's note. Since the domain has been Active for a
while already on this project, this is less likely here than on a true fresh
setup, but a newly-created token can still be scoped wrong.

Once it finishes, check `https://your-domain.com` in a browser.

### ⚠️ Cutover: don't run both machines' connectors at once

At this point **both the old and new machine may have a `cloudflared`
connector registered and running for the same tunnel**, each pointing at its
own local copy of the app. Cloudflare can route a given visitor to *either*
one — so until the old one is stopped, the site may unpredictably serve
whichever machine happened to answer, which is confusing to debug and not a
real go-live state.

Once you've confirmed the site works correctly from the new machine (Phase 6
below), stop the tunnel connector on the **old** machine so only the new one
answers:

```bash
# ON THE OLD MACHINE
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
```

Leave the old machine's app itself (PM2/Nginx) running until you're fully
done verifying the new one, in case you need to fail back — there's no rush
to decommission it beyond stopping its tunnel connector.

## Phase 5 — Automatic updates (so Jonik never needs to SSH in)

Right now, getting a code update onto this machine would mean someone
manually pulling and rebuilding on the box itself. This step installs a
small GitHub-provided agent that watches for new code and deploys it
automatically — the sustainable long-term setup, since Jonik's own computer
generally can't reach your private network directly.

1. Ask Jonik for the repository URL (same one as Phase 3).
2. In GitHub: **repo → Settings → Actions → Runners → New self-hosted
   runner.** Copy the registration token shown — **it expires in about an
   hour**, so do the next step right away.
3. On the machine, as your sudo user:

   ```bash
   cd /var/www/fairview/app
   bash scripts/deploy/setup-runner.sh <repo-url> <registration-token>
   ```

4. Back in GitHub, confirm a new runner shows up under Settings → Actions →
   Runners (named after your machine's hostname).

From now on, whenever Jonik pushes a change to the main branch (or runs the
"Deploy production" workflow by hand), your machine picks it up, rebuilds,
and reloads itself within a couple of minutes — no manual step on your end.

### ⚠️ Remove the old machine's runner

The deploy workflow targets *any* runner labeled `self-hosted, linux,
fairview` — if the old machine's runner is still registered alongside the
new one, GitHub can send a deploy job to **either machine at random**, which
would quietly leave the two out of sync (or deploy to a box you're trying to
retire). Once the new runner is confirmed working, remove the old one:
**GitHub repo → Settings → Actions → Runners → (old machine's runner) →
Remove.** If you still have access to the old machine, `sudo
./svc.sh uninstall` inside its `~/actions-runner` directory stops the local
service too, though removing it from GitHub is what actually matters.

## Phase 6 — Go-live checklist

- [ ] `https://your-domain.com` loads over HTTPS with a valid certificate
      (padlock, no warnings)
- [ ] `sudo systemctl status cloudflared` shows **active (running)**
- [ ] `pm2 status` shows `fairviewApi` **online**
- [ ] `pm2 startup` was applied during bootstrap — reboot the machine once
      and confirm the site comes back on its own (`pm2 status` and
      `systemctl status cloudflared` both healthy again after reboot,
      with no manual restart needed)
- [ ] The GitHub Actions runner shows **Idle** (not offline) in
      Settings → Actions → Runners
- [ ] A test push (or the "Deploy production" workflow, run manually)
      completes with a green check, and the site still loads afterward
- [ ] Admin sign-in works with the existing login (email/password, or
      Google) — same credentials as before, nothing to reconfigure
- [ ] A real test booking goes through to Stripe (test mode) and a test
      contact-form submission arrives by email, confirming the carried-over
      `.env` values actually work from the new machine
- [ ] Old machine's `cloudflared` stopped (see Phase 4's cutover note)
- [ ] Old machine's GitHub Actions runner removed (see Phase 5's note)

## Ongoing care and feeding

- **This machine has to stay on and connected.** Unlike a cloud VPS, there's
  no provider keeping it running for you — if it loses power or its network
  connection for an extended stretch, the site is down until it's back. This
  is the real trade-off of self-hosting versus a cloud server; make sure
  whoever's responsible for the space understands that plugging it into the
  wrong power strip is a site-down incident.
- **Back up `/var/www/fairview/data`.** This is where bookings, inquiries,
  site content, and (if not using R2) gallery media actually live — it is
  **not** in git and **not** covered by anything in this repository
  automatically. Nothing here currently automates backups; at minimum,
  periodically copy this directory somewhere else (an external drive, another
  machine, cloud storage). Ask Jonik if you'd like a scheduled backup set up.
- **Checking on it:**
  - `pm2 status` / `pm2 logs fairviewApi` — is the app itself running, any
    errors
  - `systemctl status cloudflared` — is the tunnel connected
  - `systemctl status nginx` — is the web server running
- **Updates happen automatically** (Phase 5) — you shouldn't need to do
  anything for a routine code change. If a deploy ever needs to be re-run by
  hand, that's `bash /var/www/fairview/app/scripts/deploy/deploy.sh` on the
  machine itself.

## Troubleshooting

- **Certbot/TLS error during Phase 3.** Expected — see Phase 3's note. Not a
  problem unless `https://your-domain.com` still doesn't work *after*
  Phase 4 is complete.
- **`setup-tunnel.sh` fails with `is not a zone in this account`.** Your
  domain isn't Active in Cloudflare yet, or the API token predates it going
  Active. Recheck Websites/Overview, and recreate the token if needed.
- **Site works over `http://127.0.0.1/` on the machine but not from
  outside.** Phase 4 hasn't completed successfully, or DNS hasn't propagated
  yet — give it a few minutes, then re-check `systemctl status cloudflared`.
- **A GitHub Actions deploy fails at "Verify the API is serving."** Check
  `pm2 logs fairviewApi --lines 40 --nostream` on the machine — the workflow
  prints this automatically on failure, but it's worth checking directly too.
  A missing or malformed `.env` value is the most common cause.
- **Jonik's own `npm run deploy` (his workstation → your machine)** only
  works if his computer can reach your machine's *local* network address
  directly — it's meant for troubleshooting from on-site or over a VPN, not
  routine use. Don't rely on it day-to-day; Phase 5's automatic runner is the
  real path. If it's ever used against this project, it needs
  `DEPLOY_TARGET` set explicitly to the new machine
  (`scripts/deploy/deploy-remote.sh`'s built-in default still points at the
  old box).
- **The site seems to randomly show stale data, or a booking made on the new
  site doesn't show up in the admin panel.** Classic symptom of both
  machines' `cloudflared` still running — see Phase 4's cutover note. Stop
  the old machine's tunnel connector.
- **A deploy succeeds but the old machine's site is what changed.** The
  GitHub runner picked the old machine for that job — see Phase 5's note on
  removing its runner registration.
