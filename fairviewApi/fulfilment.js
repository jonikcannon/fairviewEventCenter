// Print fulfilment, kept behind a single narrow interface.
//
// A provider is just:  async submit(order, items) -> { reference, status, notes }
//
// The default `manual` provider records the job and emails the studio what to
// print, so physical orders are captured from day one without an account
// anywhere. Wiring a real lab later (Prodigi, Printful, a local printer with an
// API) means adding one entry to PROVIDERS and setting PRINT_PROVIDER -- no
// changes in the webhook or the order store, because both only ever see this
// interface.
//
// Deliberately no auto-retry here: a print job that silently submits twice
// costs real money and produces a duplicate physical package. Failures are
// recorded on the order as `failed` with the reason, for the studio to retry
// by hand from the admin view.

const PRINT_SIZE_LABELS = {
  '4x6': '4 x 6 in',
  '5x7': '5 x 7 in',
  '6x8': '6 x 8 in',
  '8x10': '8 x 10 in',
  '8x11': '8 x 11 in'
};

function describeItem(item) {
  const size = PRINT_SIZE_LABELS[item.printSize] || item.printSize || 'unspecified size';
  return `${item.quantity} x ${size} - ${item.title || item.sku || item.productId}`;
}

// Every provider receives the same shape, so the studio-facing summary is
// identical whoever prints it.
function buildJobSummary(order, items) {
  return [
    `Order: ${order.id}`,
    `Placed: ${order.paidAt || order.createdAt}`,
    `Customer: ${order.email || 'not supplied'}`,
    '',
    'Print items:',
    ...items.map(item => `  - ${describeItem(item)}`),
    '',
    'Source files:',
    ...items.map(item => `  - ${item.imageKey || 'no object key recorded'}`)
  ].join('\n');
}

const PROVIDERS = {
  // Records the job and lets the caller notify the studio. No external call, so
  // it cannot fail for network reasons -- physical orders are never lost just
  // because a lab API is down or not yet configured.
  manual: {
    name: 'manual',
    async submit(order, items) {
      return {
        reference: `manual-${order.id.slice(0, 8)}`,
        status: 'accepted',
        notes: buildJobSummary(order, items)
      };
    }
  }
};

function resolveProviderName() {
  const configured = String(process.env.PRINT_PROVIDER || '').trim().toLowerCase();
  if (!configured) return 'manual';
  if (!PROVIDERS[configured]) {
    console.warn(`PRINT_PROVIDER="${configured}" is not a known provider; falling back to manual fulfilment.`);
    return 'manual';
  }
  return configured;
}

function getProvider() {
  return PROVIDERS[resolveProviderName()];
}

function listProviders() {
  return Object.keys(PROVIDERS);
}

// Physical items only. Digital-only orders never reach a print provider.
function selectPrintItems(order) {
  return (order.items || []).filter(item => item.isPrint || item.printSize);
}

async function submitPrintJob(order) {
  const items = selectPrintItems(order);
  if (!items.length) return null;

  const provider = getProvider();
  try {
    const result = await provider.submit(order, items);
    return { provider: provider.name, reference: result.reference || '', status: result.status || 'accepted', notes: result.notes || '', error: '' };
  } catch (error) {
    console.error('Print fulfilment failed:', error?.message || error);
    return { provider: provider.name, reference: '', status: 'failed', notes: '', error: String(error?.message || error) };
  }
}

module.exports = {
  PRINT_SIZE_LABELS,
  PROVIDERS,
  buildJobSummary,
  describeItem,
  getProvider,
  listProviders,
  selectPrintItems,
  submitPrintJob
};
