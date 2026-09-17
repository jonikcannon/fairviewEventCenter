// Self-serve DAY booking: the event space, 9am-10pm, priced by whichever
// rate-schedule package (and add-ons) the customer picks -- deposit-confirmed.
// Every future day is bookable by default; picking one
// creates a slot (if it doesn't already exist) and a client pays a deposit ->
// the Stripe webhook confirms it. There is exactly one slot per calendar
// date, so once it is booked (or even just held while someone is on the
// Stripe page) it disappears from the public list entirely -- there is
// nothing left open for a second visitor to grab, which is what rules out
// double-booking a day by construction rather than by a check that could race.
//
// Between picking and paying, a day is HELD rather than booked, so two
// people cannot buy the same day while one is still on the Stripe page. An
// unpaid hold expires and the day returns to the pool.
//
// Concurrency note: hold/release/confirm do their read-modify-write with no
// await in between. Node runs one turn of the event loop at a time, so within a
// single process that sequence cannot interleave. PM2 runs this app in fork mode
// with one instance (scripts/deploy/ecosystem.config.cjs) -- if that ever becomes
// cluster mode or more than one instance, this needs a real lock, because two
// processes could each read "open" for the same date.

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const siteContent = require('./content');

const bookingDir = path.join(__dirname, '../storage/bookings');
const slotsFile = path.join(bookingDir, 'slots.jsonl');
const bookingsFile = path.join(bookingDir, 'bookings.jsonl');
const blocksFile = path.join(bookingDir, 'blocks.jsonl');
const unblocksFile = path.join(bookingDir, 'unblocks.jsonl');

const SLOT = Object.freeze({ OPEN: 'open', HELD: 'held', BOOKED: 'booked', BLOCKED: 'blocked' });
const BOOKING = Object.freeze({ PENDING: 'pending', CONFIRMED: 'confirmed', CANCELLED: 'cancelled', EXPIRED: 'expired' });

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Caps a single unblockRange call (the admin panel's bulk-unblock range) so a
// typo'd end date cannot silently expand it into years of rows.
const MAX_PUBLISH_RANGE_DAYS = 62;

// Recurring unavailability: whole weekdays (Mon-Fri, say, for a day job).
// Blocks are applied in two places on purpose. createRequestedSlot/
// createManualBooking skip a blocked date (the latter can be overridden by
// hand -- see its own comment) so a slot is never written for it, and
// listOpenSlots filters them so a block added later also hides a day that
// already has an open slot. Filtering at read affects only OPEN slots, so a
// block can never hide a day someone has already paid for -- that is the
// admin's problem to move by hand.
const WEEKDAY_NAMES = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

// Pricing now comes entirely from the public Rate Schedule (content.rates.items)
// and the About page's optional feature prices (content.about.features[].price)
// -- there is no separate admin-editable flat fee anymore. These are only the
// last-resort fallbacks if the rate schedule is ever empty/unparseable, so a
// booking never fails outright for lack of a price.
const DEFAULT_RESERVATION_FEE_CENTS = 10000;
const DEFAULT_SESSION_FEE_CENTS = 120000;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// "$1,200.00" -> 120000, "$125.00/hour" -> 12500. Only the first dollar
// amount is used; a unit suffix like "/hour" is not modeled here (see
// listBookablePackages, which excludes per-unit items rather than guessing a
// quantity for them). Returns null when no amount can be found.
function parseMoneyToCents(text) {
  const match = String(text || '').match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const dollars = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The whole-day packages a customer can choose when booking a date (Standard
// Package Morning/Evening/All Day, etc.) -- every rate-schedule item that has
// a category (the ungrouped "Refundable Rental Deposit" line is the
// reservation fee, not a package -- see reservationFee()) and a flat price
// (no "/hour"-style unit, since a day-long booking has no quantity to attach
// an hourly rate to).
function listBookablePackages() {
  const items = siteContent.readContent().rates.items || [];
  return items
    .filter(item => item.category && !/\/\s*[a-z]/i.test(item.price))
    .map(item => ({ id: slugify(item.name), name: item.name, detail: item.detail, priceCents: parseMoneyToCents(item.price) }))
    .filter(item => item.id && Number.isFinite(item.priceCents) && item.priceCents > 0);
}

function findPackage(packageId) {
  return listBookablePackages().find(pkg => pkg.id === String(packageId || '')) || null;
}

// Optional extras a customer can add to a booking -- any About page feature
// an admin has given a price to (see about.features[].price). Features left
// at their default blank price are part of the venue rental itself (shown as
// "Included" on the About page), not a chargeable add-on.
function listAddOns() {
  const features = siteContent.readContent().about.features || [];
  return features
    .filter(feature => feature.price)
    .map(feature => ({ id: slugify(feature.title), name: feature.title, priceCents: parseMoneyToCents(feature.price) }))
    .filter(addOn => addOn.id && Number.isFinite(addOn.priceCents) && addOn.priceCents > 0);
}

// Resolves a customer's chosen add-on ids against the current list, dropping
// anything unknown (stale id from a page loaded before an admin edited them)
// rather than failing the whole booking over it.
function resolveAddOns(addOnIds) {
  const available = listAddOns();
  const wanted = new Set((Array.isArray(addOnIds) ? addOnIds : []).map(String));
  return available.filter(addOn => wanted.has(addOn.id));
}

// The one rate-schedule item with no category is the refundable deposit --
// paid on top of the rental fee, not a prepayment against it (see
// publicSlot's balanceDue comment).
function reservationFee() {
  const items = siteContent.readContent().rates.items || [];
  const depositItem = items.find(item => !item.category);
  const cents = depositItem ? parseMoneyToCents(depositItem.price) : null;
  return Number.isFinite(cents) && cents > 0 ? cents : DEFAULT_RESERVATION_FEE_CENTS;
}

// Named `depositFor` for historical reasons (the field is still called
// `deposit` everywhere it's stored/displayed) -- the amount itself no longer
// depends on the session fee it's paid alongside.
function depositFor(_sessionFee) {
  return reservationFee();
}

function holdMinutes() {
  const configured = Number(process.env.BOOKING_HOLD_MINUTES);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 15;
}

// A cooling-off window measured from when the booking was made -- NOT a cutoff
// before the session. Customer-facing, so it is configuration rather than a
// constant buried in code.
function refundCutoffHours() {
  const configured = Number(process.env.BOOKING_REFUND_CUTOFF_HOURS);
  return Number.isFinite(configured) && configured >= 0 ? Math.round(configured) : 48;
}

function refundPolicyText() {
  const hours = refundCutoffHours();
  if (!hours) return 'Deposits are non-refundable.';
  return `Deposit is refundable if you cancel within ${hours} hours of booking. After that the deposit is retained.`;
}

// Calendar-day comparison, deliberately string-based. Slots are days, not
// instants, so converting to UTC could shift a date across midnight and hide or
// expose a day by one.
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isPastDate(date) {
  return String(date || '') < today();
}

// A day-level slot is spent once the whole calendar day has passed.
function isPastSlot(slot) {
  return isPastDate(slot?.date);
}

function ensureStore() {
  if (!fs.existsSync(bookingDir)) fs.mkdirSync(bookingDir, { recursive: true });
}

function readFile(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function writeFile(file, rows) {
  ensureStore();
  const next = rows.map(row => JSON.stringify(row)).join('\n');
  fs.writeFileSync(file, next ? `${next}\n` : '', 'utf8');
}

const readSlots = () => readFile(slotsFile);
const readBookings = () => readFile(bookingsFile);
const readBlocks = () => readFile(blocksFile);
const readUnblocks = () => readFile(unblocksFile);
const writeSlots = rows => writeFile(slotsFile, rows);
const writeBookings = rows => writeFile(bookingsFile, rows);
const writeBlocks = rows => writeFile(blocksFile, rows);
const writeUnblocks = rows => writeFile(unblocksFile, rows);

function appendFileRow(file, row) {
  ensureStore();
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

const appendSlot = slot => appendFileRow(slotsFile, slot);
const appendBooking = booking => appendFileRow(bookingsFile, booking);

// An abandoned Stripe page must not keep a day off the market forever. Sweeping
// on read means no timer is needed and a restart cannot lose pending releases.
function releaseExpiredHolds(now = Date.now()) {
  const slots = readSlots();
  const expired = slots.filter(slot => slot.status === SLOT.HELD && slot.holdUntil && Date.parse(slot.holdUntil) <= now);
  if (!expired.length) return { slots, released: 0 };

  const expiredIds = new Set(expired.map(slot => slot.id));
  const nextSlots = slots.map(slot => (
    expiredIds.has(slot.id)
      ? { ...slot, status: SLOT.OPEN, holdUntil: '', bookingId: '', updatedAt: new Date(now).toISOString() }
      : slot
  ));
  writeSlots(nextSlots);

  const affected = new Set(expired.map(slot => slot.bookingId).filter(Boolean));
  if (affected.size) {
    writeBookings(readBookings().map(booking => (
      affected.has(booking.id) && booking.status === BOOKING.PENDING
        ? { ...booking, status: BOOKING.EXPIRED, updatedAt: new Date(now).toISOString() }
        : booking
    )));
  }

  return { slots: nextSlots, released: expired.length };
}

// Local-time parse, deliberately not UTC: a date key is a calendar day, not an
// instant, so parsing it as UTC could shift it across midnight and land on the
// wrong weekday depending on the server's offset.
function parseDateKey(date) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function formatDateKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekdayOf(date) {
  return parseDateKey(date).getDay();
}

function blockLabel(block) {
  return [...block.weekdays].sort().map(day => WEEKDAY_NAMES[day]).join(', ');
}

function createBlock({ weekdays, reason = '' }) {
  const days = Array.from(new Set(
    (Array.isArray(weekdays) ? weekdays : [weekdays])
      .map(Number)
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
  ));
  if (!days.length) return { error: 'Pick at least one weekday to block.' };

  const now = new Date().toISOString();
  return {
    block: appendFileRow(blocksFile, {
      id: randomUUID(),
      weekdays: days.sort(),
      reason: String(reason || '').trim().slice(0, 120),
      createdAt: now
    })
  };
}

function deleteBlock(blockId) {
  const blocks = readBlocks();
  if (!blocks.some(block => block.id === blockId)) return { error: 'Block not found.', status: 404 };
  writeBlocks(blocks.filter(block => block.id !== blockId));
  return { ok: true };
}

// Per-date unblocks: a one-off exception to a recurring weekday block.
// Unblocks override blocks in the two places blocks apply: createRequestedSlot/
// createManualBooking and listOpenSlots. They never resurrect a cancelled day
// or a past date.
function isUnblocked(date, unblocks = readUnblocks()) {
  const day = String(date || '').trim();
  return unblocks.some(rule => String(rule?.date || '') === day);
}

function unblockLabel(rule) {
  return rule.date;
}

// True when a block's weekday rule actually covers this date.
function isWeekdayBlocked(date, blocks = readBlocks()) {
  const weekday = weekdayOf(date);
  return blocks.some(block => Array.isArray(block.weekdays) && block.weekdays.includes(weekday));
}

function createUnblock({ date, reason = '' }) {
  const day = String(date || '').trim();
  if (!DATE_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00`))) {
    return { error: 'Date must be a calendar date in YYYY-MM-DD form.' };
  }
  if (isPastDate(day)) return { error: 'That date is in the past.' };
  if (isUnblocked(day)) return { error: 'That day is already unblocked.', status: 409 };

  // Days are bookable by default: an exception only means something when a
  // block actually covers the day. A rule with nothing to override is dead
  // weight in the list, so reject it and say why.
  if (!isWeekdayBlocked(day)) {
    return { error: 'That day is not blocked. Days are open by default -- publish it normally.', status: 409 };
  }

  const now = new Date().toISOString();
  return {
    unblock: appendFileRow(unblocksFile, {
      id: randomUUID(),
      date: day,
      reason: String(reason || '').trim().slice(0, 120),
      createdAt: now
    })
  };
}

// Unblocks every day in [startDate, endDate] that a block actually covers --
// days already open by default, or already unblocked, are skipped rather than
// erroring, so a range can be unblocked without knowing in advance which of
// its days are affected.
function unblockRange({ startDate, endDate, reason = '' }) {
  const start = String(startDate || '').trim();
  const end = String(endDate || '').trim();
  if (!DATE_PATTERN.test(start) || Number.isNaN(Date.parse(`${start}T00:00:00`))) {
    return { error: 'Start date must be a calendar date in YYYY-MM-DD form.' };
  }
  if (!DATE_PATTERN.test(end) || Number.isNaN(Date.parse(`${end}T00:00:00`))) {
    return { error: 'End date must be a calendar date in YYYY-MM-DD form.' };
  }
  const startDay = parseDateKey(start);
  const endDay = parseDateKey(end);
  if (endDay < startDay) return { error: 'End date must be on or after the start date.' };

  // Walked with setDate rather than a millisecond-difference divide: a DST
  // transition inside the range makes some days 23 or 25 hours long, which
  // throws off a fixed-86400000 day count by one.
  const dayKeys = [];
  for (const cursor = new Date(startDay); cursor <= endDay; cursor.setDate(cursor.getDate() + 1)) {
    dayKeys.push(formatDateKey(cursor));
    if (dayKeys.length > MAX_PUBLISH_RANGE_DAYS) {
      return { error: `Pick a range of ${MAX_PUBLISH_RANGE_DAYS} days or fewer.` };
    }
  }

  const blocks = readBlocks();
  const created = [];
  let daysPast = 0;
  let daysNotBlocked = 0;
  for (const day of dayKeys) {
    if (isPastDate(day)) { daysPast += 1; continue; }
    if (isUnblocked(day)) { daysNotBlocked += 1; continue; }
    if (!isWeekdayBlocked(day, blocks)) { daysNotBlocked += 1; continue; }
    const result = createUnblock({ date: day, reason });
    if (result.unblock) created.push(result.unblock);
  }

  return {
    unblocks: created,
    unblockedDays: created.length,
    daysAttempted: dayKeys.length - daysPast,
    daysSkippedPast: daysPast,
    daysSkippedNotBlocked: daysNotBlocked
  };
}

function deleteUnblock(unblockId) {
  const unblocks = readUnblocks();
  if (!unblocks.some(rule => rule.id === unblockId)) return { error: 'Unblock not found.', status: 404 };
  writeUnblocks(unblocks.filter(rule => rule.id !== unblockId));
  return { ok: true };
}

// True when `date` is covered by a weekday block and no unblock exception
// lifts it for that specific date.
function isBlocked(date, blocks = readBlocks(), unblocks = readUnblocks()) {
  if (isUnblocked(date, unblocks)) return false;
  return isWeekdayBlocked(date, blocks);
}

function slotIsBlocked(slot, blocks, unblocks) {
  return isBlocked(slot.date, blocks, unblocks);
}

// A day no longer has one fixed price -- the rental fee depends on which
// package the customer picks when they hold it (see holdSlot). The public
// listing is just "this day is open"; listBookablePackages()/reservationFee()
// (surfaced alongside this list in server.js) are what the booking form
// prices its live quote from as the customer picks a package and add-ons.
function publicSlot(slot) {
  return {
    id: slot.id,
    date: slot.date,
    location: slot.location || ''
  };
}

// Only genuinely open days still in the future are offered.
function listOpenSlots({ from = '', to = '' } = {}) {
  const { slots } = releaseExpiredHolds();
  const blocks = readBlocks();
  const unblocks = readUnblocks();
  return slots
    .filter(slot => slot.status === SLOT.OPEN)
    .filter(slot => !isPastSlot(slot))
    .filter(slot => !slotIsBlocked(slot, blocks, unblocks))
    .filter(slot => (!from || slot.date >= from) && (!to || slot.date <= to))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .map(publicSlot);
}

// Dates already spoken for -- booked outright, or currently held while a
// visitor is on the Stripe page -- so the public calendar can grey out a
// taken day without exposing who booked it or what they paid. Days with no
// slot at all are NOT in this list: those are simply open by default (see
// the file header), which is what distinguishes "taken" from "never
// published" now that the calendar no longer treats the two as the same
// thing.
function listUnavailableDates({ from = '', to = '' } = {}) {
  const { slots } = releaseExpiredHolds();
  return slots
    .filter(slot => slot.status === SLOT.BOOKED || slot.status === SLOT.HELD)
    .filter(slot => !isPastSlot(slot))
    .filter(slot => (!from || slot.date >= from) && (!to || slot.date <= to))
    .map(slot => slot.date)
    .sort();
}

// Public-safe view of the recurring block rules: which weekdays are closed.
// Reasons stay admin-only; a weekday number alone reveals nothing sensitive
// and lets the calendar grey those days out itself instead of guessing from
// the absence of a slot.
function listClosedWeekdays() {
  const days = new Set();
  for (const block of readBlocks()) {
    for (const day of block.weekdays || []) days.add(day);
  }
  return Array.from(days).sort((left, right) => left - right);
}

// Public-safe view of one-off exceptions to those closed weekdays.
function listUnblockedDates({ from = '', to = '' } = {}) {
  return readUnblocks()
    .map(rule => rule.date)
    .filter(date => !isPastDate(date))
    .filter(date => (!from || date >= from) && (!to || date <= to))
    .sort();
}

function findSlot(id) {
  return readSlots().find(slot => slot.id === String(id || '')) || null;
}

function findBooking(id) {
  return readBookings().find(booking => booking.id === String(id || '')) || null;
}

// Creates a bare slot for a date a visitor picked -- pricing is decided at
// hold time by whichever package/add-ons they choose, not here -- and hands
// the id to holdSlot so the rest of the pipeline (hold, Stripe checkout,
// webhook confirm, expiry sweep) runs unchanged. Still checked against the
// admin's block rules: a deposit cannot provisionally hold a date that is
// blocked.
//
// Idempotent by date: if a slot already exists there -- an earlier request's
// hold expired and returned it to OPEN, say -- that row is reused instead of
// creating a duplicate.
function createRequestedSlot({ date, location = '' }) {
  const day = String(date || '').trim();
  if (!DATE_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00`))) {
    return { error: 'Date must be a calendar date in YYYY-MM-DD form.' };
  }
  if (isPastDate(day)) return { error: 'That date is in the past.' };

  const existing = readSlots().find(slot => slot.date === day);
  if (existing) {
    if (existing.status !== SLOT.OPEN) return { error: 'That day was just taken. Please pick another.', status: 409 };
    return { slotId: existing.id };
  }

  if (isBlocked(day)) {
    return { error: 'That date is not available. Please choose another, or ask about availability.', status: 409 };
  }

  const now = new Date().toISOString();
  const slot = appendSlot({
    id: randomUUID(),
    date: day,
    location: String(location || '').trim(),
    status: SLOT.OPEN,
    holdUntil: '',
    bookingId: '',
    createdAt: now,
    updatedAt: now
  });
  return { slotId: slot.id };
}

// Read-modify-write with no await inside, so the open -> held transition cannot
// interleave with another request in this process.
function holdSlot(slotId, { name, email, phone = '', notes = '', address = '', eventDescription = '', guestCount = '', packageId = '', addOnIds = [] }) {
  releaseExpiredHolds();
  const slots = readSlots();
  const index = slots.findIndex(slot => slot.id === String(slotId || ''));
  if (index < 0) return { error: 'That day is no longer available.', status: 404 };

  const slot = slots[index];
  if (slot.status !== SLOT.OPEN) return { error: 'That day has just been taken. Please pick another.', status: 409 };
  if (isPastSlot(slot)) return { error: 'That day has already passed.', status: 409 };
  // A page loaded before the admin added a block would still offer this day.
  if (slotIsBlocked(slot)) return { error: 'That day is no longer available. Please pick another.', status: 409 };

  const chosenPackage = findPackage(packageId);
  if (!chosenPackage) return { error: 'Please choose a package.', status: 400 };
  const chosenAddOns = resolveAddOns(addOnIds);

  const now = new Date();
  const deposit = reservationFee();
  const sessionFee = chosenPackage.priceCents + chosenAddOns.reduce((sum, addOn) => sum + addOn.priceCents, 0);
  const guests = Math.max(0, Math.round(Number(guestCount) || 0));
  const booking = appendBooking({
    id: randomUUID(),
    slotId: slot.id,
    date: slot.date,
    // The admin's override for the agreed arrival/start time, set after booking.
    agreedTime: '',
    location: slot.location || '',
    name: String(name || '').trim(),
    email: String(email || '').trim(),
    phone: String(phone || '').trim(),
    notes: String(notes || '').trim().slice(0, 2000),
    // Collected for the Rental Agreement (see rentalAgreement.js), not used
    // anywhere else in the booking flow.
    address: String(address || '').trim().slice(0, 400),
    eventDescription: String(eventDescription || '').trim().slice(0, 200),
    guestCount: guests || '',
    status: BOOKING.PENDING,
    // The rate-schedule package (and any add-ons) chosen at booking time,
    // frozen here just like the resulting price -- a later rate-schedule
    // edit must not rewrite what this customer already agreed to pay.
    packageName: chosenPackage.name,
    addOns: chosenAddOns.map(addOn => ({ name: addOn.name, priceCents: addOn.priceCents })),
    sessionFee,
    deposit,
    // The reservation fee is paid on top of the rental fee, not a prepayment
    // against it (see reservationFee()) -- the full rental fee is still due.
    balanceDue: sessionFee,
    // Frozen at booking time: changing the policy later must not rewrite the
    // terms this customer accepted.
    refundPolicy: refundPolicyText(),
    refundCutoffHours: refundCutoffHours(),
    orderId: '',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    confirmedAt: '',
    cancelledAt: ''
  });

  slots[index] = {
    ...slot,
    status: SLOT.HELD,
    holdUntil: new Date(now.getTime() + holdMinutes() * 60000).toISOString(),
    bookingId: booking.id,
    updatedAt: now.toISOString()
  };
  writeSlots(slots);
  return { booking, slot: slots[index] };
}

// The admin's counterpart to holdSlot() above: a reservation taken outside
// the site entirely (a phone call, cash, a walk-in) still has to occupy the
// day so it stops showing as bookable online. Skips the hold/Stripe/webhook
// pipeline and goes straight to a confirmed, booked day -- there is no
// deposit actually collected through this app, so the deposit/balance figures
// recorded are informational (what the admin still owes/has to collect) not
// a payment record.
//
// A block does not stop this: the admin is recording something that already
// happened, possibly on what is normally a closed weekday, so their say-so
// overrides it. The only real conflict is another booking (or an in-progress
// hold) already sitting on that date.
function createManualBooking({ date, location = '', name, email = '', phone = '', notes = '', address = '', eventDescription = '', guestCount = '', packageId = '', addOnIds = [] }) {
  const day = String(date || '').trim();
  if (!DATE_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00`))) {
    return { error: 'Date must be a calendar date in YYYY-MM-DD form.' };
  }
  if (isPastDate(day)) return { error: 'That date is in the past.' };

  const customerName = String(name || '').trim();
  if (customerName.length < 2) return { error: "Please enter the customer's name." };

  const chosenPackage = findPackage(packageId);
  if (!chosenPackage) return { error: 'Please choose a package.' };
  const chosenAddOns = resolveAddOns(addOnIds);

  const slots = readSlots();
  const index = slots.findIndex(slot => slot.date === day);
  if (index >= 0 && (slots[index].status === SLOT.BOOKED || slots[index].status === SLOT.HELD)) {
    return { error: 'That day is already booked or on hold.', status: 409 };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const slotId = index >= 0 ? slots[index].id : randomUUID();
  const deposit = reservationFee();
  const fee = chosenPackage.priceCents + chosenAddOns.reduce((sum, addOn) => sum + addOn.priceCents, 0);
  const guests = Math.max(0, Math.round(Number(guestCount) || 0));

  const booking = appendBooking({
    id: randomUUID(),
    slotId,
    date: day,
    agreedTime: '',
    location: String(location || '').trim(),
    name: customerName,
    email: String(email || '').trim(),
    phone: String(phone || '').trim(),
    notes: String(notes || '').trim().slice(0, 2000),
    address: String(address || '').trim().slice(0, 400),
    eventDescription: String(eventDescription || '').trim().slice(0, 200),
    guestCount: guests || '',
    status: BOOKING.CONFIRMED,
    packageName: chosenPackage.name,
    addOns: chosenAddOns.map(addOn => ({ name: addOn.name, priceCents: addOn.priceCents })),
    sessionFee: fee,
    deposit,
    // The reservation fee is paid on top of the rental fee, not a prepayment
    // against it (see reservationFee()) -- the full rental fee is still due.
    balanceDue: fee,
    refundPolicy: refundPolicyText(),
    refundCutoffHours: refundCutoffHours(),
    orderId: '',
    // Distinguishes a booking recorded by hand from one a visitor paid a
    // deposit for online -- shown as a badge in the admin bookings list.
    manual: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    confirmedAt: nowIso,
    cancelledAt: ''
  });

  const slotFields = {
    id: slotId,
    date: day,
    location: String(location || '').trim(),
    status: SLOT.BOOKED,
    holdUntil: '',
    bookingId: booking.id,
    updatedAt: nowIso
  };

  if (index >= 0) {
    slots[index] = { ...slots[index], ...slotFields };
    writeSlots(slots);
  } else {
    appendSlot({ ...slotFields, createdAt: nowIso });
  }

  return { booking, slot: slotFields };
}

function updateBooking(id, updater) {
  const bookings = readBookings();
  const index = bookings.findIndex(booking => booking.id === id);
  if (index < 0) return null;
  bookings[index] = { ...updater({ ...bookings[index] }), updatedAt: new Date().toISOString() };
  writeBookings(bookings);
  return bookings[index];
}

function updateSlot(id, updater) {
  const slots = readSlots();
  const index = slots.findIndex(slot => slot.id === id);
  if (index < 0) return null;
  slots[index] = { ...updater({ ...slots[index] }), updatedAt: new Date().toISOString() };
  writeSlots(slots);
  return slots[index];
}

function attachOrder(bookingId, orderId) {
  return updateBooking(bookingId, booking => ({ ...booking, orderId: String(orderId || '') }));
}

// Idempotent: a webhook retry must not double-confirm. Returns null if already
// confirmed.
function confirmBooking(bookingId) {
  const booking = findBooking(bookingId);
  if (!booking || booking.status === BOOKING.CONFIRMED) return null;
  const confirmed = updateBooking(bookingId, current => ({
    ...current,
    status: BOOKING.CONFIRMED,
    confirmedAt: new Date().toISOString()
  }));
  // A paid deposit outranks an expired hold: take the day even if the sweep
  // already released it, rather than leaving a paid booking without a date.
  updateSlot(booking.slotId, slot => ({ ...slot, status: SLOT.BOOKED, holdUntil: '', bookingId }));
  return confirmed;
}

function setAgreedTime(bookingId, agreedTime) {
  return updateBooking(bookingId, booking => ({ ...booking, agreedTime: String(agreedTime || '').trim().slice(0, 120) }));
}

function cancelBooking(bookingId, { releaseSlot = true } = {}) {
  const booking = findBooking(bookingId);
  if (!booking) return null;
  const cancelled = updateBooking(bookingId, current => ({
    ...current,
    status: BOOKING.CANCELLED,
    cancelledAt: new Date().toISOString()
  }));
  if (releaseSlot) {
    updateSlot(booking.slotId, slot => ({ ...slot, status: SLOT.OPEN, holdUntil: '', bookingId: '' }));
  }
  return cancelled;
}

function deleteSlot(slotId) {
  const slots = readSlots();
  const slot = slots.find(entry => entry.id === slotId);
  if (!slot) return { error: 'Slot not found.', status: 404 };
  if (slot.status === SLOT.BOOKED) return { error: 'That date is booked. Cancel the booking first.', status: 409 };
  // A held slot has a visitor mid-checkout on Stripe right now. Deleting it
  // out from under them would orphan their booking record -- confirmBooking()
  // updates a slot by id, so if this one is gone by the time they pay, the
  // deposit goes through but the day is never actually marked booked.
  if (slot.status === SLOT.HELD) return { error: 'That date is on hold while someone checks out. Try again shortly.', status: 409 };
  writeSlots(slots.filter(entry => entry.id !== slotId));
  return { ok: true };
}

// Whether the deposit is still refundable under the terms this booking was made
// under: a cooling-off window from when it was booked. Advisory only -- refunds
// are issued by hand in Stripe, never automatically.
function isRefundable(booking, now = Date.now()) {
  const hours = Number(booking?.refundCutoffHours);
  if (!Number.isFinite(hours) || hours === 0) return false;
  const bookedAt = Date.parse(booking?.confirmedAt || booking?.createdAt);
  if (!Number.isFinite(bookedAt)) return false;
  return now - bookedAt <= hours * 3600000;
}

module.exports = {
  SLOT,
  BOOKING,
  slotsFile,
  bookingsFile,
  blocksFile,
  unblocksFile,
  WEEKDAY_NAMES,
  ensureStore,
  reservationFee,
  depositFor,
  listBookablePackages,
  listAddOns,
  holdMinutes,
  refundCutoffHours,
  refundPolicyText,
  today,
  isPastDate,
  isPastSlot,
  releaseExpiredHolds,
  listOpenSlots,
  listUnavailableDates,
  listClosedWeekdays,
  listUnblockedDates,
  publicSlot,
  readSlots,
  readBookings,
  readBlocks,
  readUnblocks,
  createBlock,
  deleteBlock,
  createUnblock,
  unblockRange,
  deleteUnblock,
  unblockLabel,
  isUnblocked,
  isBlocked,
  slotIsBlocked,
  blockLabel,
  weekdayOf,
  findSlot,
  findBooking,
  createRequestedSlot,
  holdSlot,
  createManualBooking,
  attachOrder,
  updateBooking,
  updateSlot,
  confirmBooking,
  setAgreedTime,
  cancelBooking,
  deleteSlot,
  isRefundable
};
