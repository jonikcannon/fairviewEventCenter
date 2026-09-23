// Minimal RFC 5545 .ics builder for confirmed bookings -- one VEVENT shape,
// no recurrence/attendees/alarms, so a small hand-rolled builder is simpler
// than pulling in a calendar library for it.
//
// DTSTART/DTEND are emitted as "floating" local date-times (no Z suffix, no
// TZID/VTIMEZONE): booking.date and rentalAgreement.RENTAL_HOURS are already
// the venue's own wall-clock values ("9:00 AM" on a calendar day), so this
// reproduces them as-is rather than converting through a server timezone that
// may not even match the venue's (a VPS commonly runs on UTC system time).
// A calendar app renders a floating time in the *viewer's own* local
// timezone, which is correct for the common case of a local guest and is a
// deliberate simplification otherwise -- getting this exactly right for a
// remote guest would need full IANA timezone/DST handling, which isn't worth
// it for a one-VEVENT-at-a-time feature.
const { RENTAL_HOURS } = require('./rentalAgreement');

function pad(n) {
  return String(n).padStart(2, '0');
}

function toIcsDateTime(dateKey, time) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(time || '').trim());
  let hour = match ? Number(match[1]) % 12 : 0;
  const minute = match ? Number(match[2]) : 0;
  if (match && /pm/i.test(match[3])) hour += 12;
  return `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(minute)}00`;
}

function toUtcStamp(date) {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

function escapeText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 content lines over 75 octets should be folded with a leading
// space on each continuation line -- not critical for most readers, but
// keeps stricter parsers happy for a long SUMMARY/DESCRIPTION.
function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  parts.push(rest);
  return parts.join('\r\n');
}

function buildEvent(booking) {
  const description = [
    `Reservation for ${booking.name || 'guest'}`,
    booking.eventDescription ? `Event: ${booking.eventDescription}` : '',
    booking.agreedTime ? `Agreed arrival time: ${booking.agreedTime}` : '',
    `Confirmation code: ${booking.confirmationCode || ''}`
  ].filter(Boolean).join('\n');

  return [
    'BEGIN:VEVENT',
    `UID:booking-${booking.id}@fairview-event-center`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${toIcsDateTime(booking.date, RENTAL_HOURS.from)}`,
    `DTEND:${toIcsDateTime(booking.date, RENTAL_HOURS.to)}`,
    foldLine(`SUMMARY:${escapeText(`Fairview Event Center -- ${booking.packageName || 'Venue rental'}`)}`),
    foldLine(`DESCRIPTION:${escapeText(description)}`),
    booking.location ? foldLine(`LOCATION:${escapeText(booking.location)}`) : '',
    'STATUS:CONFIRMED',
    'END:VEVENT'
  ].filter(Boolean).join('\r\n');
}

function buildCalendar(bookings, { calendarName = 'Fairview Event Center Bookings' } = {}) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fairview Event Center//Bookings//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    bookings.map(buildEvent).join('\r\n'),
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n') + '\r\n';
}

module.exports = { buildEvent, buildCalendar };
