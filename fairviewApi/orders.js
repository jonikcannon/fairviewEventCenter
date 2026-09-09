// Order records for Stripe checkouts.
//
// An order is written BEFORE the customer is sent to Stripe, and its id travels
// as the session's metadata.orderId / client_reference_id. The webhook then
// looks the order up locally instead of trying to reconstruct it from the
// session. That matters for two reasons:
//
//   * Stripe metadata is capped (50 keys, 500 chars each). A cart of a dozen
//     photos, each needing a product id, an R2 object key and print options,
//     does not reliably fit. The local record has no such limit.
//   * Line items on a session carry only the display name we sent, so there is
//     no dependable way to map a paid line back to the file the buyer must
//     receive. Storing the object key up front removes the guesswork.
//
// Orders that are never paid simply stay `pending`, which doubles as an
// abandoned-checkout log.
//
// Storage mirrors inquiries: one JSON object per line, appended on write and
// rewritten in full on update. Fine at this volume and easy to inspect by hand.

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const ordersDir = path.join(__dirname, '../storage/orders');
const ordersFile = path.join(ordersDir, 'orders.jsonl');

const STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  CANCELLED: 'cancelled'
});

const FULFILMENT = Object.freeze({
  NONE: 'none',
  PENDING: 'pending',
  FULFILLED: 'fulfilled',
  FAILED: 'failed'
});

function ensureStore() {
  if (!fs.existsSync(ordersDir)) fs.mkdirSync(ordersDir, { recursive: true });
}

function parseLines(content) {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readOrders() {
  if (!fs.existsSync(ordersFile)) return [];
  return parseLines(fs.readFileSync(ordersFile, 'utf8'));
}

function writeOrders(orders) {
  ensureStore();
  const next = orders.map(order => JSON.stringify(order)).join('\n');
  fs.writeFileSync(ordersFile, next ? `${next}\n` : '', 'utf8');
}

function appendOrder(order) {
  ensureStore();
  fs.appendFileSync(ordersFile, `${JSON.stringify(order)}\n`, 'utf8');
  return order;
}

function findOrderById(id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  return readOrders().find(order => order.id === wanted) || null;
}

function findOrderBySession(sessionId) {
  const wanted = String(sessionId || '').trim();
  if (!wanted) return null;
  return readOrders().find(order => order.stripeSessionId === wanted) || null;
}

function updateOrderById(id, updater) {
  const orders = readOrders();
  const index = orders.findIndex(order => order.id === id);
  if (index < 0) return null;
  const updated = { ...updater({ ...orders[index] }), updatedAt: new Date().toISOString() };
  orders[index] = updated;
  writeOrders(orders);
  return updated;
}

// `items` carry everything fulfilment needs, resolved while we still have the
// product in hand: the object key to deliver, the print options to hand to a
// lab, and the amount actually charged.
function createPendingOrder({ kind = 'shop', email = '', items = [], metadata = {} }) {
  const now = new Date().toISOString();
  const order = {
    id: randomUUID(),
    kind,
    status: STATUS.PENDING,
    email: String(email || '').trim(),
    items,
    amountTotal: items.reduce((total, item) => total + (item.unitAmount || 0) * (item.quantity || 1), 0),
    currency: 'usd',
    metadata,
    stripeSessionId: '',
    stripePaymentIntentId: '',
    // Digital delivery and physical fulfilment are tracked separately: an order
    // can contain both, and one succeeding must not mask the other failing.
    delivery: { status: hasDigital(items) ? FULFILMENT.PENDING : FULFILMENT.NONE, sentAt: '', downloads: 0, error: '' },
    fulfilment: { status: hasPhysical(items) ? FULFILMENT.PENDING : FULFILMENT.NONE, provider: '', reference: '', error: '' },
    paidAt: '',
    createdAt: now,
    updatedAt: now
  };
  return appendOrder(order);
}

function hasDigital(items) {
  return items.some(item => item.deliverDigital);
}

function hasPhysical(items) {
  return items.some(item => item.isPrint || item.printSize);
}

function attachSession(orderId, sessionId) {
  return updateOrderById(orderId, order => ({ ...order, stripeSessionId: String(sessionId || '') }));
}

// Idempotent: Stripe retries webhooks, and a retry must not re-send files or
// re-submit a print job. Returns null when the order is already paid.
function markPaid(orderId, { sessionId = '', paymentIntentId = '', email = '', amountTotal = 0, currency = 'usd' } = {}) {
  const existing = findOrderById(orderId);
  if (!existing || existing.status === STATUS.PAID) return null;
  return updateOrderById(orderId, order => ({
    ...order,
    status: STATUS.PAID,
    stripeSessionId: String(sessionId || order.stripeSessionId || ''),
    stripePaymentIntentId: String(paymentIntentId || ''),
    email: String(email || order.email || ''),
    amountTotal: amountTotal || order.amountTotal,
    currency: currency || order.currency,
    paidAt: new Date().toISOString()
  }));
}

function setDelivery(orderId, patch) {
  return updateOrderById(orderId, order => ({ ...order, delivery: { ...order.delivery, ...patch } }));
}

function setFulfilment(orderId, patch) {
  return updateOrderById(orderId, order => ({ ...order, fulfilment: { ...order.fulfilment, ...patch } }));
}

function countDownload(orderId, itemIndex) {
  return updateOrderById(orderId, order => {
    const items = order.items.map((item, index) => (
      index === itemIndex ? { ...item, downloads: (item.downloads || 0) + 1 } : item
    ));
    return { ...order, items, delivery: { ...order.delivery, downloads: (order.delivery.downloads || 0) + 1 } };
  });
}

module.exports = {
  STATUS,
  FULFILMENT,
  ordersFile,
  ensureStore,
  readOrders,
  writeOrders,
  findOrderById,
  findOrderBySession,
  updateOrderById,
  createPendingOrder,
  attachSession,
  markPaid,
  setDelivery,
  setFulfilment,
  countDownload,
  hasDigital,
  hasPhysical
};
