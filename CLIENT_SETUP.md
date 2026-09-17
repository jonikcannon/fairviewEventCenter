# Client setup guide

This is a checklist of the accounts and credentials a new client needs to create
before this site can be deployed and taken live. Each section says what to sign up
for, exactly what to copy out of that dashboard, and where it goes.

Everything you collect ends up in one file: `.env` on the server (copied from
`.env.example`). Nothing here needs to be shared with anyone except whoever is
deploying the site for you.

## What you'll end up with

| # | Account | Used for |
| --- | --- | --- |
| 1 | A domain name | Your site's address |
| 2 | Cloudflare | DNS, photo/video storage + delivery (R2), and (optionally) exposing the server without opening ports |
| 3 | A server (VPS) | Runs the site and the booking/admin API around the clock |
| 4 | Stripe | Booking deposits and any online print/photo purchases |
| 5 | Google Cloud (OAuth) | "Sign in with Google" for the admin panel |
| 6 | An email account/provider | Contact-form and booking confirmation emails |
| 7 | GitHub | Holds the code and runs automatic deploys |
| 8 | Google Cloud (Drive), optional | Only if you sell/deliver digital prints |

Go through them roughly in this order — Cloudflare and the server come before
Stripe/Google because their values (your domain, your R2 bucket) feed into the
webhook and OAuth setup later.

---

## 1. Domain name

Register one wherever you like. Which path you take changes what step 2a
below actually involves:

- **Cloudflare Registrar** (Dashboard → Domain Registration → Register a
  domain): the domain lands as an active Cloudflare zone immediately as part
  of buying it — there is no separate "add a site" step, and nothing to wait on.
- **Any other registrar** (Namecheap, GoDaddy, etc.): buying the domain does
  **not** make it a Cloudflare zone by itself. You still have to do step 2a
  (Dashboard → Add a site) and then update the nameservers at whichever
  registrar you bought it from to the two Cloudflare gives you. The zone sits
  in **Pending Nameserver Update** until Cloudflare detects that change, which
  can take anywhere from a few minutes to a few hours.

Either way, **check Dashboard → Websites/Overview and confirm the domain
shows status "Active"** before moving on — `scripts/deploy/setup-tunnel.sh`
(step 2c) and anything else that looks the domain up as a zone will fail with
"is not a zone in this account" until it does, even though the domain is
already registered and paid for.

It's referenced throughout the rest of this guide as `your-domain.com`.

> **API tokens and zone timing:** if you create a Cloudflare API token scoped
> to "Specific zone" (used in step 2c for the Tunnel) *before* the domain
> shows Active, the zone picker has nothing to offer it — the token ends up
> scoped to nothing for that domain, and every call fails as if the zone
> doesn't exist even after it goes Active. Create (or recreate) any
> zone-scoped token only after the domain is Active.

---

## 2. Cloudflare account

Sign up at [cloudflare.com](https://cloudflare.com) (free plan is enough).

### 2a. Add your domain

**Dashboard → Add a site** → enter `your-domain.com` → pick the Free plan →
Cloudflare gives you two nameservers → update them at your domain registrar.
This step alone gets you DNS, and free TLS certificates for anything you point
at Cloudflare later.

### 2b. Create the R2 bucket (photo/video storage)

Every gallery photo and video is served from here, not from the server itself —
Cloudflare's egress from R2 is free, so this keeps hosting cheap even with a
media-heavy gallery.

1. **Dashboard → R2 Object Storage → Create bucket.** Name it something like
   `your-business-media`.
2. **Manage R2 API Tokens → Create API Token.** Scope it to *this bucket only*,
   with **Object Read & Write** permission. Cloudflare shows you three values —
   copy them immediately, the secret is only shown once:
   - Access Key ID → `.env`'s `R2_ACCESS_KEY_ID`
   - Secret Access Key → `.env`'s `R2_SECRET_ACCESS_KEY`
   - Also note your **Account ID** (shown on the R2 overview page, or in the
     dashboard URL) → `.env`'s `R2_ACCOUNT_ID`
   - The bucket name you chose → `.env`'s `R2_BUCKET`
3. **Bucket → Settings → Custom Domains → Connect Domain.** Bind something like
   `media.your-domain.com` to the bucket (this needs your domain already added
   in step 2a). Use a custom domain, **not** the default `*.r2.dev` URL — that
   one is rate-limited and not meant for production traffic.
4. That custom domain → `.env`'s `MEDIA_CDN_URL` (e.g.
   `MEDIA_CDN_URL=https://media.your-domain.com`, no trailing slash).

Once `.env` has all five of those, `npm run media:sync` uploads your photos and
`npm run manifest` builds the gallery listing from the bucket. See the main
[README.md](README.md#gallery-media) for the day-to-day media workflow.

### 2c. Reaching the server (only if it has no public IP)

If your server is a plain cloud VPS with a public IP address, skip this — just
point a DNS **A record** at it in the Cloudflare dashboard (step 2a's DNS tab)
and turn on the orange "Proxied" cloud icon for automatic TLS.

If instead you're running a **local VPS** — a machine on your own home/office
network acting as the server, behind a router, with no public IP (this is the
setup this project actually uses: an on-prem box on the LAN, not a rented
cloud VPS) — use a **Cloudflare Tunnel** instead: it dials out from the server
to Cloudflare, so nothing needs to be exposed inbound and no ports need to be
forwarded on the router. `scripts/deploy/setup-tunnel.sh` in this repo
automates creating one — see the comment at the top of that file for the
exact API token permissions it needs.

> If the script fails with `is not a zone in this account`, this is almost
> always the domain/token timing issue described in step 1, not a real
> problem with the tunnel — go confirm the domain shows **Active** under
> Websites/Overview, and that the API token was created (or recreated) after
> it did.

> **Note on "Cloudflare Pages":** this app is *not* a static site — bookings,
> payments, the admin panel and file uploads all need a real server running
> around the clock, which Pages doesn't provide. Cloudflare's job here is DNS,
> TLS, the R2 media bucket, and (optionally) the Tunnel — the app itself runs
> on the VPS from the next section.

---

## 3. A server (VPS) to host the app

Any small Ubuntu VPS works — DigitalOcean, Linode, Hetzner, Vultr, or similar;
the cheapest tier is plenty to start. You don't need to configure this yourself
if someone else is deploying the site for you, but you do need to **provision
and pay for it**, and hand over SSH access to whoever runs the bootstrap step.

Full setup steps live in [scripts/deploy/README.md](scripts/deploy/README.md)
and [.github/DEPLOYMENT.md](.github/DEPLOYMENT.md) — bootstrapping installs
Nginx, PM2, and Node, and wires up automatic deploys from GitHub.

---

## 4. Stripe account (payments)

Used for booking deposits (Event Center) and, if you ever turn the print shop
back on, checkout for digital/physical prints. No products need to be created
in the Stripe dashboard — the app prices everything itself and only asks
Stripe to run the checkout.

1. Sign up at [stripe.com](https://stripe.com).
2. To go live (accept real payments), Stripe will ask for your business
   details and a bank account to receive payouts — **Settings → Business
   details** and **Settings → Bank accounts and scheduling**. You can build and
   test everything before finishing this.
3. **Developers → API keys → Secret key.** Start with the **test mode** secret
   key while building/testing (toggle "Test mode" in the top right), switch to
   the **live** key only once you're ready to accept real payments.
   → `.env`'s `STRIPE_SECRET_KEY`
4. **Developers → Webhooks → Add endpoint.**
   - Endpoint URL: `https://your-domain.com/api/webhooks/stripe`
   - Events to send: `checkout.session.completed`
   - After creating it, open the endpoint and copy **Signing secret**
     → `.env`'s `STRIPE_WEBHOOK_SECRET`
5. Repeat the webhook step once more for **live mode** when you switch the
   secret key over — test-mode and live-mode webhooks are separate, each with
   their own signing secret.

Without a Stripe key set, the site still runs — booking/checkout just returns
"Stripe is not configured yet" instead of crashing, so this can be filled in
later without blocking anything else.

---

## 5. Google Cloud project (admin "Sign in with Google")

The admin panel offers Google Sign-In alongside a plain email/password login.
This needs its own Google Cloud OAuth client — **do not reuse another
project's client ID**, since it's scoped to specific approved domains.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create
   a new project (top-left project picker → New Project).
2. **APIs & Services → OAuth consent screen.** Choose **External**, fill in an
   app name and support email, and publish it (or leave it in Testing mode and
   add the admin's Google account under **Test users** — fine for a
   single-admin site).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://your-domain.com` (add
     `http://localhost:4500` too if you'll ever run this locally)
   - Save, then copy the **Client ID** (looks like
     `1234567890-abc...apps.googleusercontent.com`).

### Where the Client ID goes

Unlike everything else in this guide, the Google Client ID is **not** read from
`.env` yet — it's hardcoded in two places in the source and has to be edited
directly (and redeployed) whenever a client wants their own:

- [`src/app/app.component.ts`](src/app/app.component.ts) — inside
  `initGoogleSignIn()`, the `client_id:` value
- [`fairviewApi/server.js`](fairviewApi/server.js) — inside the
  `/api/admin/google-login` route, the `clientId:` and `audience:` values (both
  need to match your new Client ID)

Replace the existing ID in all three spots with your new one. If you're not
comfortable editing these yourself, pass this whole section to whoever is
deploying the site — it's a five-minute change.

### The fallback login

Google Sign-In is optional in practice — the admin panel also accepts a plain
email + password, which is simpler to set up and doesn't need any of the above:

- `.env`'s `ADMIN_EMAIL` — the admin's login email
- `.env`'s `ADMIN_PASSWORD_HASH` — a **bcrypt hash** of the password, not the
  password itself. Generate one with:

  ```bash
  node -e "console.log(require('bcryptjs').hashSync('choose-a-strong-password', 12))"
  ```
- `.env`'s `JWT_SECRET` — signs the admin's login session. Generate a random
  one with:

  ```bash
  openssl rand -hex 32
  ```

---

## 6. Email delivery (contact form + confirmations)

Powers the contact form and booking/order confirmation emails. Without this
configured, the site still works — inquiries are just saved without emailing
anyone. Any SMTP provider works; two easy options:

- **A Gmail account with an App Password** — Google Account → Security → 2-Step
  Verification (must be on) → App passwords → generate one for "Mail". Use:
  - `SMTP_HOST=smtp.gmail.com`
  - `SMTP_PORT=587`
  - `SMTP_SECURE=false`
  - `SMTP_USER=` your Gmail address
  - `SMTP_PASS=` the generated app password (not your regular Gmail password)
- **A transactional email service** (Postmark, SendGrid, Mailgun, etc.) — sign
  up, verify your sending domain, and use the SMTP credentials they give you.

Also set:
- `.env`'s `CONTACT_TO_EMAIL` — where contact-form submissions get sent
  (defaults to `ADMIN_EMAIL` if left blank)
- `.env`'s `CONTACT_FROM_EMAIL` — the "from" address on outgoing mail (defaults
  to `SMTP_USER` if left blank)

---

## 7. GitHub repository

The code lives in a GitHub repo, and deploys run through GitHub Actions against
a self-hosted runner installed on your server (see
[.github/DEPLOYMENT.md](.github/DEPLOYMENT.md) for the full picture — this
part is normally set up once by whoever builds the site, not something you
need to configure yourself). You just need to own (or have access to) the
repository if you want to make future changes or hand it to a different
developer later.

---

## 8. Optional: Google Drive (digital print delivery)

Only needed if you turn the digital/print shop back on — it's currently built
into the admin panel but has no public page on the live site, so most clients
can skip this entirely.

If you do need it: **console.cloud.google.com → APIs & Services → enable the
Google Drive API** → **IAM & Admin → Service Accounts → Create service
account** → create a JSON key for it → share a Drive folder with that service
account's email address (looks like `name@project.iam.gserviceaccount.com`,
**Editor** access) → put the folder ID and the JSON key (as a single-line
string) into:

- `.env`'s `GOOGLE_DRIVE_FOLDER_ID`
- `.env`'s `GOOGLE_SERVICE_ACCOUNT_JSON`

---

## 9. Put it all together

On the server:

```bash
cp .env.example .env
nano .env   # fill in everything collected above
```

`.env.example` documents every variable in more depth, including a few
internal ones (hold times, refund windows, watermarking) that don't need an
external account — this guide only covers the ones that do.

---

## Go-live checklist

- [ ] Domain registered and nameservers pointed at Cloudflare
- [ ] R2 bucket created, API token issued, custom media domain bound
- [ ] Server provisioned and bootstrapped (`scripts/deploy/bootstrap-vps.sh`)
- [ ] DNS (A record or Tunnel) reaching the server
- [ ] Stripe account created; test-mode key + webhook working end to end
- [ ] Stripe switched to live mode (business details + bank account, live key,
      live webhook) when ready for real payments
- [ ] Google OAuth Client ID created and swapped into the three code locations
      above, **or** admin email/password login configured as the fallback
- [ ] Email sending configured and a test contact-form submission arrives
- [ ] `.env` fully filled in on the server and the API restarted
      (`pm2 restart fairviewApi`)
