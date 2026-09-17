// Renders the Rental Agreement (the business's real paper contract) as a
// standalone, printable HTML document for one confirmed booking. Generated
// on demand from the booking record rather than stored: every field it needs
// (sessionFee, deposit, refundPolicy, etc.) is already frozen on the booking
// at hold/confirm time, so re-rendering later always reproduces the same
// document -- there is nothing to snapshot.
//
// This is boilerplate legal text, not site content -- it lives here rather
// than in content.js/site-content.json, and is not admin-editable.

const BUSINESS = {
  name: 'GREATER HARVEST-FAIRVIEW COMMUNITY CENTER',
  address: '1053 PANOLA ROAD, ELLENWOOD, GA 30294',
  phone: '770-981-0774'
};

// The whole-day rental window is a fixed business rule (see eventSpaceFee()
// in booking.js) -- there is only one thing to book, for these hours.
const RENTAL_HOURS = { from: '9:00 AM', to: '10:00 PM' };

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(cents) {
  return `$${((Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// The booking's `date` field is a plain YYYY-MM-DD calendar day (see
// booking.js's parseDateKey comment on why this is never parsed as UTC).
function formatEventDate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return String(value || '—');
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function addressLines(address) {
  const lines = String(address || '').split('\n').map(line => line.trim()).filter(Boolean);
  return lines.length ? lines.map(line => `<div>${escapeHtml(line)}</div>`).join('') : '<div>—</div>';
}

// Verbatim from the paper agreement, minus the per-booking header/receipt
// fields above it and the address/name -- those render separately so this
// stays pure boilerplate.
const CLAUSES = [
  `Reservations: A Reservation Fee/Security Deposit of ${'{{reservationFee}}'} is required at the time of signing the Rental Agreement to confirm and secure the event date. The Reservation Fee is non-refundable.<br><br>The Security Deposit is refundable, provided there are no damages or excessive trash left in the facility or on the premises at the end of your rental period based on the terms and conditions of this Rental Agreement. Please allow up to 15 days for the Security Deposit refund.`,
  `Cancellation Policy: Reservation Fees and any Add-on Items are Non-Refundable. All cancellations made thirty (30) days prior to your scheduled event will result in the loss of Fifty (50) percent of the Paid rental fees. Cancellations made less than 30 days prior to your scheduled event will result in the loss of One hundred percent of the Paid rental fees. Security Deposits, Reservation Fees, and Rental Fees are non-refundable due to acts of nature, such as inclement weather. Event Date Change Policy: Reserved event dates that are changed after the reservation has been confirmed will be subject to a $50.00 Change Fee. Please Reserve Carefully!`,
  `Payment Terms: All rental fee payments are due Thirty (30) days prior to the Event Date. Payments are accepted in the form of Cash, Cashier's Check, Money Orders, and Personal Checks. Payments made less than 30 days prior to the event date must be paid in Cash. If final payment is not received at least 30 days prior to the scheduled event date, you will be in default for non-payment and Greater Harvest-Fairview Community Center will cancel the event reservation.`,
  `Returned Check Policy: Any check that is returned for insufficient funds will be assessed a $50.00 handling fee. All future payments must be made by Cashier's Check, Money Order or Cash.`,
  `Decorations: You are welcome to decorate the center for your event; however, we do not permit the use of nails, staples, glue, permanent tape, etc, to hang items on the walls. We do not allow glitter, rice, or birdseed to be used on the interior or exterior of the building as they are extremely difficult to clean up. Balloons used inside the building must be secured at all times. There will be a $50.00 Fee deducted from your Security Deposit Refund if balloon(s) are released and entangled in the ceiling fans or ceiling inside the building.`,
  `Pets: For the health and safety of all clients and guests, animals and pets are NOT allowed in the building or on the premises for sanitary purposes. ADA approved Seeing Eye animals are excluded from this clause and are permitted according to law.`,
  `Excessive Trash: There will be a loss of the Rental Deposit for excessive trash left in the facility or on the premises at the end of the client's rental period. Excessive Trash includes bottles, cigarette butts, food, candy wrappers, paper goods, etc, left on the floor of the building, property grounds and parking lots. All trash is to be deposited inside plastic garbage bags and deposited inside the Trash Dumpster located at the rear of the parking lot.<br><br>You are required to provide your own trash bags (50 Gallon Capacity) and dump all trash at the end of your rental period. Please remember to clean and replace the liners of all trash cans located in the kitchen and restrooms.`,
  `Tables may be rearranged while using the building, but they must be setup in the same position and manner as they were at the beginning of your rental period before you leave the building. Do not stack tables or chairs against the walls of the building as they will damage the walls.`,
  `The floors, kitchen, tables and restrooms must be cleaned at the end of your rental period. Any food items, drinks, or other matter spilled on the floors or tables must be cleaned up. A broom, mop and clean water bucket is located in the kitchen. If the stove is used (for food warm-up only) it must be turned off and all kitchen appliances and sinks cleaned at the end of your rental period. All lights and appliances must be turned off when you leave the facility, including all restroom lights and Heat & Air Conditioners.`,
  `Your Rental Period begins based upon your rental rate and time of day. If you would like to enter the facility before your rental period, there will be a $50.00 charge per hour before 9:00 am. If you would like to extend your rental period beyond 11:00 pm, there will be a $50.00 charge per hour after 11:00 pm.`,
  `Please keep the exit doors closed as much as possible while the building is being used to conserve energy.`,
  `Access to the building will be granted to the Signer of this Rental Agreement. Remember to lock the lower lock on the front door to secure and exit the building. After your rental period has ended, an inspection of the building will be completed and your deposit refund amount determined. Your deposit will be mailed to the person who has signed the contract. Please allow up to 15 business days to receive your Security Deposit Refund.`,
  `Greater Harvest-Fairview Community Center assumes no liability for the health, safety or welfare of the renter or participants of the renter's event. Use of the facility, equipment, grounds, and appliances is completely at the risk of the renter and their event participants. Greater Harvest-Fairview Community Center will not accept responsibility or liability for any Personal Injury, Covid-19 or Corona Virus, Disability, Loss of Use or Death claim made by the renter or any of the renter's event participants. If the renter will be performing or conducting activities that may be hazardous to a person's health or places them at risk of injury, the renter is expected to insure against such injury claims and completely indemnify Greater Harvest-Fairview Community Center against such claims. Only Adults 21 years of age or older may execute this Rental Agreement.`,
  `The term "Covid-19 or Corona Virus" refers to the widespread virus that resulted in a global pandemic and many federal, state, and local orders that declared a state of emergency and closed many businesses and facilities. As State and local health guidelines are issued which permit non-critical businesses to reopen to perform basic operations under certain specified conditions, the Renter, Occupants, and Guests understand and agree to follow such guidelines when accessing, entering, or using common areas, facilities, amenities, and all places within the Fairview Community Center property. This may include the use of Face Masks and Hand Gloves, if appropriate.`,
  `No Alcoholic Beverages are to be served or consumed on the premises or in the building.`,
  `No Smoking is permitted inside the building. Greater Harvest-Fairview Community Center is designated as a "Smoke-Free Environment". Guest smoking receptacles are located outside the front entrance of the building. Customers are asked to park all vehicles in the paved parking lots only. Damage to the grass, water sprinklers, or neighbor's property will be the responsibility of the renter. Vehicles parked on non-paved areas or neighbor's property will be towed away at the owner's expense.`
];

function generateAgreementHtml(booking) {
  const reservationFeeText = money(booking.deposit);
  const clausesHtml = CLAUSES
    .map((clause, index) => `<li>${clause.replace('{{reservationFee}}', reservationFeeText)}</li>`)
    .join('\n');

  const reservationPaid = booking.status === 'confirmed';
  const totalCharged = (Number(booking.sessionFee) || 0) + (Number(booking.deposit) || 0);
  const totalPaid = reservationPaid ? (Number(booking.deposit) || 0) : 0;
  const totalBalance = totalCharged - totalPaid;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Rental Agreement — ${escapeHtml(booking.name)} — ${escapeHtml(booking.date)}</title>
<style>
  :root{color-scheme:light}
  body{font-family:Georgia,'Times New Roman',serif;max-width:760px;margin:0 auto;padding:40px 32px 64px;color:#1a1a1a;background:#fff;line-height:1.5}
  h1,h2{font-family:Arial,Helvetica,sans-serif}
  .letterhead{text-align:center;font-family:Arial,Helvetica,sans-serif;font-weight:700;letter-spacing:.04em;font-size:14px}
  .letterhead div{margin-top:2px}
  h1{text-align:center;font-size:20px;letter-spacing:.08em;margin:28px 0 24px}
  .header-grid{display:flex;justify-content:space-between;gap:24px;margin-bottom:8px}
  .header-grid .right{text-align:right}
  .party-block{margin:18px 0 26px}
  .fee-line{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:15px;margin:22px 0}
  .sign-block{font-family:Arial,Helvetica,sans-serif;font-size:13px;margin:22px 0;display:grid;gap:10px;grid-template-columns:1fr 1fr}
  .sign-block div{border-bottom:1px solid #999;padding-bottom:4px}
  .meta-grid{font-family:Arial,Helvetica,sans-serif;font-size:13px;margin:22px 0;display:grid;gap:8px}
  ol{padding-left:22px;margin:24px 0}
  ol li{margin-bottom:16px;font-size:13.5px;text-align:justify}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:13px}
  th,td{border:1px solid #999;padding:8px 10px;text-align:left}
  th{background:#eee}
  tfoot td{font-weight:700}
  .print-bar{position:sticky;top:0;background:#f4f2ec;border-bottom:1px solid #ccc;padding:10px 32px;display:flex;justify-content:flex-end;gap:10px}
  .print-bar button{border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;padding:8px 14px;font:12px Arial,Helvetica,sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
  @media print{.print-bar{display:none}body{padding:0 24px}}
</style>
</head>
<body>
  <div class="print-bar"><button onclick="window.print()">Print / Save as PDF</button></div>

  <div class="letterhead">
    <div>${escapeHtml(BUSINESS.name)}</div>
    <div>${escapeHtml(BUSINESS.address)}</div>
    <div>${escapeHtml(BUSINESS.phone)}</div>
  </div>
  <h1>RENTAL AGREEMENT</h1>

  <div class="header-grid">
    <div class="party-block">
      <div><b>${escapeHtml(booking.name)}</b></div>
      ${addressLines(booking.address)}
    </div>
    <div class="right meta-grid">
      <div>Contact Tel. #: ${escapeHtml(booking.phone || '—')}</div>
      <div>Event Date: <b>${formatEventDate(booking.date)}</b></div>
      <div>Email: ${escapeHtml(booking.email)}</div>
    </div>
  </div>

  <div class="fee-line">TOTAL RENTAL FEE: ${money(booking.sessionFee)} &nbsp;&nbsp;Due 30 days before your event date.</div>

  <div class="sign-block">
    <div>Client Signature:</div>
    <div>Date:</div>
    <div>FCC Signature:</div>
    <div>Date:</div>
  </div>

  <div class="meta-grid">
    <div>Package: ${escapeHtml(booking.packageName || '—')}</div>
    <div>Add-ons: ${(booking.addOns || []).length ? escapeHtml(booking.addOns.map(addOn => addOn.name).join(', ')) : '—'}</div>
    <div>Event Description: ${escapeHtml(booking.eventDescription || '—')}</div>
    <div>Number of Guests Planned: ${escapeHtml(booking.guestCount || '—')}</div>
    <div>Comment: ${escapeHtml(booking.notes || '—')}</div>
    <div>Rental Hours From: ${RENTAL_HOURS.from} To: ${RENTAL_HOURS.to}</div>
  </div>

  <ol>
    ${clausesHtml}
  </ol>

  <h2>Receipt / Statement</h2>
  <table>
    <thead>
      <tr><th>Description</th><th>Transaction Date</th><th>Fee Charged</th><th>Amount Paid</th><th>Balance Due</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>Rental Deposit Fee</td>
        <td>${formatDate(booking.confirmedAt || booking.createdAt)}</td>
        <td>${money(booking.deposit)}</td>
        <td>${reservationPaid ? money(booking.deposit) : money(0)}</td>
        <td>${reservationPaid ? money(0) : money(booking.deposit)}</td>
      </tr>
      <tr>
        <td>Rental Fee</td>
        <td>${formatEventDate(booking.date)}</td>
        <td>${money(booking.sessionFee)}</td>
        <td>${money(0)}</td>
        <td>${money(booking.sessionFee)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr><td>Balance</td><td></td><td>${money(totalCharged)}</td><td>${money(totalPaid)}</td><td>${money(totalBalance)}</td></tr>
    </tfoot>
  </table>
</body>
</html>`;
}

// Fake booking data an admin can use to sanity-check the template renders
// correctly (new clause wording, layout changes, etc.) without needing a
// real confirmed booking to test against. Values mirror the business's own
// sample agreement (docs/Rental Agreement Sample.docx) so the rendered
// output can be compared directly against it.
function buildSampleBooking() {
  const now = new Date();
  const eventDate = new Date(now.getFullYear() + 1, 11, 31);
  const pad = n => String(n).padStart(2, '0');
  return {
    id: 'sample',
    name: 'Joe Sample',
    email: 'myemail1234@gmail.com',
    phone: '555-123-4567',
    address: '123 Any Street\nAnytown, GA 30294',
    date: `${eventDate.getFullYear()}-${pad(eventDate.getMonth() + 1)}-${pad(eventDate.getDate())}`,
    eventDescription: 'Family Day',
    guestCount: '100',
    notes: 'Sample booking generated for testing the rental agreement template.',
    packageName: 'Standard Package (All Day)',
    addOns: [],
    sessionFee: 175000,
    deposit: 17500,
    status: 'confirmed',
    confirmedAt: now.toISOString(),
    createdAt: now.toISOString()
  };
}

module.exports = { generateAgreementHtml, buildSampleBooking };
