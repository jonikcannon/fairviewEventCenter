---
name: run-fairview
description: Build, launch, and drive the Fairview Event Center photography site (Angular 18 + Express API). Use when asked to run, start, serve, smoke-test, screenshot, or debug load errors in this app, or to verify gallery media, captions, and alt text render correctly.
---

# Run Fairview Event Center

Angular 18 SPA (`ng serve`, port 4500) plus an Express API (`fairviewApi/server.js`,
port 3500). These are dev-only defaults, deliberately off the old 4200/3000 pair
so a local test run here can never collide with (or kill) something already
listening on 3000/4200 — never point this at, or run it against, any remote or
production host. Gallery media is served from a Cloudflare R2 bucket; the app
discovers it through `storage/media/gallery-manifest.json`, which is regenerated
on every start.

Drive it with **`.claude/skills/run-fairview/driver.mjs`** — a Chrome
DevTools Protocol client. It launches headless Chrome itself, clicks into the
Event Center's venue gallery, opens the media viewer, and reports console
errors plus failed requests. Neither playwright nor puppeteer is installed, and
`chromium-cli` is absent; the driver needs no dependency beyond Node 22's
built-in `WebSocket`.

All paths below are relative to the repo root.

## Prerequisites

- **Node 22** (verified on v22.14.0) — `node --version`
- **Chrome or Edge.** The driver auto-detects; on this machine Chrome is at
  `C:/Program Files/Google/Chrome/Application/chrome.exe`.
- **`.env` with R2 credentials.** Without `R2_*`, the manifest step falls back
  to listing local disk. `MEDIA_CDN_URL` decides whether media URLs point at
  the bucket or stay relative.

Verified on Windows 11 with Git Bash. Not tried on Linux/macOS.

## Setup

```bash
npm install
```

Native builds (`sharp`, `esbuild`, `lmdb`) are gated behind npm's script
approval; they were already built here. If a script-approval warning turns into
a runtime failure, run `npm approve-scripts <pkg>`.

## Run (agent path)

**1. Check the ports first — do not blindly kill them.** `npm start` reads
`PORT`/the Angular `serve.port` config, both defaulted to 3500/4500 in this
repo. If `netstat` shows something already listening on 3500 or 4500, stop and
ask before touching it — it might not be yours. Never free 3000/4200 either:
those are not this skill's ports, and something else on this machine may
depend on them.

```bash
for p in 3500 4500; do
  pid=$(netstat -ano | grep LISTENING | grep -E ":$p\s" | awk '{print $NF}' | head -1)
  [ -n "$pid" ] && echo "port $p is in use by PID $pid — investigate before killing"
done
```

**2. Start both servers in the background.**

```bash
npm start > /tmp/app.log 2>&1 &
```

**3. Wait on the ports, not on a timer.** First compile takes 1–2 minutes and
`prestart` regenerates the manifest from R2 before that.

```bash
until curl -s --max-time 3 -o /dev/null http://localhost:4500/ \
   && curl -s --max-time 3 -o /dev/null http://127.0.0.1:3500/assets/gallery/gallery-manifest.json
do sleep 3; done; echo "both servers ready"
```

**4. Drive it.**

```bash
node .claude/skills/run-fairview/driver.mjs urls      # HEAD every manifest URL
node .claude/skills/run-fairview/driver.mjs smoke     # load Event Center gallery, screenshot
node .claude/skills/run-fairview/driver.mjs viewer    # open media viewer, screenshot
```

Screenshots land in `.claude/skills/run-fairview/shots/`. **Look at them** —
a dark page with no cards means the manifest never loaded.

Each command prints JSON and **exits 1 if it found problems**, so it works in a
conditional. `storage/media/` is currently empty (photos are not committed to
git), so a fresh checkout's baseline is `{ "checked": 0, "described": 0,
"failures": 0, "bad": [] }` until real venue photos are added — a positive
`checked` count means media has been added since.

`smoke` reports `cards`, `imgCount`, `brokenImgs`, `missingAlt`, and
`horizontalOverflow`. `viewer` is the one that proves the caption pipeline
(`descriptions.json` → manifest → `openMedia` → viewer) end to end:

```json
{ "viewer": { "open": true, "title": "...", "description": "...", "alt": "...", "imgBroken": false } }
```

`viewer` returning `"description": null` means a description stopped reaching
`selectedMedia` — check `openMedia` in `src/app/app.component.ts`.

**5. Stop cleanly.** Killing the `npm start` job alone is not enough — it
leaves orphaned `node`/`ng` children holding 3500/4500. Kill only the PIDs
*you* started (note them when you launch, e.g. `npm start & echo $!`), the
same way step 1 asked you to check before touching anything already there.

## Run (human path)

`npm start` then open <http://localhost:4500>. Useless headless; use the driver.

## Build

```bash
npx ng build
```

Use `npx ng build`, not `npm run build`: the `prebuild` hook runs `npm run media`,
which re-lists the R2 bucket and rewrites the manifest. Fine, but slow and it
needs network. Output goes to `dist/fairview-event-center`.

Regenerate the manifest on its own:

```bash
npm run manifest              # from the bucket when MEDIA_CDN_URL is set
npm run manifest -- --local   # force the local-disk listing
```

## Gotchas

- **Stopping the `npm start` job leaves orphans.** Killing the npm wrapper does
  not kill the child `node`/`ng` processes. They keep holding 3500 and 4500, and
  the next `npm start` dies with `EADDRINUSE 127.0.0.1:3500`. Track the PIDs you
  started and kill those specifically — never a blanket "kill by port", since a
  port can be held by something that isn't yours (see step 1).
- **A stale server will happily answer your probes**, so the readiness loop
  passes and you think you're testing new code. If behaviour doesn't match your
  edits, find the PID you started, kill it, and restart.
- **`ng serve` first compile is 1–2 minutes.** Probing too early returns
  `000` and looks like a crash. `npm start` also runs `prestart` → `npm run media`,
  which hits R2 first.
- **`npx playwright --version` hangs for minutes** trying to fetch. Don't reach
  for it. `chromium-cli` is not installed either. The driver's hand-rolled CDP
  client exists for exactly this reason.
- **There is no router.** `activeSection` is plain component state, so
  `/church` or `/event-center` don't exist and you cannot deep-link — the
  driver clicks nav links (`Home`/`About`/`Event Center`/`Church`) by text
  content. A `--dump-dom` of `/` shows zero `<img>` — that's the hero, not a
  failure.
- **The venue gallery lives under Event Center, not its own tab.**
  `<app-gallery>` renders inside the `activeSection === 'eventCenter'` block
  (see `app.component.html`), stacked above `<app-booking>`. There is no
  `<app-products>`/shop or `<app-services>` anymore — both were removed from
  the template; their component files remain in the repo but are unreferenced.
- **`API_BASE_URL` in `.env` points at `api.fairview-event-center.com`, which is NXDOMAIN.**
  The Event Center's booking calendar has no fallback for this: it shows "No
  sessions are open" with `Availability could not be loaded` instead of a
  calendar. `media-url.ts` defaults `apiBaseUrl` to `/api`, which
  `proxy.conf.json` routes to :3500 in dev and nginx routes in prod — so
  commenting out `API_BASE_URL` is the fix. Until then, treat that one console
  error and that one failed request as expected baseline noise.
- **Commenting out `API_BASE_URL` in `.env` does nothing until the manifest
  regenerates.** The value is baked once into `src/assets/media-config.json`
  by `generate-gallery-manifest.js` (`apiBaseUrl` key) and read from there at
  runtime — editing `.env` alone leaves the stale bad URL in that JSON file.
  Re-run `npm run manifest` (or restart via `npm start`, which runs it as
  `prestart`) and hard-reload the page. Confirm the fix by reading
  `src/assets/media-config.json` and checking `apiBaseUrl` is `""`.
- **`npm run <script>` can fail with `PSSecurityException: UnauthorizedAccess`**
  when PowerShell's execution policy blocks `npm.ps1`. Run the underlying
  script directly instead, e.g. `node scripts/generate-gallery-manifest.js` in
  place of `npm run manifest`.
- **`favicon.ico` 404s.** Cosmetic, pre-existing.
- **`npm install` while the dev servers are running kills them** — it rewrites
  `node_modules` under `ng serve`. Install first, then start.
- **A Node script outside the repo can't resolve the repo's `node_modules`.**
  Run helper scripts from the repo root, or `require()` by absolute path.
- **`<video autoplay loop>` emits `net::ERR_ABORTED` range requests** when the
  page is torn down. Not failures — the driver filters them out. Don't
  re-introduce them as findings.
- **Renaming gallery media breaks hardcoded paths.** A handful of gallery URLs
  are hardcoded in `app.component.ts` (hero video, service tiles, poster) and
  `about.component.ts`. They are not manifest-driven and fail silently — the
  page renders, the media 404s. `scripts/apply-media-names.js` now greps `src/`
  and reports these; heed it.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Error: listen EADDRINUSE 127.0.0.1:3500` then both servers exit | An orphaned server from a previous run of *this skill* is still holding the port. Find that specific PID and kill it — do not kill by port blindly (step 1). |
| Readiness loop never finishes | Check `/tmp/app.log`. `[api]`/`[web]` prefixed lines do appear — if the log stops at the `concurrently` line, compilation is still running. |
| `DRIVER FAILED: no Chrome/Edge found` | Add your browser path to `CHROME_CANDIDATES` in `driver.mjs`. |
| `DRIVER FAILED: Chrome did not open its debug port within 30s` | A stale Chrome holds the profile dir. `taskkill //IM chrome.exe //F`, or delete `.claude/skills/run-fairview/.chrome-profile`. |
| `DRIVER FAILED: could not find the Event Center nav link` | The page didn't finish bootstrapping, or the nav label changed. Screenshot to confirm. |
| `manifest fetch failed: HTTP 404` from `urls` | Express (:3500) is down — `ng serve` proxies `/assets/gallery` to it. |
| `urls` reports failures | A manifest entry points at a missing object. Re-run `npm run manifest`; if it persists, the bucket and manifest disagree. |
| Venue gallery renders but every card is dark/empty | The R2 bucket is unreachable. Check `MEDIA_CDN_URL` and that the URLs in the manifest are absolute. |
| Booking tab shows "No sessions are open" / `Availability could not be loaded`, `net::ERR_NAME_NOT_RESOLVED` for `api.fairview-event-center.com` | Stale `apiBaseUrl` in `src/assets/media-config.json` from a bad `API_BASE_URL` in `.env`. Comment out `API_BASE_URL`, re-run `npm run manifest` (or `node scripts/generate-gallery-manifest.js` if npm is blocked), then reload. |
| `npm run manifest` (or any `npm run ...`) fails with `PSSecurityException: UnauthorizedAccess` | PowerShell execution policy is blocking `npm.ps1`. Run the script directly, e.g. `node scripts/generate-gallery-manifest.js`. |
