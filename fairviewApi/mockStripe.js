// A minimal stand-in for the `stripe` npm client, covering only what
// server.js actually calls (`checkout.sessions.create`) plus a fake hosted
// checkout page this module also renders. This lets the whole
// booking/order -> checkout -> "payment" -> fulfilment pipeline be exercised
// end to end before the client has a real Stripe account -- nothing here
// talks to Stripe or moves real money, and no card details are ever collected.
//
// Only ever constructed when MOCK_STRIPE=true and no STRIPE_SECRET_KEY is
// set (see server.js) -- the moment a real key is added, this module is
// never touched again, so there is no risk of it running alongside a real
// Stripe integration.

const { randomUUID } = require('crypto');

// In-memory only: mock sessions don't need to survive a restart, and never
// should be mistaken for real payment records.
const sessions = new Map();

function money(cents) {
  return `$${((Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createMockStripe({ baseUrl }) {
  return {
    checkout: {
      sessions: {
        create: async (params) => {
          const id = `mock_cs_${randomUUID()}`;
          const lineItems = params.line_items || [];
          const amountTotal = lineItems.reduce((sum, item) => {
            const unitAmount = item.price_data?.unit_amount || 0;
            return sum + unitAmount * (item.quantity || 1);
          }, 0);
          const session = {
            id,
            url: `${baseUrl}/api/mock-checkout/${id}`,
            metadata: params.metadata || {},
            client_reference_id: params.client_reference_id || '',
            customer_email: params.customer_email || '',
            customer_details: { email: params.customer_email || '' },
            amount_total: amountTotal,
            currency: 'usd',
            payment_intent: `mock_pi_${randomUUID()}`,
            status: 'open',
            success_url: params.success_url,
            cancel_url: params.cancel_url,
            lineItems
          };
          sessions.set(id, session);
          return session;
        }
      }
    }
  };
}

function getSession(id) {
  return sessions.get(String(id || '')) || null;
}

// Idempotent for the same reason bookingStore.confirmBooking/orderStore.markPaid
// are: nothing stops a test admin from double-clicking Pay or reloading the
// checkout tab after paying.
function markSessionComplete(id) {
  const session = sessions.get(String(id || ''));
  if (!session) return null;
  session.status = 'complete';
  return session;
}

function renderMockCheckoutPage(session) {
  const rows = (session.lineItems || []).map(item => {
    const name = item.price_data?.product_data?.name || 'Item';
    const description = item.price_data?.product_data?.description || '';
    const lineTotal = money((item.price_data?.unit_amount || 0) * (item.quantity || 1));
    return `<tr>
      <td><b>${escapeHtml(name)}</b>${description ? `<div class="desc">${escapeHtml(description)}</div>` : ''}</td>
      <td>${escapeHtml(String(item.quantity || 1))}</td>
      <td>${lineTotal}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Test Checkout (Mock Stripe)</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:60px auto;padding:0 24px;color:#1a1a1a}
  .banner{background:#fff3cd;border:1px solid #ffe69c;color:#664d03;padding:12px 16px;border-radius:6px;font-size:13px;margin-bottom:28px;line-height:1.5}
  h1{font-size:20px;margin-bottom:4px}
  .sub{color:#666;font-size:13px;margin:0 0 20px}
  table{width:100%;border-collapse:collapse;margin:20px 0}
  td{border-bottom:1px solid #ddd;padding:10px 4px;vertical-align:top;font-size:14px}
  .desc{color:#666;font-size:12px;margin-top:4px}
  .total{display:flex;justify-content:space-between;font-weight:bold;font-size:16px;margin:20px 0;padding-top:12px;border-top:2px solid #1a1a1a}
  button{width:100%;padding:14px;font-size:15px;border:0;border-radius:6px;cursor:pointer;margin-top:10px}
  .pay{background:#635bff;color:#fff}
  .cancel{display:block;text-align:center;padding:14px;margin-top:10px;color:#635bff;text-decoration:underline;font-size:14px}
  form{margin:0}
</style>
</head>
<body>
  <div class="banner">TEST MODE -- this is a mock checkout page standing in for Stripe. No real card is charged and no Stripe account is involved. Submitting "Pay" immediately marks this as paid so you can test what happens after payment.</div>
  <h1>Test Checkout</h1>
  <p class="sub">Session ${escapeHtml(session.id)}</p>
  <table><tbody>${rows}</tbody></table>
  <div class="total"><span>Total</span><span>${money(session.amount_total)}</span></div>
  <form method="post" action="/api/mock-checkout/${encodeURIComponent(session.id)}/complete">
    <button class="pay" type="submit">Pay ${money(session.amount_total)} (mock)</button>
  </form>
  <a class="cancel" href="${escapeHtml(session.cancel_url)}">Cancel</a>
</body>
</html>`;
}

// A plain 302 here would be simpler, but the CSP's `form-action 'self'`
// directive (see helmet() in server.js) blocks a form submission from being
// redirected cross-origin -- and success_url/cancel_url point at the
// frontend's own origin, not this API's. Serving a 200 page that redirects
// itself via JS/meta-refresh is a separate navigation from the browser's
// point of view, so form-action no longer applies to it.
function renderRedirectPage(url) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${escapeHtml(url)}">
<title>Redirecting…</title>
</head>
<body>
  <p>Payment complete -- redirecting… If nothing happens, <a href="${escapeHtml(url)}">click here</a>.</p>
  <script>window.location.replace(${JSON.stringify(url)});</script>
</body>
</html>`;
}

module.exports = { createMockStripe, getSession, markSessionComplete, renderMockCheckoutPage, renderRedirectPage };
