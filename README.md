# Fairview Event Center

Angular 18 + Express site for a community event-space venue: a public
gallery/virtual-tour/booking site backed by an Express API, plus a
content-managed admin panel so routine changes don't require a code edit.

## Features

**Public site**
- Home, About (with priced/unpriced "features," each clickable into a
  full-screen lightbox), Event Center gallery (photos/videos/virtual tour),
  Rate Schedule, Booking, and a Contact panel with FAQ and a map.
- **Booking**: a calendar of open/taken/closed days; picking a day walks
  through package + add-on selection, a Stripe-held reservation fee, and a
  confirmation email. A day with no slot yet can still be "requested," which
  creates it on demand at the same flat rate. See
  [Booking, packages & rental agreements](#booking-packages--rental-agreements).
- **Guest booking lookup**: a customer can look their own booking up (by
  email + the confirmation code from their booking email) without an admin
  login, then view/sign the rental agreement, download an `.ics` calendar
  file, or pay the remaining rental-fee balance online. See
  [Guest booking lookup](#guest-booking-lookup).
- **Waitlist**: picking an already-taken date offers a waitlist signup
  instead of a dead end.
- **Virtual tour**: an embeddable Matterport/YouTube URL, or a self-hosted
  drag-to-pan/zoom panorama viewer with a room picker for more than one room.
  See [Virtual tour](#virtual-tour).
- Every major text block (hero, about, rates, FAQ, navigation labels, etc.)
  can take its own font and size from the admin panel, and the three theme
  colors are admin-editable CSS custom properties -- see
  [Typography and theme](#typography-and-theme).
- Structured data (`schema.org` `EventVenue`) is published from the loaded
  site content for richer search-engine listings (name, description,
  address, phone when set).

**Admin panel** (password or Google sign-in, one bearer token for both)
- **Site content**: identity, hero, statement, about copy + features, rate
  schedule (line items and/or an uploaded PDF/Word document), contact + FAQ,
  virtual tour, theme colors, typography, and navigation visibility -- see
  [Admin site content](#admin-site-content).
- **Venue gallery**: upload/reorder/delete public photos and videos, and
  manage the virtual tour's embed URL or panorama rooms.
- **Inquiries**: search/filter the contact form's submissions and track
  status.
- **Bookings**: a small revenue/bookings-by-month dashboard, manual booking
  entry (phone/cash/walk-in), recurring weekday blocks + one-off unblock
  exceptions, the waitlist, per-booking rental agreements (view, and mark a
  balance paid off-site), and a sample-agreement preview for checking clause
  wording without a real booking. See
  [Admin bookings dashboard](#admin-bookings-dashboard).

## Setup

1. Copy `.env.example` to `.env` and fill in every value. Use the same template for both local and production setup.
2. Run `npm install`.
3. **Gallery media.** With Cloudflare R2 configured (`R2_*` and `MEDIA_CDN_URL` in
   `.env`), a fresh clone needs no local photos at all — the gallery is listed from
   and served by the bucket. Without R2, provision `storage/media/` by hand; the
   photos are not in git, so the gallery renders empty until you copy them in. See
   [Gallery media](#gallery-media) below.
4. Run `npm start` — starts the API and the dev server together.

**The API is always required, even in R2 mode.** The Event Center gallery is
built from the gallery manifest, and the manifest is served by the API at
`/assets/gallery/gallery-manifest.json` — it lives in `storage/media/`, outside
`src/`, so the Angular build never bundles it. Run the dev server on its own and
that fetch fails, leaving the gallery empty. In R2 mode the *media bytes* come
straight from the bucket, but the manifest listing them still comes from the
API. Without R2 the API also serves the media itself at `/assets/gallery/`.

**Note:** this workspace still carries `src/app/products/`, `src/app/cart/`,
and `src/app/services/` (a digital-download shop and services list) from an
earlier iteration of this scaffold. They're unwired — no route in
`app.component.html` renders them and the admin panel has no matching tab —
left over from when this project moved from a photography-commerce shape to
the venue-rental shape described above. Treat them as dead code pending
cleanup, not a live feature.

`npm start` runs both concurrently with tagged `[api]` / `[web]` output, and if
either exits it shuts down the other, so you never end up with a half-running
stack. `npm run strict` is kept as an alias. To run them in separate terminals
instead, use `npm run api` and `npm run start:web`.

## Where media lives

There are two independent media systems. They are easy to confuse, because the API
logs `Media storage: Google Drive mode …` at startup — that line refers only to the
second one.

| | Gallery (public portfolio) | Shop / product media |
|---|---|---|
| Stored in | Cloudflare R2 (`storage/media/<category>/` on disk when R2 is off) | Google Drive |
| Added by | dropping files into a category folder | admin panel upload |
| Served by | Cloudflare R2 + CDN when `MEDIA_CDN_URL` is set, otherwise nginx (prod) / the API (dev) | `/api/media/<token>` proxy, signed JWT |
| In git? | no | no |

The gallery deliberately does **not** use Drive: every view would proxy through Node
with a signed token, with no CDN caching and Drive API quota acting as the gallery's
rate limit.

## Gallery media

Gallery media is organised as one folder per category, the folder name being the
category: `storage/media/<category>/` on disk, mirrored to
`assets/gallery/<category>/` in the R2 bucket. It is never tracked by git and never
bundled by the Angular build.

**Where the gallery listing comes from.** `npm run manifest` writes
`gallery-manifest.json`, the list the gallery renders from. With R2 configured it
builds that list by listing the bucket; otherwise it reads local disk. The bucket
wins because it is the only place guaranteed to be complete — a fresh clone or a
rebuilt VPS has no photos on disk, and listing an empty directory would publish an
empty gallery over a bucket holding the whole library.

Add or recategorise photos by moving files between the local folders, then run
`npm run media:sync` and `npm run manifest`. See
[docs/gallery-media.md](docs/gallery-media.md).

```bash
npm run manifest             # list from the bucket when R2 is on
npm run manifest -- --local  # force the local-disk listing
```

Local files that have not been uploaded yet are reported and left out of the
manifest — the gallery can only show what is actually servable.

### Provisioning on a new machine

With R2 configured, nothing to do: `git clone`, `npm install`, `npm run media`, and
the gallery is complete without a single photo on disk.

Without R2, copy the photos in from wherever your master copy lives, preserving the
category folder names:

```bash
# from the production VPS
rsync -av user@your-vps:/var/www/fairview/data/storage/media/ storage/media/

# or from a local/external backup
robocopy D:\backups\fairview-media storage\media /E    # Windows
rsync -av /path/to/backup/media/ storage/media/      # macOS/Linux
```

Then regenerate the manifest and check the count matches your library:

```bash
npm run media
```

Keep a copy of the library somewhere you control. The bucket is the serving origin,
not a backup — `media:sync --prune` deletes from it, and nothing in this repo can
restore what is gone from both.

### Serving media from Cloudflare R2

Local disk stays the authoring master; R2 is the serving origin. Egress from R2 is
free, so the gallery's bandwidth stops landing on the VPS.

1. Create an R2 bucket and an API token scoped to it. Put the account ID, key,
   secret and bucket name in `.env` (see `.env.example`).
2. Bind a custom domain to the bucket in the Cloudflare dashboard, e.g.
   `media.fairview-event-center.com`. Use a custom domain rather than the `r2.dev` URL, which
   is rate limited and not meant for production.
3. Push the media:

   ```bash
   npm run media:sync -- --dry-run   # preview
   npm run media:sync                # upload
   ```

4. Set `MEDIA_CDN_URL=https://media.fairview-event-center.com` in `.env` and regenerate:

   ```bash
   npm run manifest
   ```

`MEDIA_CDN_URL` is the switch. Unset, everything is listed and served from local
disk exactly as before; set, the manifest is listed from the bucket and emits
absolute CDN URLs. Objects keep the `assets/gallery/<category>/<file>` key prefix,
which is what lets the app's gallery matching work unchanged against absolute URLs.

The browser reaches the bucket by three routes, all driven by that one variable:

- **Manifest entries** are absolute CDN URLs, so gallery thumbnails and the viewer
  load straight from R2.
- **Hard-coded paths** — the hero video, the about portrait, the service tiles — are
  resolved at startup against `assets/media-config.json`, a small file `npm run
  manifest` writes into `src/assets/` and the build copies into `dist/`. This is why
  the 206 MB hero video is fetched from the bucket on the first request rather than
  bouncing off the origin.
- **Anything still requesting `/assets/gallery/…` from the origin** gets a 302 to the
  bucket from the API (dev) or nginx (prod), so no path added later can quietly
  start billing the origin for bandwidth.

Re-run `npm run media:sync` after adding files — it skips anything already uploaded
at the same size, so it is cheap and resumable. Add `--prune` to delete objects that
no longer exist locally. Changing a photo's category in the admin panel moves the
object in R2 as well, and rolls the local move back if the bucket update fails; on a
host with no local copy of the photos the move happens in the bucket alone.

For the initial bulk upload, [rclone](https://rclone.org/s3/#cloudflare-r2) is worth
considering over `media:sync` — it parallelises and resumes better across several GB.

## Watermarking and masters

The public gallery is watermarked; the clean masters a buyer receives live
separately in the bucket under `originals/`.

```
npm run watermark:dry     # report what would change, write nothing
npm run watermark         # preserve masters, then stamp the public copies
```

For every gallery image the script copies the untouched file to
`originals/<category>/<file>` **first**, then overwrites
`assets/gallery/<category>/<file>` with a watermarked copy at full resolution.
Doing it in that order means an interrupted run can never leave a watermarked
file as the only surviving version. Public object keys never change, so the
manifest, product records and cached URLs keep working.

It is idempotent: a stamped object is tagged in its metadata and skipped, so a
re-run resumes rather than double-stamping.

`/api/download/:token` serves the master from `originals/`, falling back to the
gallery copy when no master exists yet — so purchases keep working before, during
and after the migration.

| Variable | Default | Meaning |
| --- | --- | --- |
| `WATERMARK_TEXT` | `FAIRVIEW EVENT CENTER` | The mark itself |
| `WATERMARK_STYLE` | `corner` | `corner` (discreet, bottom right) or `tiled` (repeated diagonally, far harder to crop off) |

Videos are not watermarked. The 29 clips would need a full ffmpeg re-encode of
several GB, which is a separate operation with its own risks.

## Production notes

### Hosting

The site and the API run together on a single Ubuntu server: Nginx serves the
built Angular app from `dist/fairview-event-center` and proxies `/api/` to
`fairviewApi/server.js` (PM2, port 3500). Because both share one origin, the browser
calls `/api` relatively and no CORS configuration is involved. See
[scripts/deploy/README.md](scripts/deploy/README.md) for the bootstrap and deploy
steps, or [CLIENT_MACHINE_SETUP.md](CLIENT_MACHINE_SETUP.md) for the same setup
as one ordered runbook if you're standing this up on a self-hosted machine
rather than a rented VPS.

Only set `API_BASE_URL` if you deliberately split the API onto a different origin
than the site; leaving it unset is correct for the single-server setup above.

Deploys run through GitHub Actions on a self-hosted runner installed on the
server itself, because the box sits on a private LAN that GitHub's hosted
runners cannot reach. `npm run deploy` deploys from any workstation on the same
network. Both paths run the same `scripts/deploy/deploy.sh` and both verify the
API responds before reporting success. See
[.github/DEPLOYMENT.md](.github/DEPLOYMENT.md).

- **Admin:** Authentication happens only on the server. Set `ADMIN_EMAIL`, a bcrypt `ADMIN_PASSWORD_HASH`, and a long random `JWT_SECRET`.
- **Contact email delivery:** Configure `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`, and SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`) so contact inquiries are emailed in real time.
- **Google Drive:** Create a Google Cloud service account, enable the Drive API, then share one Drive folder with the service account `client_email`. Put the folder ID and one-line service-account JSON in `.env`. Set `GOOGLE_MEDIA_FOLDER_ID` if private sale-photo delivery should use a separate Drive folder. Never commit these values.
- **Stripe:** Start with Stripe test keys. Configure a webhook for `checkout.session.completed` at `https://your-domain/api/webhooks/stripe`.

## Admin inquiries

- Open the admin modal from the header and switch to the `Inquiries` tab.
- Filter by search text, service, and status.
- Update inquiry status (`New`, `In progress`, `Closed`) directly in the dashboard.

## Admin site content

The admin modal's **Site content** tab edits the public business shell without
requiring a source edit: business identity (including an optional phone
number), hero copy and media, the home statement, About copy and its priced/
unpriced features, the Rate Schedule (line items grouped by an optional
category, plus an optional uploaded PDF/Word document), Contact details and
FAQ, theme colors, per-field typography, and navigation visibility. Content is
persisted in `storage/content/site-content.json`; the API creates it on the
first save and keeps a backup at `site-content.json.bak`.

The public app reads content from `GET /api/content` and falls back to tracked
neutral defaults if the API or runtime file is unavailable. Gallery metadata,
bookings, inquiries, and the rental agreement's own boilerplate legal text
(`fairviewApi/rentalAgreement.js`, deliberately not content-managed) remain
separate domains. Content fields are escaped Angular values; arbitrary HTML
and private filesystem paths are not accepted.

### Typography and theme

`content.theme` holds the three theme colors (`primary`/`background`/`text`)
as CSS custom properties, applied at runtime (`AppComponent.applyTheme`) with
a one-click reset to the stylesheet's own defaults.

`content.textStyles` holds font-family + size overrides per field *kind*
(e.g. every FAQ question shares one override), keyed by dotted ids like
`hero.headline` or `about.featureTitle` (`src/app/text-style.ts`). Fonts are
a small fixed set of web-safe stacks stored as ids, not raw CSS, so a saved
value can never inject arbitrary styling; an unset key falls through to the
stylesheet's own size/font.

## Booking, packages & rental agreements

The booking model is built around the venue's real paper contract, not a
generic percentage deposit (`fairviewApi/booking.js`,
`fairviewApi/rentalAgreement.js`):

- **Packages and add-ons are not their own data model.** A whole-day package
  is any Rate Schedule line item with a category and a flat (non-`/hour`)
  price; an add-on is any About-page feature with a price. Manage those two
  editors and the booking form's options follow automatically.
- **The reservation fee is flat and additive**, not a percentage prepayment:
  it's the one ungrouped Rate Schedule line item, paid up front online and
  non-refundable outside the refund window. The full package price
  (`balanceDue`) is always due separately and is never reduced by the
  reservation fee.
- **Holds expire.** A slot is held (not confirmed) for `BOOKING_HOLD_MINUTES`
  while checkout completes; a failed Stripe session releases it immediately
  rather than holding it for the full window.
- **Recurring weekday blocks** (e.g. "closed every Monday") plus **one-off
  unblock exceptions** for specific dates or ranges, managed from the admin
  Bookings tab.
- **The rental agreement** is auto-generated per confirmed booking as
  printable HTML from the booking's own frozen fields (so it stays
  reproducible even if rates change later): `GET /api/admin/bookings/:id/agreement`
  (admin) or `GET /api/bookings/:id/agreement` (the customer's own view,
  gated by confirmation code + email). It can be **signed electronically**
  (typed name, timestamped and IP-logged) from the customer's booking-lookup
  page, and the **rental-fee balance can be paid online by card** from the
  same page (`POST /api/bookings/:id/balance-checkout`) alongside the
  agreement's other accepted methods (cash, cashier's check, money order,
  personal check). An admin can also mark a balance paid off-site.
- **Two scheduled emails**, sent at most once per booking by an hourly
  in-process sweep (no cron dependency; see `runScheduledBookingTasks` in
  `fairviewApi/server.js`): a balance-due reminder
  (`BOOKING_BALANCE_REMINDER_DAYS` before the event) and a post-event review
  request (`BOOKING_REVIEW_REQUEST_DAYS` after).
- Refunds are always issued by hand in the Stripe dashboard; `refundable` is
  advisory only.

## Guest booking lookup

A customer can look up their own booking with the email and confirmation
code from their booking email (`POST /api/bookings/lookup`) -- no account
system exists, so that pair stands in for one. From there they can view or
sign the rental agreement, download a `.ics` file for their calendar
(`GET /api/bookings/:id/calendar.ics`), or pay the remaining balance. Every
one of these actions re-verifies the email + confirmation code server-side
(`requireBookingMatch` in `fairviewApi/server.js`) rather than trusting the
booking id alone.

An admin-only `.ics` feed of every confirmed upcoming booking
(`GET /api/admin/bookings/calendar.ics?token=...`) can be added to
Google/Apple/Outlook as a subscription URL; it's gated by `ADMIN_CALENDAR_TOKEN`
rather than the admin bearer token, since a calendar subscription can't send
an `Authorization` header.

## Virtual tour

The Event Center tab's "Virtual Tour" view resolves in priority order:

1. An **embed URL** (`content.tours.communityCenter`) -- Matterport, YouTube,
   or similar `https://` embed, shown in an iframe.
2. **Self-hosted panorama rooms** (`content.tours.panoramas`) -- shown only
   when no embed URL is set, via `PanoramaViewerComponent`
   (`src/app/panorama/`): a drag-to-pan, scroll/pinch-to-zoom viewer for a
   wide "panorama mode" photo per room, with a room-picker strip when there's
   more than one. It assumes roughly 90° horizontal field of view (a phone's
   panorama-mode capture), not a true 360° sphere -- don't feed it an
   equirectangular photo expecting correct wraparound.

## Admin bookings dashboard

The Bookings tab opens with a small dashboard (`GET /api/admin/bookings/stats`):
confirmed/upcoming booking counts, revenue collected, outstanding balance,
and a monthly bookings bar chart over the trailing 12 months -- plain CSS,
no charting dependency.

## Runtime data

The API persists products to `storage/products/products.json` and inquiries to
`storage/inquiries/`, both untracked and per-environment. On the VPS these live under
`/var/www/fairview/data/storage/`, so deploys never overwrite them. Products survive a
restart, but a JSON file is not a substitute for a real database once orders matter —
move to one before the catalog or order volume grows.
