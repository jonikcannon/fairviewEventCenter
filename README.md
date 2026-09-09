# Fairview Event Center

## Setup

1. Copy `.env.example` to `.env` and fill in every value. Use the same template for both local and production setup.
2. Run `npm install`.
3. **Gallery media.** With Cloudflare R2 configured (`R2_*` and `MEDIA_CDN_URL` in
   `.env`), a fresh clone needs no local photos at all — the gallery is listed from
   and served by the bucket. Without R2, provision `storage/media/` by hand; the
   photos are not in git, so the gallery renders empty until you copy them in. See
   [Gallery media](#gallery-media) below.
4. Run `npm start` — starts the API and the dev server together.

**The API is always required, even in R2 mode.** The shop catalogue is built from
the gallery manifest, and the manifest is served by the API at
`/assets/gallery/gallery-manifest.json` — it lives in `storage/media/`, outside
`src/`, so the Angular build never bundles it. Run the dev server on its own and
that fetch fails, leaving the gallery empty and the shop showing "No digital
products are available right now." In R2 mode the *media bytes* come straight from
the bucket, but the manifest listing them still comes from the API. Without R2 the
API also serves the media itself at `/assets/gallery/`.

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
[storage/media/README.md](storage/media/README.md).

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
`fairviewApi/server.js` (PM2, port 3000). Because both share one origin, the browser
calls `/api` relatively and no CORS configuration is involved. See
[scripts/deploy/README.md](scripts/deploy/README.md) for the bootstrap and deploy
steps.

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
requiring a source edit. It currently covers the business name, description,
contact details, hero copy, and navigation visibility. Content is persisted in
`storage/content/site-content.json`; the API creates it on the first save and
keeps a backup at `site-content.json.bak`.

The public app reads content from `GET /api/content` and falls back to tracked
neutral defaults if the API or runtime file is unavailable. Products, gallery
metadata, bookings, inquiries, orders, and private delivery remain separate
domains and are managed through their existing flows. Content fields are
escaped Angular values; arbitrary HTML and private filesystem paths are not
accepted.

## Runtime data

The API persists products to `storage/products/products.json` and inquiries to
`storage/inquiries/`, both untracked and per-environment. On the VPS these live under
`/var/www/fairview/data/storage/`, so deploys never overwrite them. Products survive a
restart, but a JSON file is not a substitute for a real database once orders matter —
move to one before the catalog or order volume grows.
