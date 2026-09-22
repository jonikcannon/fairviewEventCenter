---
name: brandable-photo-commerce-starter
description: "Create a new, independently branded visual-media business site by copying this Angular + Express scaffold — either a photography studio/commerce shop or an event-space/venue rental business. Use when asked to clone, white-label, bootstrap, rebrand, or start a new company site with the same gallery, admin content builder, per-field typography controls, virtual tour, booking + rental-agreement engine, product shop, cart, Stripe checkout, private fulfilment, media storage, or deployment capabilities."
---

# Brandable Photo Commerce Starter

Create a new project from the current workspace, preserving its working Angular
18 + Express application architecture and its operational tooling. Do not modify
the source project. The destination must be a new, empty directory.

## Required Inputs

Before creating files, collect or confirm:

- Destination directory and npm package name (kebab-case).
- Company name, public site title, short description, and domain.
- Primary contact email and intended admin email.
- **Business type** — see "Two Proven Business Modes" below. This decides the
  nav tab set, the booking data model (or whether booking exists at all), and
  whether the catalog/cart/Stripe-download path is wired in or dropped.
- Business type and the services, gallery categories, and products (or rate
  schedule / rentable packages) to feature.
- Brand direction: logo/wordmark, colours, type direction (see "Per-Field
  Typography Controls" — this scaffold lets every major text block take its
  own font and size, not just a global stylesheet swap), and supplied assets.
- Whether the new company will use Cloudflare R2, Google Drive, Stripe, SMTP,
  and the included VPS/Nginx deployment path. If VPS/Nginx is kept, also ask
  whether a VPS is already provisioned (IP + SSH access) and whether the
  domain is already a zone in Cloudflare — the deploy scripts existing and
  being correctly branded doesn't mean that infrastructure exists yet (see
  "Cloudflare Tunnel token is a separate credential" below).
- **Which nav tabs to keep**, matched to the chosen business mode:
  - Commerce mode: Catalog (digital-download shop + cart + Stripe), Services
    (service list + inquiry form), Book (self-serve calendar booking +
    deposits), About.
  - Venue/event-space mode: Event Center (photo/video gallery + virtual
    tour), Booking (packages, add-ons, reservation fee, rental agreements —
    see "Booking, Packages & Rental Agreements"), About.
  - Home and the mailto Contact panel are structural and always present in
    both modes. Ask explicitly — many single-service businesses don't want
    every tab; a studio with no self-serve calendar should drop Book/Booking
    rather than ship a fake one, and a venue with nothing to sell digitally
    should drop Catalog rather than leave an empty shop.

Use temporary placeholder values for unknowns. Never ask for or copy secrets.

## Two Proven Business Modes

This scaffold has now been taken to production in both directions, and each
is the cleaner starting point for its kind of business rather than a partial
overlap of the other:

- **Photography commerce** (the original shape): a portfolio/work gallery,
  digital-download products sold through a cart and Stripe checkout, a
  services list with per-service inquiries, and simple session booking.
- **Venue/event-space rental** (this workspace, `fairviewEventCent` / Fairview
  Community Center): a photo/video venue gallery with an embeddable or
  self-hosted virtual tour, and a booking engine built around whole-day
  rental packages, optional paid add-ons, a flat non-refundable reservation
  fee, recurring weekday blocks, one-off date exceptions, and an
  auto-generated rental agreement document per confirmed booking. It has no
  product catalog, cart, or per-item Stripe checkout — Stripe is used only to
  collect the booking reservation-fee hold.

Both modes share the same Angular/Express core, the same admin auth, content
API, media pipeline, and deployment tooling — they differ in which nav tabs,
components, and server routes are wired up, and in what the "Booking" tab
actually books (a photo session vs. the whole venue for a day). Pick one
mode as the starting shape rather than trying to keep both catalog and
venue-rental booking wired in at once; a business that genuinely needs both
(e.g. a studio that also rents out its space) is a real but unusual case —
confirm that explicitly rather than assuming it.

**Known gap in this exact source tree:** `src/app/products/`,
`src/app/cart/`, and `src/app/services/` still exist and are still imported
in `app.component.ts` (the `Product`/`CartItem` types are still referenced by
`openProductMedia`/cart state), but nothing in `app.component.html` renders
`<app-products>`, `<app-cart>`, or `<app-services>` any more, and the admin
panel has no matching tab — this is dead code left over from an incomplete
"Drop Sections" pass when this project moved to venue-rental mode. Before
using this exact tree as the source for a **venue-rental** clone, either
finish removing that dead code (imports, state, `fairviewApi/server.js`
product/cart/Stripe-catalog routes, `storage/products/`) or explicitly flag
it as pending cleanup in the completion report — don't silently perpetuate
half-dropped code into a new clone. It only needs to stay if the new clone is
**commerce mode**, where it becomes the thing to rebrand instead.

## Source and Destination

Treat the current workspace root as `SOURCE_ROOT`. Let `DESTINATION` be the
new project directory supplied by the user. Refuse to use a destination that
already contains files unless the user explicitly authorizes a merge.

The project is a full-stack application, not a static website. Preserve these
key capabilities:

- Angular single-page site: home, about, and booking views always; plus
  either catalog/services (commerce mode) or an event-center gallery with
  virtual tour (venue mode).
- Gallery manifest generation, R2 CDN delivery, local-media fallback,
  watermarking, video conversion, safe media-name tooling, and a full-screen
  media lightbox (see "Interactive Media & Gallery UX").
- Commerce mode: product catalog, shopping cart, Stripe checkout, download
  fulfilment, and private Google Drive media delivery.
- Venue mode: package/add-on-driven booking, blocks/unblocks, deposit
  checkout, and auto-generated rental agreements (see "Booking, Packages &
  Rental Agreements").
- Admin authentication (password + Google Sign-In on one token), rate
  limiting, security headers, email notifications, and a structured content
  builder covering identity, hero, about, features, rates, FAQ, theme
  colours, typography, and virtual tour settings.
- VPS deployment scripts, Nginx configuration, and GitHub Actions deployment.

## Content Builder Requirement

The destination must be usable as a content-managed business site after the
initial clone. Do not leave the new owner dependent on editing Angular source
files for routine changes. Treat this as a single-business content system in
the first version, with a clean path to multi-tenant isolation later.

### Content domains

Keep runtime content separate from operational records and generated media:

- `storage/content/site-content.json`: site identity, navigation labels and
  visibility, hero, statement, contact details (including FAQ), about copy
  and features, rate schedule (items + optional uploaded document), virtual
  tour settings, theme colours, and per-field typography overrides.
- `storage/products/products.json` (commerce mode): shop products, prices,
  publication state, and delivery metadata. Do not duplicate product records
  in site content.
- `storage/media/descriptions.json` and the generated gallery manifest: public
  gallery filenames, captions, and descriptions. Do not edit the generated
  manifest from the admin UI.
- `storage/bookings/pricing.json` (venue mode, gitignored): admin-configurable
  reservation-fee override. Note that **packages and add-ons are not their
  own data model** — `fairviewApi/booking.js`'s `listBookablePackages()`
  derives whole-day packages from any `rates.items` entry that has a
  `category` and a flat (non-`/hour`) price, and `listAddOns()` derives
  add-ons from any `about.features` entry that has a `price`. There is
  deliberately no separate "packages" or "add-ons" admin screen — an admin
  manages the Rate Schedule and About Features, and the booking flow reads
  its sellable options from those. Preserve this derivation if you touch
  either the Rate Schedule or About Features editors; do not introduce a
  parallel packages table without also updating `booking.js`.
- Booking slots, blocks/unblocks, inquiries, orders, and fulfilment records:
  operational data; these remain separate and must not be editable through a
  generic content JSON endpoint.

Expose a public `GET /api/content` endpoint containing only published,
non-secret site content. Expose an authenticated `GET/PATCH /api/admin/content`
endpoint for structured section updates. Validate each section server-side
(`fairviewApi/content.js`'s `assertKeys`/`assertString`/`assertHexColor`/etc.
pattern), apply field length limits, reject arbitrary HTML and filesystem
paths, and write atomically with a backup or revision number. A free-form
JSON editor is acceptable as a recovery tool, but it must not be the primary
editor.

If the source scaffold does not yet provide this API and editor, treat that as
a scaffold-readiness gap: implement it in the source before using this skill
for a production clone, or explicitly report that the destination is only
brand-configurable and still requires developer changes for content editing.
Do not claim that a clone is content-managed merely because its admin login or
product uploader exists.

**Rental agreement text is a deliberate exception.** The venue mode's
16-clause rental agreement (`fairviewApi/rentalAgreement.js`) is boilerplate
legal text, intentionally *not* wired to `site-content.json` — it lives in a
`BUSINESS` constant plus literal clause strings. Rebranding it is a source
edit, not an admin-panel edit: update the `BUSINESS.name`/`address`/`phone`
constant **and** grep the file for the old business name, because it also
appears as plain text inside at least two individual clause strings (the
payment-default clause and the no-smoking clause) that do not interpolate
`BUSINESS.name`. `contact.address` in `site-content.json` and
`BUSINESS.address` in `rentalAgreement.js` are two separate values that can
drift — set both.

The admin builder should include, at minimum:

- Site settings: brand name, title, description, contact email, an optional
  phone number (shown in the footer and in the site's `EventVenue`
  structured data), social links, footer text, and SEO/social metadata.
- Navigation: ordered tabs, labels, visibility, and the requested feature
  flags for the tabs the business kept.
- Theme: primary/background/text colours as CSS custom properties
  (`AppComponent.applyTheme`), with a one-click reset to the stylesheet's
  original palette.
- Per-field typography: font family + size overrides for every major text
  block (see "Per-Field Typography Controls") with a per-field reset.
- Hero and home sections: eyebrow, headline, intro, CTA label/target, hero
  media reference, poster, hero logo size, and the three hero text sizes.
- About: heading, paragraphs, portrait/media reference, CTA, and a
  reorderable list of priced/unpriced "features" (each with its own image,
  clickable to open in the media lightbox — see "Interactive Media & Gallery
  UX"). A feature with a price becomes a bookable add-on in venue mode.
- Rate schedule: an optional uploaded PDF/Word document, plus admin-editable
  line items grouped by an optional category — categorized flat-price items
  become bookable packages in venue mode.
- Services (commerce mode): add, reorder, hide, and edit service name, icon,
  title, copy, media, pricing tiers, add-ons, and inquiry behavior.
- Work/portfolio cards (commerce mode) or venue gallery (venue mode): add,
  reorder, hide, and edit title, category, media, and optional description.
- Virtual tour: an embed URL (Matterport/YouTube/etc.) that takes priority
  when set, or one or more self-hosted panorama rooms shown in an
  interactive pan/zoom viewer with a room picker when no embed URL is set
  (see "Virtual Tour").
- Contact FAQ: add, reorder, remove question/answer pairs.
- Gallery metadata: edit title/description and move a media item by using
  existing safe media APIs; never allow arbitrary public or private path
  access.
- Venue mode only — Bookings tab: a dashboard (confirmed/upcoming counts,
  revenue, outstanding balance, a monthly bookings chart), recurring weekday
  blocks with a reason, one-off unblock date/date-range exceptions, manual
  booking entry (for phone/cash/walk-in customers) with package + add-on
  selection, per-booking agreed arrival time, "mark balance paid" for an
  off-site rental-fee payment, cancel booking, a waitlist view with a
  per-date "notify" action, and a "preview sample agreement" action that
  renders the rental agreement against fake data so an admin can check
  clause wording/layout without a real booking.

Use references to existing media keys rather than embedding uploads in the
content document. The media picker should list only public gallery media and
show a preview, media type, and accessible alt text. Product/private sale
media continues through its existing authenticated storage flow.

### Content migration and fallback

Before converting the Angular templates, inventory every hard-coded public
value in `src/app/` and seed the new content document with its current value.
The Angular app should load `/api/content` at startup and use a tracked,
brand-neutral defaults file when the API is unavailable or the document is
new. Preserve the current gallery manifest and product loading behavior while
moving only identity, home, about, service, work, navigation, and contact
content into the content model. A failed content request must show the public
site with defaults, not a blank shell.

### Admin and security acceptance criteria

- The same authenticated admin token must authorize password and Google
  login sessions; do not gate editing on the provider string.
- Content writes must be limited to the configured admin identity, use the
  existing bearer auth middleware, and be covered by rate limiting and audit
  timestamps. Never expose `.env`, service-account files, private sale media,
  inquiries, orders, or booking records through public content responses.
- Reject unknown keys, oversized strings/arrays, unsafe URLs, and media paths
  outside the public gallery namespace. Reject theme values that aren't valid
  hex colours and typography overrides that aren't in the tracked font-id
  allowlist (`TEXT_FONTS` in `src/app/text-style.ts`, kept in sync with
  `fairviewApi/content.js`) — never let a stored value become literal CSS.
  Escape content in Angular templates; do not add an unsafe HTML editor
  unless sanitization and a narrowly scoped allowlist are implemented.
- Add API tests for unauthenticated reads/writes, malformed payloads, atomic
  writes, fallback behavior, and an end-to-end smoke check for each kept tab.

For a later multi-business product, add a tenant/site identifier to every
content, product, and media record and replace the single `ADMIN_EMAIL` model
with users, roles, tenant-scoped authorization, revisions, and audit logs. Do
not imply that the first single-business JSON store provides those guarantees.

## Per-Field Typography Controls

Beyond the three theme colours, almost every major text block on the public
site (hero eyebrow/headline/intro, statement, about heading/body/features,
rates categories/items, contact/FAQ, navigation labels, and more) can take
its own font family and size from the admin panel, independent of the
underlying stylesheet.

- `src/app/text-style.ts` defines a small, fixed set of **web-safe font
  stacks** (`TEXT_FONTS`) — no third-party font host, so nothing to allow in
  a CSP and nothing to download. Only the font **id** is stored; the stack
  string is looked up client-side, so a saved value can never inject
  arbitrary CSS.
- Overrides are stored once per field *kind* in `content.textStyles`, keyed
  by dotted ids like `hero.headline` or `about.featureTitle` — every FAQ
  question shares one override, not one per FAQ item. `textStyle()` returns
  an empty object for an unset key, so an untouched clone renders exactly as
  the original hardcoded stylesheet.
- Size is capped (`min(Npx, 11vw)`) so a large desktop override cannot
  overflow a phone screen; hero eyebrow/headline/intro use their own
  dedicated pixel sliders instead of this generic size field
  (`FONT_ONLY_KEYS`), since those already had bespoke sliders before this
  system existed.
- When rebranding a clone's default type direction, prefer changing the
  *stylesheet* defaults (`app.component.css`, component CSS) over pre-seeding
  every `textStyles` key — the override system exists for the admin to reach
  for later, not as the initial branding mechanism.

## Interactive Media & Gallery UX

- **Full-screen lightbox** (`isMediaViewerOpen`/`selectedMedia` in
  `app.component.ts`): opens from the gallery grid, a product, or an About
  feature image. Supports Escape/←/→ keyboard navigation, click-outside to
  close, video play/pause with spacebar, and scroll-triggered prefetching of
  upcoming gallery media (`queueGalleryPrefetch`) so paging feels instant.
- **Nav arrows only render when there's a real list to page through.**
  `currentMediaIndex` is `-1` when an image was opened standalone (a product
  photo or an About feature image) rather than from the visible gallery —
  both the prev/next buttons and the arrow-key handlers check
  `currentMediaIndex >= 0` before doing anything, so a standalone image
  doesn't leak into paging through an unrelated gallery list. Keep this
  guard if you add another entry point into the lightbox.
- **About features are clickable into the lightbox**: each feature image has
  `role="button"`, `tabindex="0"`, an `aria-label`, Enter/Space handlers, and
  a `:focus-visible` outline — not just a `(click)` on an `<img>`. Follow
  this pattern (not a bare click handler) for any other non-`<button>`
  element you make interactive.
- **Muted-autoplay gotcha**: the hero background video binds `[muted]="true"`
  as a property, not a bare `muted` attribute. Angular creates the element
  and sets attributes *after* creation, so a static `muted` attribute never
  reflects to the property in time — the video plays unmuted-per-the-DOM and
  the browser silently refuses autoplay (`NotAllowedError`). Keep this as a
  property binding anywhere else a video needs to autoplay.
- **Custom prompt/confirm dialogs** (`promptDialogOpen`/`showPrompt` in
  `app.component.ts`) replace native `confirm()`/`alert()` throughout the
  admin panel, so destructive actions (delete media, cancel a booking, remove
  a block) get a themed modal instead of a browser-chrome dialog. Reuse this
  instead of reaching for `window.confirm`.
- The top nav intentionally has **no persistent admin button** — admin access
  is a single "Admin" link in the footer, keeping the public-facing chrome
  minimal. Preserve this placement rather than re-adding a nav-bar login
  button unless the new owner specifically asks for one.

## Virtual Tour

Venue mode's Event Center tab offers two mutually exclusive tour sources,
resolved in this priority order (`content.tours`):

1. **Embed URL** (`tours.communityCenter`) — a Matterport, YouTube, or similar
   `https://` embed link, sanitized and shown in an iframe. Takes priority
   whenever set.
2. **Self-hosted panorama rooms** (`tours.panoramas: {label, image}[]`) —
   shown via `PanoramaViewerComponent` (`src/app/panorama/`) only when no
   embed URL is set. This is a drag-to-pan, scroll/pinch-to-zoom viewer for a
   wide photo per room, with a labeled room-picker strip shown whenever
   there's more than one room — **not** a true 360° sphere. It assumes phone
   "panorama mode" captures at roughly 90° horizontal field of view, so a
   flat, edge-clamped pan/zoom reads correctly without cylindrical/spherical
   projection math. Don't feed it a true 360×180 equirectangular photo
   expecting correct wraparound — that needs a different viewer (e.g.
   Pannellum) and different math. Switching rooms resets pan/zoom
   independently per room (`selectRoom()`).

A clone carrying content saved under the older single-image
`tours.panoramaImage` field is migrated automatically on read
(`migrateLegacyTours` in `fairviewApi/content.js`) into a one-room
`panoramas` array — the old key is always deleted post-migration since
`validateContent`'s `assertKeys` would otherwise reject it as a leftover
field. If you fork this content model further, keep that migration in mind:
`mergeContent` adds/overrides keys, it never drops ones the new defaults no
longer declare.

A fully walkable, hotspot-linked tour between rooms (rather than a picker
strip) is a larger feature this scaffold does not attempt — don't retrofit
`PanoramaViewerComponent` for it; reach for a dedicated library instead.

## Booking, Packages & Rental Agreements

Venue mode's booking model (`fairviewApi/booking.js`,
`fairviewApi/rentalAgreement.js`) is built around the business's real paper
contract, not a generic percentage deposit:

- **Reservation fee is flat and additive, not a percentage prepayment.** A
  single ungrouped `rates.items` entry (no `category`) is the reservation
  fee (admin-overridable via `storage/bookings/pricing.json`). It is charged
  up front online and is **non-refundable outside the refund window**; the
  full rental/package fee (`balanceDue`) is always the package's full price
  and is due separately, 15 days before the event — the reservation fee
  never reduces it. If you change this pricing model for a new business,
  update `reservationFee()`/`balanceDue` and the rental agreement's payment
  clause together; they must stay consistent with each other.
- **Packages and add-ons have no dedicated data model** — see "Content
  domains" above. They're derived live from Rate Schedule items and About
  Features. This is the main thing a developer must understand before
  touching either editor.
- **Holds expire.** A slot is held (not yet confirmed) for `holdMinutes()`
  (env-configurable, default 15) while the customer completes Stripe
  checkout; if Stripe session creation fails, the hold is cancelled and the
  slot released immediately rather than blocking the calendar until timeout.
- **Refund window is a cooling-off period from booking time**, not a cutoff
  before the event (`refundCutoffHours()`, env-configurable, default 48h).
  `booking.refundable` reflects this for the admin's cancel-booking UI.
  Refunds themselves are manual — issued by the operator in the Stripe
  dashboard; there is no auto-refund flow.
- **Recurring weekday blocks + one-off unblock exceptions.** An admin can
  close a weekday recurring (e.g. "closed every Monday, reason: day job") and
  separately reopen specific dates or date ranges within a blocked weekday
  without touching the recurring rule. Days are open by default; a block
  only affects days that aren't already booked.
- **Manual admin bookings** (phone/cash/walk-in) skip the online
  reservation-fee flow entirely and confirm immediately at the chosen
  package's rate — flagged in the admin UI as only appropriate for a deal
  already agreed outside the site.
- **Auto-generated rental agreement per confirmed booking**
  (`GET /api/admin/bookings/:id/agreement`, admin-only, `409` until
  `status === 'confirmed'`): renders the actual paper contract's 16 clauses
  as printable HTML from the booking's own frozen fields (nothing is
  re-derived later, so the document a customer signed stays reproducible
  even if rates change afterward). The "View agreement" button opens the tab
  with `window.open('', '_blank')` called **synchronously**, before the
  `fetch`, then fills it with `document.write` once the HTML arrives —
  opening the tab only after an `await` loses the browser's trusted-user-
  gesture status and gets silently popup-blocked (especially in Safari).
  Keep this ordering if you touch that handler. Booking collects optional
  `address`/`eventDescription`/`guestCount` specifically to populate this
  document.
- If the new business has no whole-venue rental concept at all (pure
  photography commerce mode), drop this entire booking model rather than
  adapting it — commerce mode's simpler per-session booking + percentage (or
  flat) deposit is the better fit; don't force venue-mode's package/add-on
  derivation onto a business with nothing to derive it from.

Venue mode also includes, all built on the same booking record rather than
bolted on separately — treat these as part of the standard booking feature
set for a venue-mode clone, not optional extras to re-derive from scratch:

- **A short confirmation code** (`confirmationCode`, 8 chars, an
  unambiguous alphabet with no `0/O/1/I/L`) is generated per booking and
  paired with the booking's email on every public-facing action below —
  `requireBookingMatch` in `server.js` re-verifies both on every request
  rather than trusting a booking id (an unguessable UUID, but kept to the
  same gating for consistency) by itself.
- **Guest booking lookup** (`POST /api/bookings/lookup`, and the
  `BookingLookupComponent` UI mounted below the public booking form): a
  customer finds their own booking with email + confirmation code, no
  account system needed.
- **Typed-signature agreement acceptance** (`signAgreement`/
  `agreementSignedName`/`At`/`Ip` in `booking.js`, `POST
  /api/bookings/:id/agreement/sign`): a timestamped, IP-logged record that
  the named person affirmatively agreed to the rendered agreement text,
  alongside the existing print-and-sign option. Idempotent — once signed, a
  second submission is rejected rather than silently overwritten.
- **Per-booking `.ics` download** (`GET /api/bookings/:id/calendar.ics`,
  hand-rolled in `fairviewApi/ics.js` — one VEVENT shape, not worth a
  dependency) and an **admin-subscribable feed** of every confirmed upcoming
  booking (`GET /api/admin/bookings/calendar.ics?token=...`). The feed is
  gated by a separate static `ADMIN_CALENDAR_TOKEN`, not the admin bearer
  token, because a calendar app's subscription URL can't carry an
  `Authorization` header. `.ics` times are emitted as **floating local
  date-times** (no `Z`, no `TZID`/`VTIMEZONE`) deliberately — the booking's
  date + rental hours are already the venue's own wall-clock values, and a
  server timezone (often UTC on a VPS) would only introduce a wrong
  conversion; see the comment at the top of `ics.js` before changing this.
- **Online rental-fee balance payment** (`POST
  /api/bookings/:id/balance-checkout`, order `kind: 'booking-balance'` in
  `fulfilOrder`): pays the remaining `balanceDue` by card once the
  reservation is confirmed and the balance isn't already paid (online, or by
  the admin's "Mark balance paid" for an off-site cash/check/money-order
  payment). Card is listed as an accepted method in the rental agreement's
  Payment Terms clause alongside cash/cashier's check/money order/personal
  check — if a clone re-derives that clause text, keep the two in sync
  rather than accepting a method online the printed agreement doesn't list.
- **Waitlist** (`joinWaitlist`/`listWaitlist`/`markWaitlistNotified` in
  `booking.js`): picking an already-unavailable-but-future date in the
  public `BookingComponent` offers a waitlist form instead of a dead end.
  The admin Bookings tab lists entries and can "Notify" everyone
  not-yet-notified for a date by email, then marks them notified — there is
  deliberately no automatic re-offer when a block/slot is freed, since
  "the date opened up" can mean several different admin actions.
- **Two scheduled emails**, each sent at most once per booking
  (`reminderSentAt`/`reviewRequestSentAt` idempotency markers): a
  balance-due reminder (`BOOKING_BALANCE_REMINDER_DAYS` before the event,
  only while unpaid) and a post-event review request
  (`BOOKING_REVIEW_REQUEST_DAYS` after). `runScheduledBookingTasks` in
  `server.js` runs these on a `setInterval` (hourly, plus once ~15s after
  startup) rather than a cron dependency — the API process is already
  long-running under PM2, so a periodic in-process sweep needs nothing extra
  provisioned. Keep this in mind if a deployment target changes to something
  that doesn't keep the process alive (e.g. a serverless function per
  request), where this sweep would silently stop firing.
- **Admin bookings dashboard** (`GET /api/admin/bookings/stats`): confirmed/
  upcoming counts, revenue collected, outstanding balance, and a monthly
  bookings bar chart over the trailing 12 months, rendered as plain
  CSS-height bars — no charting library for one metric over ≤12 bars.

## Copy the Scaffold

1. Confirm the source contains `package.json`, `angular.json`, `src/`,
   `fairviewApi/`, `scripts/`, and `.env.example`. If `.env.example` is absent,
   stop and either add a complete non-secret example file to the source or
   explicitly record that the scaffold is not ready for cloning; do not copy a
   real `.env` as a substitute.
2. Create `DESTINATION` and copy the source tree without copying any local,
   generated, or customer-specific data. On Windows, run this from the source
   root using PowerShell:

   ```powershell
   New-Item -ItemType Directory -Force -Path $destination | Out-Null
   robocopy . $destination /E /XD .git node_modules dist .angular storage\media storage\uploads storage\quarantine storage\products storage\inquiries storage\orders storage\bookings storage\sale-photos\originals storage\sale-photos\deliveries /XF .env .oauth-token.json client_secret_*.json service-account-*.json filezilla_*.xml media-config.json
   if ($LASTEXITCODE -gt 7) { throw "Scaffold copy failed with robocopy exit code $LASTEXITCODE" }
   ```

   Assign `$destination` a fully resolved path before running it. `robocopy`
   exit codes `0` through `7` are successful copy outcomes.
3. Restore the tracked empty directory markers and safe starter directories:

   ```powershell
  New-Item -ItemType Directory -Force -Path storage\media, storage\uploads, storage\inquiries, storage\products, storage\orders, storage\bookings, storage\content, storage\sale-photos\originals, storage\sale-photos\deliveries | Out-Null
   New-Item -ItemType File -Force -Path storage\uploads\.gitignore, storage\sale-photos\originals\.gitkeep, storage\sale-photos\deliveries\.gitkeep | Out-Null
   ```

   Copy `docs/gallery-media.md` if it was excluded by the directory copy, and
   do not create fake gallery assets or customer records.
4. Initialize a new Git repository in `DESTINATION`. Do not copy the source
   `.git` history, credentials, `.env`, R2/Google service-account files,
   media, runtime records, generated manifests, or installed dependencies.

## Branding Pass

Perform the branding pass inside `DESTINATION` after the scaffold is copied.
Use structured edits where possible, and search the whole new project for the
old brand/domain before declaring it complete.

1. Update identity and build identifiers:
   - `package.json`: `name`, `description`, and any company-labelled scripts.
   - `angular.json`: application project key and `dist/` output path.
   - `src/index.html`: title, favicon reference, metadata, and social tags.
   - `README.md`, deployment documentation, Nginx config filenames/content,
     and workflow/deployment labels.
2. Rebrand the UI in `src/app/` and `src/styles.css`:
   - Replace company name, contact details, service descriptions, navigation
     copy, product copy, policies, logo treatment, and brand colours (the
     `theme` defaults in `site-content.ts` — an admin can adjust these later,
     but the stylesheet-baked defaults should already match the new brand).
   - Update actual hard-coded media references in `app.component.ts` and the
     about/service components. Use neutral local placeholders only when new
     brand media is unavailable; do not retain Fairview-owned image or video URLs.
   - Preserve accessible labels, responsive layout behaviour, cart, catalog,
     booking, and admin flows.
3. Venue mode only — rebrand `fairviewApi/rentalAgreement.js` (see "Rental
   agreement text is a deliberate exception" above): the `BUSINESS`
   name/address/phone constant, the two clause strings that repeat the
   business name as plain text, and `RENTAL_HOURS` if the new venue's
   rental window differs from 9 AM–10 PM.
4. Configure operational defaults:
   - Copy `.env.example` to `.env.example` only if it was not copied, then
     replace example domains, sender/recipient placeholders, bucket names,
     watermark text, and deployment host placeholders with new-company values.
   - Keep `.env` absent. Explain that real credentials must be created in the
     destination environment, never transferred from the source project.
   - Keep the `API_BASE_URL` example empty for same-origin deployments; only
     set it for a deliberately separate API origin. Whatever value ends up in
     `.env`, it only reaches the running app through
     `src/assets/media-config.json`, written by `generate-gallery-manifest.js`
     at `prestart`/`prebuild` time — editing `.env` after that file already
     exists has no effect until the manifest step re-runs.
5. Search for residual source branding, including case-insensitive instances of
   `Fairview`, `fairview`, `fairviewEventCenter`, `fairview-event-center.com`,
   `Greater Harvest`, `Panola`, `Ellenwood`, and any source contact email or
   CDN hostname found during the copy. Resolve every intended match or state
   why a historical reference remains.

## Drop Sections the New Business Doesn't Need

Asked-for tabs only. If the required inputs ruled out a nav tab, remove it
cleanly in `DESTINATION` rather than leaving a dead or half-configured
feature (see the "Known gap in this exact source tree" callout above for what
this looks like when it's *not* done cleanly):

- **Nav link and route.** In `src/app/app.component.html`, delete the `<a>` in
  `<nav>` for that tab and the `*ngIf="activeSection === '...'"` block that
  renders it (the `<app-services>`, `<app-booking>`, `<app-about>`,
  `<app-gallery>` element, or the `catalog-controls`/products section pair).
  The nav tab keys are literal TypeScript union members
  (`SiteContent['navigation']` in `site-content.ts`) tied one-to-one to
  `*ngIf="activeSection === '...'"` checks throughout the templates —
  renaming or repurposing a tab (e.g. turning a "work" gallery into
  "eventCenter") means updating the type, the defaults, and every template
  reference together, not just a label string.
- **Dead inbound links.** Grep the rest of `app.component.html` and the
  component templates for the same `activeSection` value — the hero CTA jumps
  to a configured target, and Services/About/Booking each set
  `activeSection = 'contact'` on their own inquiry links; repoint or remove
  any that now target a dropped tab.
- **Backing code.** Remove the now-unused component import from
  `AppComponent`'s `imports:` array, its state fields, loader methods (e.g.
  `loadBookingSlots`, `onBookSlot` for Book; `loadProducts`/cart logic for
  Catalog), and the component's own files under `src/app/<section>/` once
  nothing references them.
- **Server routes.** Dropping Catalog or Book also makes the matching
  `fairviewApi/*.js` routes (`booking.js`, `rentalAgreement.js`, product/cart/
  Stripe routes in `server.js`) and their `storage/` subfolders dead weight —
  remove the route mounts and admin-panel tab for a fully excised feature, or
  leave them mounted-but-unlinked only if the user wants the admin capability
  without a public entry point.
- Do not remove Home or the Contact panel — every remaining tab's inquiry
  links depend on `activeSection = 'contact'` staying reachable.

## Media and Integrations

- Gallery media is public and served from Cloudflare R2 when `R2_*` and
  `MEDIA_CDN_URL` are configured. With no R2 configuration, it is served from
  `storage/media/` locally. Run `npm run manifest -- --local` for an empty or
  local starter library.
- Product/sale media is separate from gallery media and uses Google Drive through
  authenticated API routes. Configure a new Drive folder and service account;
  never reuse source credentials or buyer media.
- Update `WATERMARK_TEXT` before publishing any public gallery assets.

### Getting real R2 credentials (do not derive them)

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` must come from
Cloudflare dashboard **R2 → Manage R2 API Tokens → Create API Token** (scope
"Object Read & Write" to the new bucket only). All three are shown once and
cannot be retrieved again later — copy them into `.env` immediately.

A general-purpose Cloudflare API Token (`Account:Cloudflare Tunnel:Edit` /
`Zone:DNS:Edit` / etc., the kind `scripts/deploy/setup-tunnel.sh` needs) is a
**different credential type** and cannot be converted into R2 keys, even
though Cloudflare's docs describe a derivation for tokens created *through*
the R2 flow (`Access Key ID = token id`, `Secret Access Key =
SHA-256(token value)`). Attempting that derivation on a non-R2 token produces
credentials that fail authentication outright. To tell the two failure modes
apart when debugging a "this doesn't work" R2 credential: call
`HeadBucketCommand` (or any S3 op) against a bucket name that almost
certainly does not exist. `403`/signature-rejected on a nonexistent bucket
means the credentials themselves are invalid; `404 NoSuchBucket` would mean
they authenticated fine and only lack access to that specific bucket. Don't
waste time re-deriving or guessing account IDs once you've seen the former.

If the new company shares a Cloudflare account with another brand built from
this scaffold (common — one person/agency operates several sites), reuse that
account's `R2_ACCOUNT_ID` (safe to share; it is not a secret by itself) but
create a **separate bucket** per brand and a **separate R2 token** scoped to
just that bucket. Never reuse another brand's R2 token or bucket.

### Cloudflare Tunnel token is a separate credential

If the VPS/Nginx deployment path is kept, `scripts/deploy/setup-tunnel.sh`
needs its own Cloudflare API Token distinct from the R2 token above, scoped
to `Account:Cloudflare Tunnel:Edit`, `Zone:DNS:Edit`, and `Zone:Zone:Read` on
the new domain's zone alone (not "All zones"). It also needs a provisioned,
reachable VPS (IP + SSH) and the domain already added as a zone in the same
Cloudflare account — ask about both before assuming the deploy kit can run
end-to-end; the scripts existing and being correctly branded (domain strings
already swapped in `scripts/deploy/`) does not mean the infrastructure they
target exists yet.

## Stripe Checkout

Checkout sessions are built entirely from local data at request time —
nothing needs to be pre-created as a Product or Price in the Stripe
dashboard, only the account and API keys. In venue mode, Stripe is used
*only* for the booking reservation-fee hold (`/api/booking/hold`); the
catalog/cart checkout path (`buildCheckoutLineItem` and `/api/checkout*`) is
commerce-mode-only and should be dropped along with the rest of Catalog if
the new business has no products (see "Drop Sections").

- **Keys.** Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the new
  `.env` from a Stripe account owned by the new company. Start with test-mode
  (`sk_test_...`) keys; never reuse the source project's keys.
- **Webhook.** Register a webhook for `checkout.session.completed` at
  `https://<new-domain>/api/webhooks/stripe` and put its signing secret in
  `STRIPE_WEBHOOK_SECRET`. `fairviewApi/server.js`'s `stripeWebhook` handler
  verifies that signature and is a no-op (`400`) without it — checkout will
  start but paid orders/bookings will never fulfil/confirm. For local
  testing, use the Stripe CLI
  (`stripe listen --forward-to localhost:3500/api/webhooks/stripe`) and its
  printed `whsec_...` instead of a dashboard webhook.
- **`CLIENT_ORIGIN`.** Drives the `success_url`/`cancel_url` built for every
  checkout session (`/api/checkout`, `/api/checkout/cart`,
  `/api/booking/hold`). Set it to the new production domain; it defaults to
  `http://localhost:6200`, which does not match this app's dev port (4500,
  see `angular.json`) or API port (3500, see `.env.example`'s `PORT` and
  `scripts/deploy/ecosystem.config.cjs`) and should not be relied on for
  local testing — pass it through `.env` instead.
- **Currency is hardcoded to `usd`** in two places: `buildCheckoutLineItem` in
  `fairviewApi/server.js` (catalog/cart checkout) and the inline `price_data` in the
  `/api/booking/hold` handler (booking deposits). If the new business needs a
  different currency, update both.
- **Preserve the order-before-redirect flow.** The API writes a pending order
  before sending the browser to Stripe, then attaches the returned Checkout
  Session ID. Keep `orderId` in Stripe metadata and `client_reference_id` so a
  webhook can reliably find the local order; do not depend on success-page
  navigation as proof of payment.
- **Preserve webhook idempotency.** `checkout.session.completed` can be
  delivered more than once. Keep the stored session/payment-intent IDs and the
  idempotent `markPaid`/fulfilment behavior so retries never send duplicate
  downloads, emails, or print jobs. Keep the webhook route's raw request body
  handling intact because Stripe signature verification requires it.
- **Booking checkout has a rollback path.** A booking slot is held before its
  deposit Checkout Session is created; if Stripe session creation fails, cancel
  the booking and release the slot immediately. Never leave a failed payment
  attempt blocking the calendar until the normal hold timeout.
- **Validate digital delivery input.** Cart checkouts containing digital items
  require a valid delivery email, store the email in the order, and pass it to
  Stripe as `customer_email`; retain this validation when changing product or
  checkout copy.
- **Refunds are manual.** There is no auto-refund flow; `bookingStore`'s
  refund-policy text and the admin cancel-booking action only track whether a
  deposit is inside the refund window (`booking.js`) — the operator issues the
  actual refund by hand in the Stripe dashboard. Mention this to the new owner
  rather than implying automated refunds exist.
- Set a new random `JWT_SECRET`, a bcrypt `ADMIN_PASSWORD_HASH`, SMTP details,
  and production contact addresses alongside the Stripe keys.

## Validate the New Project

From `DESTINATION`:

```powershell
npm install
npm run manifest -- --local
npx ng build
```

If `npm run <script>` fails with `PSSecurityException: UnauthorizedAccess`,
PowerShell's execution policy is blocking `npm.ps1`; run the underlying script
directly instead, e.g. `node scripts/generate-gallery-manifest.js`.

The build is the primary check: it must compile after the project key, branding,
and source changes. Then start the full stack with `npm start` and verify the
home page and every *kept* tab load — commerce mode: catalog/cart,
services/inquiry, booking, about; venue mode: event-center gallery/tour,
booking (including the guest booking-lookup panel and, if a test booking
exists, its .ics download and agreement sign/pay-balance actions) — plus the
admin sign-in surface and each admin tab (Site content, venue/product
gallery, Inquiries, Bookings, including its dashboard and waitlist). Confirm
a dropped tab has no residual nav link, console error, or dead route. Do not
treat payment, mail, Drive, or R2 calls as successful until their new
credentials are configured and tested.

A freshly copied venue-mode project has no `storage/bookings/*.jsonl` rows, so
the Booking tab correctly renders its "No sessions are open" empty state
rather than a calendar — that is expected, not a regression. Use the admin
panel's Bookings tab (or `POST /api/admin/booking/slots`) to publish a test
day before judging whether the calendar itself renders correctly, and use
"Preview sample agreement" to confirm the rental agreement renders before a
real booking exists. If the calendar instead shows a load error (`Availability
could not be loaded`) or a network failure pointing at the old company's
domain, `.env`'s `API_BASE_URL` still needs correcting and the manifest step
re-run — see the note in Branding Pass step 4.

## Feature Ideas Worth Considering

Venue mode's guest booking lookup, typed-signature agreement acceptance,
waitlist, `.ics` export (single booking + admin feed), online rental-balance
payment, the two scheduled emails, the admin bookings dashboard, multi-room
panorama tours, and `EventVenue` structured data are all now part of the
standard venue-mode feature set — see "Booking, Packages & Rental
Agreements" and "Virtual Tour" above, not optional add-ons to re-build.

What's still genuinely a future idea, worth raising with a new owner as an
optional add-on once the base site is live, each a moderate self-contained
addition rather than a rearchitecture:

- **Automated refunds**: refunds are deliberately manual today (issued by
  hand in the Stripe dashboard) — a "refund this deposit" admin button that
  calls the Stripe Refunds API would close that loop, but changes the
  business's liability/audit story, so confirm the owner actually wants
  refunds automatable before building it.
- **Testimonials section fed by the review-request email**: the review
  request already goes out post-event, but replies land in the studio inbox
  rather than anywhere the admin can turn them into published testimonials.
- **SMS notifications** (booking confirmation, balance reminder, waitlist
  notify) alongside the existing email sends, for a customer base that
  responds better to text — needs a provider (e.g. Twilio) and a phone
  number the customer opts into, not just the phone field already collected.
- **Multi-tenant isolation**: see the note under "Admin and security
  acceptance criteria" above — every content/booking/media record would need
  a tenant id, and `ADMIN_EMAIL` would need to become real per-tenant users
  and roles, before this scaffold could serve more than one business from
  one deployment.
- **A real database** in place of the `storage/*.jsonl` append-only files —
  fine at this business's volume (see "Runtime data" in `README.md`), but
  worth revisiting if booking/order volume grows enough that hand-inspecting
  a JSON Lines file stops being a reasonable admin/debugging workflow.

## Completion Report

Report the destination path, new package/application identifiers, which
business mode was used (commerce vs. venue-rental, or a stated hybrid),
completed branding substitutions (including the rental agreement's
`BUSINESS` constant and repeated clause text, if venue mode), theme/
typography defaults set, which nav tabs were kept vs. dropped (and what was
removed for each dropped tab), intentionally retained features, excluded
data/secrets, and validation results. List integrations still requiring
customer-provided credentials or media, and any "Feature Ideas Worth
Considering" items the new owner expressed interest in. Do not commit unless
asked.
