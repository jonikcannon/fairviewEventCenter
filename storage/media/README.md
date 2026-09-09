# Gallery media

This directory is the authoring master for gallery media. **One folder per category —
the folder name is the category.**

When Cloudflare R2 is configured (`MEDIA_CDN_URL` in `.env`), the bucket — not this
directory — is what the site actually lists and serves. Files here are what you edit
and upload from; a machine that only needs to *run* the site needs none of them.

```
storage/media/
  community-center/   -> displayed as "Community Center" (venue gallery)
  church/              -> displayed as "Church" (venue gallery)
  church-services/    -> displayed as "Church services" (separate Church page gallery)
  gallery-manifest.json   (generated, do not edit)
```

`community-center` and `church` are the two categories in the venue ("See the space")
gallery's tabs. `church-services` is unrelated: it feeds the separate ministry gallery
on the Church nav page (moments from services, not photos of the room itself).

The venue gallery also has a "Virtual Tour" control per category. That is not a file
in these folders -- it is an embed link (Matterport, YouTube, etc.) set from the
admin panel and stored in site content, not the media library.

Every supported image or video in those folders is displayed automatically.
Supported formats are `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, and `.mp4`.
Videos play muted and loop. The filename becomes the displayed title; for example,
`sunset-over-water.jpg` displays as "Sunset Over Water".

After adding files, upload them and refresh the manifest:

```bash
npm run media:sync     # push new files to the bucket (skip when R2 is off)
npm run manifest       # rebuild gallery-manifest.json
```

`npm start` and `npm run build` refresh the manifest on their own. A file that has
not been uploaded yet is reported and left out of the manifest — the gallery can
only show what is servable.

## Why it lives here and not in `src/assets`

Nothing in this directory is tracked by git or bundled by the Angular build, which
is what lets multi-GB video live alongside the app without entering the repo or the
bundle. How it reaches the browser depends on whether R2 is configured:

- **With R2** — the browser fetches `<MEDIA_CDN_URL>/assets/gallery/<category>/<file>`
  directly from the bucket. Anything that still asks the origin for
  `/assets/gallery/…` is 302'd there by the API (dev) or nginx (prod).
- **Without R2** — the Express API serves `/assets/gallery/` off this directory (see
  `fairviewApi/server.js`) and `ng serve` proxies that path to it via `proxy.conf.json`,
  so **the API must be running (`npm run api`) for gallery media to appear in dev.**
  In production nginx serves it directly from
  `/var/www/fairview/data/storage/media`, never touching Node.

The object key and the web path are both `assets/gallery/<category>/<file>`; only
the host differs. Override the disk location with the `MEDIA_DIR` env var.

## Changing a photo's category

Move the file between folders (then re-run `npm run media:sync -- --prune`), or use
the admin UI, which calls `PATCH /api/admin/gallery/category` — that endpoint renames
the file into the target category folder, moves the object in the bucket to match,
and rewrites the manifest. If the bucket update fails the local move is rolled back,
so disk and CDN never disagree. On a host with no local copy, the move happens in
the bucket alone.

## Backups

These files are not in git. The R2 bucket is a serving origin, not a backup:
`media:sync --prune` deletes from it, and a mistake here propagates there on the next
sync. Keep a separate off-machine copy before deleting anything locally.
