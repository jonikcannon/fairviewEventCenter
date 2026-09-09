require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Stripe = require('stripe');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const app = express();
const port = process.env.PORT || 3500;
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:6200';
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

const uploadsDir = path.join(__dirname, '../storage/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const inquiriesDir = path.join(__dirname, '../storage/inquiries');
if (!fs.existsSync(inquiriesDir)) fs.mkdirSync(inquiriesDir, { recursive: true });
const productsDir = path.join(__dirname, '../storage/products');
if (!fs.existsSync(productsDir)) fs.mkdirSync(productsDir, { recursive: true });
const { resolveMediaDir, CATEGORIES } = require('../scripts/media-dir');
const {
  config: r2Config, isR2Configured, isCdnEnabled, createR2Client,
  toObjectKey: toR2Key, toPublicUrl: toR2Url
} = require('../scripts/r2');
const galleryDir = resolveMediaDir();
if (!fs.existsSync(galleryDir)) fs.mkdirSync(galleryDir, { recursive: true });
const galleryManifestPath = path.join(galleryDir, 'gallery-manifest.json');

const inquiriesLogFile = path.join(inquiriesDir, 'contact-inquiries.jsonl');

const orderStore = require('./orders');
const fulfilment = require('./fulfilment');
const bookingStore = require('./booking');
const siteContent = require('./content');
orderStore.ensureStore();
bookingStore.ensureStore();

// Clean, unwatermarked masters live under `originals/`; the public gallery keeps
// serving `assets/gallery/`. Until the watermarking pass has run there is no
// `originals/` copy yet, so delivery falls back to the gallery key -- that keeps
// purchases working during the migration instead of 404ing.
const ORIGINALS_PREFIX = 'originals/';

function toOriginalKey(galleryKey) {
  return String(galleryKey || '').replace(/^assets\/gallery\//, ORIGINALS_PREFIX);
}

// Download links are signed rather than guessable: the token names the order and
// the line item, so a link cannot be edited to reach a file that was not bought.
function buildDownloadToken(orderId, itemIndex) {
  return jwt.sign({ orderId, itemIndex }, process.env.JWT_SECRET, {
    expiresIn: String(process.env.DOWNLOAD_TOKEN_TTL || '30d').trim() || '30d',
    issuer: 'fairviewApi',
    audience: 'fairview-download'
  });
}

function buildDownloadUrl(orderId, itemIndex) {
  return `${origin.replace(/\/$/, '')}/api/download/${encodeURIComponent(buildDownloadToken(orderId, itemIndex))}`;
}

// Resolve the object the buyer is owed: the master if it exists, else the
// gallery copy. Returns null when neither is present.
async function fetchOriginalObject(galleryKey) {
  if (!r2Client) return null;
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  for (const key of [toOriginalKey(galleryKey), galleryKey]) {
    if (!key) continue;
    try {
      const object = await r2Client.send(new GetObjectCommand({ Bucket: r2Config.bucket, Key: key }));
      return { key, body: object.Body, contentType: object.ContentType, contentLength: object.ContentLength };
    } catch (error) {
      if (error?.name !== 'NoSuchKey' && error?.$metadata?.httpStatusCode !== 404) {
        console.error(`R2 read failed for ${key}:`, error?.message || error);
      }
    }
  }
  return null;
}

// Everything fulfilment needs, captured while the product is still in hand.
function buildOrderItem(product, quantity, entry = {}) {
  const galleryKey = toGalleryRelativeImage(product.image);
  const printSize = String(entry.printSize || '').trim();
  const orderType = String(entry.orderType || '').trim();
  // Either signal marks the line as physical. Relying on printSize alone would
  // misfile a print sale as digital if the size ever failed to reach us.
  const isPrint = Boolean(printSize) || orderType === 'print';
  // A print always ships; a digital file is delivered when it was bought on its
  // own or explicitly bundled with the print.
  const deliverDigital = !isPrint || entry.includeDigitalCopy === true || orderType === 'digital';
  return {
    productId: String(product.id || ''),
    sku: String(product.sku || ''),
    title: String(product.title || ''),
    mediaType: product.mediaType === 'video' ? 'video' : 'image',
    imageKey: galleryKey,
    quantity,
    unitAmount: Number(product.price) || 0,
    orderType,
    isPrint,
    printSize: printSize || '',
    printUnitPrice: Number(entry.printUnitPrice) || 0,
    deliverDigital,
    downloads: 0
  };
}

async function sendOrderEmails(order) {
  const transporter = getMailer();
  const from = String(process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER || '').trim();
  const studio = String(process.env.CONTACT_TO_EMAIL || process.env.ADMIN_EMAIL || '').trim();
  if (!transporter || !from) return { customer: false, studio: false };

  const digitalItems = order.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.deliverDigital && item.imageKey);

  let customerSent = false;
  if (order.email && digitalItems.length) {
    const links = digitalItems.map(({ item, index }) => `${item.title}\n${buildDownloadUrl(order.id, index)}`);
    await transporter.sendMail({
      from,
      to: order.email,
      subject: 'Your Fairview Event Center download',
      text: [
        'Thank you for your purchase.',
        '',
        `Order: ${order.id}`,
        '',
        'Your files are ready. These links are personal to this order:',
        '',
        ...links,
        '',
        `Links stay valid for ${String(process.env.DOWNLOAD_TOKEN_TTL || '30d')}. Reply to this email if you need them reissued.`
      ].join('\n')
    });
    customerSent = true;
  }

  let studioSent = false;
  if (studio) {
    const printItems = fulfilment.selectPrintItems(order);
    await transporter.sendMail({
      from,
      to: studio,
      replyTo: order.email || undefined,
      subject: `[Fairview Event Center] Paid order ${order.id.slice(0, 8)}${printItems.length ? ' (print)' : ''}`,
      text: [
        `Order: ${order.id}`,
        `Customer: ${order.email || 'not supplied'}`,
        `Total: $${(order.amountTotal / 100).toFixed(2)} ${String(order.currency || 'usd').toUpperCase()}`,
        `Paid: ${order.paidAt}`,
        '',
        'Items:',
        ...order.items.map(item => `  - ${item.quantity} x ${item.title}${item.printSize ? ` (print ${item.printSize})` : ' (digital)'}`),
        ...(printItems.length ? ['', 'PRINT JOB', fulfilment.buildJobSummary(order, printItems)] : [])
      ].join('\n')
    });
    studioSent = true;
  }

  return { customer: customerSent, studio: studioSent };
}

function formatMoney(cents, currency = 'usd') {
  return `$${((Number(cents) || 0) / 100).toFixed(2)} ${String(currency).toUpperCase()}`;
}

async function sendBookingEmails(booking) {
  const transporter = getMailer();
  const from = String(process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER || '').trim();
  const studio = String(process.env.CONTACT_TO_EMAIL || process.env.ADMIN_EMAIL || '').trim();
  if (!transporter || !from) return false;

  const lines = [
    `Service: ${booking.service}`,
    `Date: ${booking.date}`,
    // agreedTime wins: if the studio has already moved the shoot by hand, that
    // is the time the client needs to see, not the one they picked at checkout.
    `Start time: ${booking.agreedTime || booking.startTime || 'to be agreed'}`,
    booking.location ? `Location: ${booking.location}` : '',
    `Session fee: ${formatMoney(booking.sessionFee)}`,
    `Deposit paid: ${formatMoney(booking.deposit)}`,
    `Balance due on the day: ${formatMoney(booking.balanceDue)}`
  ].filter(Boolean);

  if (booking.email) {
    await transporter.sendMail({
      from,
      to: booking.email,
      replyTo: studio || undefined,
      subject: `Your Fairview Event Center booking on ${booking.date}`,
      text: [
        `Thank you ${booking.name || ''}`.trim() + ',',
        '',
        'Your session is reserved. We will be in touch if anything needs to move.',
        '',
        ...lines,
        '',
        `Reference: ${booking.id}`,
        '',
        booking.refundPolicy
      ].join('\n')
    });
  }

  if (studio) {
    await transporter.sendMail({
      from,
      to: studio,
      replyTo: booking.email || undefined,
      subject: `[Fairview Event Center] Booking confirmed - ${booking.service} on ${booking.date}`,
      text: [
        `Booking: ${booking.id}`,
        `Client: ${booking.name || 'not supplied'} <${booking.email || 'no email'}>`,
        booking.phone ? `Phone: ${booking.phone}` : '',
        '',
        ...lines,
        '',
        booking.notes ? `Notes:\n${booking.notes}` : 'No notes supplied.',
        '',
        'The client booked this start time. Use the admin panel to move it if needed.'
      ].filter(Boolean).join('\n')
    });
  }

  return Boolean(booking.email);
}

// Runs after payment. Split so a webhook retry can re-run only the part that
// has not succeeded yet.
async function fulfilOrder(order) {
  let current = order;

  if (current.kind === 'booking') {
    const bookingId = String(current.metadata?.bookingId || '');
    // confirmBooking is idempotent, so a webhook retry cannot double-book.
    const confirmed = bookingStore.confirmBooking(bookingId);
    if (confirmed) {
      try {
        const sent = await sendBookingEmails(confirmed);
        orderStore.setDelivery(current.id, {
          status: sent ? orderStore.FULFILMENT.FULFILLED : orderStore.FULFILMENT.FAILED,
          sentAt: sent ? new Date().toISOString() : '',
          error: sent ? '' : 'No mailer configured or no client email on the booking.'
        });
      } catch (error) {
        console.error('Booking confirmation email failed:', error?.message || error);
        orderStore.setDelivery(current.id, { status: orderStore.FULFILMENT.FAILED, error: String(error?.message || error) });
      }
    }
    return orderStore.findOrderById(current.id) || current;
  }

  if (current.fulfilment.status === orderStore.FULFILMENT.PENDING) {
    const result = await fulfilment.submitPrintJob(current);
    if (result) {
      current = orderStore.setFulfilment(current.id, {
        status: result.status === 'failed' ? orderStore.FULFILMENT.FAILED : orderStore.FULFILMENT.FULFILLED,
        provider: result.provider,
        reference: result.reference,
        error: result.error
      }) || current;
    }
  }

  if (current.delivery.status === orderStore.FULFILMENT.PENDING) {
    try {
      const sent = await sendOrderEmails(current);
      current = orderStore.setDelivery(current.id, {
        status: sent.customer ? orderStore.FULFILMENT.FULFILLED : orderStore.FULFILMENT.FAILED,
        sentAt: sent.customer ? new Date().toISOString() : '',
        error: sent.customer ? '' : 'No mailer configured or no customer email on the order.'
      }) || current;
    } catch (error) {
      console.error('Order delivery email failed:', error?.message || error);
      orderStore.setDelivery(current.id, { status: orderStore.FULFILMENT.FAILED, error: String(error?.message || error) });
    }
  } else if (current.delivery.status === orderStore.FULFILMENT.NONE) {
    // Physical-only order: still tell the studio it sold.
    try { await sendOrderEmails(current); } catch (error) { console.error('Studio notification failed:', error?.message || error); }
  }

  return current;
}
const productsFile = path.join(productsDir, 'products.json');
let products = [];
let mailTransporter;
let mediaStorageReady = false;

const googleMediaConfig = {
  folderId: String(process.env.GOOGLE_MEDIA_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim(),
  serviceAccountJson: String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim(),
  tokenTtl: String(process.env.GOOGLE_MEDIA_TOKEN_TTL || '12h').trim() || '12h'
};

function getGoogleServiceAccountCredentials() {
  if (!googleMediaConfig.serviceAccountJson) return null;
  try {
    return JSON.parse(googleMediaConfig.serviceAccountJson);
  } catch (error) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.', error.message || error);
    return null;
  }
}

function createGoogleDriveClient() {
  if (!googleMediaConfig.folderId) return null;
  const credentials = getGoogleServiceAccountCredentials();
  if (!credentials?.client_email || !credentials?.private_key) return null;

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  return google.drive({ version: 'v3', auth });
}

const driveClient = createGoogleDriveClient();

function canUseGoogleDriveMedia() {
  return Boolean(driveClient && googleMediaConfig.folderId);
}

function buildMediaProxyPath(fileId, mimeType) {
  const token = jwt.sign({
    provider: 'gdrive',
    fileId,
    mimeType: String(mimeType || '').trim()
  }, process.env.JWT_SECRET, {
    expiresIn: googleMediaConfig.tokenTtl,
    issuer: 'fairviewApi',
    audience: 'fairview-media'
  });
  return `/api/media/${encodeURIComponent(token)}`;
}

function resolveProductImageForResponse(product) {
  const normalized = ensureSku(product);
  if (normalized?.storageProvider === 'gdrive' && normalized?.driveFileId) {
    return {
      ...normalized,
      image: buildMediaProxyPath(normalized.driveFileId, normalized.driveMimeType || normalized.mediaMimeType || '')
    };
  }
  return normalized;
}

function readProductsFromDisk() {
  if (!fs.existsSync(productsFile)) return [];
  try {
    const raw = fs.readFileSync(productsFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to read persisted products file:', error.message || error);
    return [];
  }
}

function writeProductsToDisk() {
  try {
    fs.writeFileSync(productsFile, `${JSON.stringify(products, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to persist products file:', error.message || error);
    return false;
  }
}

function loadProductsFromDisk() {
  const loaded = readProductsFromDisk();
  products = loaded.map(ensureSku);
  if (!fs.existsSync(productsFile)) {
    writeProductsToDisk();
  }
}

async function initializeMediaStorage() {
  if (canUseGoogleDriveMedia()) {
    try {
      await driveClient.files.get({
        fileId: googleMediaConfig.folderId,
        fields: 'id',
        supportsAllDrives: true
      });
      mediaStorageReady = true;
      console.log(`Media storage: Google Drive mode (${googleMediaConfig.folderId})`);
      return;
    } catch (error) {
      console.error('Google Drive media folder check failed. Falling back to local filesystem mode.', error.message || error);
    }
  }

  mediaStorageReady = true;
  console.log('Media storage: local filesystem mode');
}

async function saveProductMedia({ fileName, mimeType, buffer }) {
  if (canUseGoogleDriveMedia()) {
    try {
      const uploaded = await driveClient.files.create({
        requestBody: {
          name: fileName,
          parents: [googleMediaConfig.folderId]
        },
        media: {
          mimeType: mimeType || 'application/octet-stream',
          body: Readable.from(buffer)
        },
        fields: 'id, name',
        supportsAllDrives: true
      });

      return {
        image: buildMediaProxyPath(uploaded.data.id, mimeType),
        fileName,
        driveFileId: uploaded.data.id,
        driveMimeType: mimeType || 'application/octet-stream',
        storageProvider: 'gdrive'
      };
    } catch (error) {
      console.error('Google Drive media upload failed. Falling back to local upload path.', error.message || error);
    }
  }

  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return {
    image: `/uploads/${fileName}`,
    fileName,
    storageProvider: 'local'
  };
}

async function removeProductMedia(product) {
  if (product?.storageProvider === 'gdrive' && product?.driveFileId && driveClient) {
    try {
      await driveClient.files.delete({
        fileId: String(product.driveFileId),
        supportsAllDrives: true
      });
      return;
    } catch (error) {
      console.error('Failed to remove Google Drive media object:', error.message || error);
      return;
    }
  }

  if (product?.fileName) {
    const filePath = path.join(uploadsDir, product.fileName);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error('Failed to remove uploaded product media:', error);
      }
    }
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'item';
}

function makeSku(title, category, seed) {
  const categoryPart = slugify(category).slice(0, 8).toUpperCase();
  const titlePart = slugify(title).slice(0, 12).toUpperCase();
  const seedPart = slugify(seed).replace(/-/g, '').slice(-6).toUpperCase() || '000000';
  let sku = `DMR-${categoryPart}-${titlePart}-${seedPart}`;
  let counter = 2;
  while (products.some(product => product.sku === sku)) {
    sku = `DMR-${categoryPart}-${titlePart}-${String(counter).padStart(2, '0')}`;
    counter += 1;
  }
  return sku;
}

function ensureSku(product) {
  if (!product.sku) {
    product.sku = makeSku(product.title, product.category, product.id || product.image || randomUUID());
  }
  return product;
}

function toAbsoluteImage(image) {
  const trimmed = String(image || '').trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/')) return `${origin.replace(/\/$/, '')}${trimmed}`;
  return `${origin.replace(/\/$/, '')}/${trimmed.replace(/^\/+/, '')}`;
}

function toGalleryRelativeImage(image) {
  const trimmed = String(image || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('assets/gallery/')) return trimmed;

  const normalizedOrigin = origin.replace(/\/$/, '');
  if (trimmed.startsWith(`${normalizedOrigin}/`)) {
    return trimmed.slice(normalizedOrigin.length + 1);
  }

  const withoutHost = trimmed.replace(/^https?:\/\/[^/]+\/?/i, '');
  if (withoutHost.startsWith('assets/gallery/')) return withoutHost;
  return '';
}

const r2Client = createR2Client();

// Public URL for a gallery path like `assets/gallery/beach/foo.jpg`. Points at
// the CDN when MEDIA_CDN_URL is set, otherwise stays relative and is served
// off local disk.
function toGalleryPublicImage(relativeImage) {
  if (!isCdnEnabled()) return relativeImage;
  return toR2Url(relativeImage);
}

// Mirror a category change into R2. Objects are keyed by category, so a move
// on disk has to be a copy+delete in the bucket or the CDN URL 404s.
async function moveGalleryObjectInR2(fromRelative, toRelative) {
  if (!r2Client || !isR2Configured()) return;
  const { CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const fromKey = decodeURIComponent(fromRelative);
  const toKey = decodeURIComponent(toRelative);
  await r2Client.send(new CopyObjectCommand({
    Bucket: r2Config.bucket,
    Key: toKey,
    CopySource: `${r2Config.bucket}/${fromKey}`.split('/').map(encodeURIComponent).join('/')
  }));
  await r2Client.send(new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: fromKey }));
}

// Category folders on disk are the authoring view, but a host that serves
// media straight from the bucket may have none of them. Fall back to the
// canonical list so category moves stay possible there.
function listGalleryCategories() {
  const known = new Set(CATEGORIES);
  if (fs.existsSync(galleryDir)) {
    for (const entry of fs.readdirSync(galleryDir, { withFileTypes: true })) {
      if (entry.isDirectory()) known.add(entry.name.toLowerCase());
    }
  }
  return [...known];
}

function toCategoryFolder(value) {
  return slugify(value || '').replace(/-/g, '');
}

function isPrintOrder(product) {
  const sku = String(product?.sku || '').toUpperCase();
  const title = String(product?.title || '').toLowerCase();
  return /-(4X6|5X7|6X8|8X10|8X11)$/.test(sku) || title.includes(' print)');
}

function buildCheckoutDescription(product) {
  const base = String(product?.description || '').trim();
  const disclaimer = 'Printing is an add-on service. Digital file purchase is separate.';
  if (!isPrintOrder(product)) return base;
  if (!base) return disclaimer;
  if (base.toLowerCase().includes('digital file purchase is separate')) return base;
  return `${base} ${disclaimer}`;
}

function buildCheckoutLineItem(product, quantity) {
  const normalizedImage = String(product?.image || '').trim();
  const canUseStripeImage = normalizedImage && !normalizedImage.startsWith('/api/media/') && !normalizedImage.startsWith('api/media/');
  const description = buildCheckoutDescription(product);
  const productData = {
    name: product.title,
    images: product.mediaType === 'image' && canUseStripeImage ? [toAbsoluteImage(product.image)] : []
  };
  // Stripe treats an empty string as "unset this field" and rejects the whole
  // request. Gallery-derived products carry no description, so the key has to be
  // omitted entirely rather than sent blank.
  if (description) productData.description = description;
  return {
    quantity,
    price_data: {
      currency: 'usd',
      unit_amount: product.price,
      product_data: productData
    }
  };
}

function resolvePreviewProduct(preview) {
  const sku = String(preview?.sku || '').trim();
  const title = String(preview?.title || '').trim();
  const description = String(preview?.description || '').trim();
  const image = String(preview?.image || '').trim();
  const mediaType = String(preview?.mediaType || '').trim().toLowerCase();
  const price = Number(preview?.price);

  if (!title || !Number.isInteger(price) || price < 100 || !image) return null;
  const normalizedOrigin = origin.replace(/\/$/, '');
  const isGalleryImage = image.startsWith('assets/gallery/');
  const isUploadImage = image.startsWith('/uploads/') || image.startsWith('uploads/');
  const isProxyImage = image.startsWith('/api/media/') || image.startsWith('api/media/');
  const isOriginImage = image.startsWith(`${normalizedOrigin}/`);
  const isAbsoluteRemote = /^https?:\/\//i.test(image);
  if (!isGalleryImage && !isUploadImage && !isProxyImage && !isOriginImage && !isAbsoluteRemote) return null;

  return {
    sku,
    title,
    description,
    price,
    image: toAbsoluteImage(image),
    mediaType: mediaType === 'video' || /\.mp4(\?|$)/i.test(image) ? 'video' : 'image'
  };
}

function parseInquiryLines(content) {
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

function readInquiries() {
  if (!fs.existsSync(inquiriesLogFile)) return [];
  const raw = fs.readFileSync(inquiriesLogFile, 'utf8');
  return parseInquiryLines(raw);
}

function writeInquiries(inquiries) {
  const next = inquiries.map(inquiry => JSON.stringify(inquiry)).join('\n');
  fs.writeFileSync(inquiriesLogFile, next ? `${next}\n` : '', 'utf8');
}

function appendInquiry(inquiry) {
  fs.appendFileSync(inquiriesLogFile, `${JSON.stringify(inquiry)}\n`, 'utf8');
}

function updateInquiryById(id, updater) {
  const inquiries = readInquiries();
  const index = inquiries.findIndex(inquiry => inquiry.id === id);
  if (index < 0) return null;
  const updated = updater({ ...inquiries[index] });
  inquiries[index] = updated;
  writeInquiries(inquiries);
  return updated;
}

function getMailerConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  if (!host || !user || !pass) return null;

  const parsedPort = Number(process.env.SMTP_PORT || 587);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 587;
  const secure = String(process.env.SMTP_SECURE || '').trim() === 'true' || port === 465;

  return { host, port, secure, user, pass };
}

function getMailer() {
  if (mailTransporter) return mailTransporter;
  const config = getMailerConfig();
  if (!config) return null;

  mailTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  return mailTransporter;
}

async function sendInquiryEmail(inquiry) {
  const transporter = getMailer();
  const to = String(process.env.CONTACT_TO_EMAIL || process.env.ADMIN_EMAIL || '').trim();
  if (!transporter || !to) return false;

  const from = String(process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER || '').trim();
  if (!from) return false;

  const subject = `[Fairview Event Center] ${inquiry.service} inquiry from ${inquiry.name}`;
  const text = [
    'A new contact inquiry was submitted.',
    '',
    `Inquiry ID: ${inquiry.id}`,
    `Name: ${inquiry.name}`,
    `Email: ${inquiry.email}`,
    `Service: ${inquiry.service}`,
    `Submitted: ${inquiry.createdAt}`,
    '',
    'Message:',
    inquiry.message
  ].join('\n');

  await transporter.sendMail({
    from,
    to,
    replyTo: inquiry.email,
    subject,
    text
  });

  return true;
}

// nginx is the only hop in front of this process, and it sets X-Forwarded-For
// to the visitor's real address (see scripts/deploy/nginx-realip.conf). Without
// this, req.ip is nginx's own loopback address and every express-rate-limit
// bucket below is shared by the entire internet rather than being per-client.
// Safe only because the listener below is bound to loopback: nothing can reach
// this process directly to forge the header.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
// Only these two subtrees of storage/ are public. Mount them explicitly rather
// than serving all of storage/, which would also expose inquiries (PII),
// products.json, and sale-photos originals.
// In production nginx serves both paths directly; these mounts are the dev-mode
// and direct-hit equivalent.
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));

// The manifest is regenerated on every build and rewritten by category moves,
// so it is never pushed to the bucket -- always serve it from disk.
app.get('/assets/gallery/gallery-manifest.json', (req, res) => {
  if (!fs.existsSync(galleryManifestPath)) return res.status(404).json({ error: 'Manifest not found.' });
  return res.sendFile(galleryManifestPath);
});

// In CDN mode, send media requests to the bucket instead of serving bytes.
// The manifest already carries absolute CDN URLs, but templates also hard-code
// a few gallery paths (the hero video among them, at 206 MB). Redirecting here
// means those go to R2 too, and any path added later is covered by default
// rather than quietly billing the origin.
if (isCdnEnabled()) {
  app.get(/^\/assets\/gallery\/.+/, (req, res) => {
    const key = req.path.replace(/^\/+/, '');
    return res.redirect(302, toR2Url(key));
  });
} else {
  app.use('/assets/gallery', express.static(galleryDir, { maxAge: '7d' }));
}

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);
app.use(express.json({ limit: '65mb' }));
app.use(rateLimit({ windowMs: 900000, max: 150, standardHeaders: true, legacyHeaders: false }));

function auth(req, res, next) {
  try {
    req.admin = jwt.verify(req.headers.authorization?.replace('Bearer ', ''), process.env.JWT_SECRET, {
      issuer: 'fairviewApi',
      audience: 'fairview-admin'
    });
    next();
  } catch {
    res.status(401).json({ error: 'Sign in required.' });
  }
}

app.get('/api/products', (req, res) => {
  res.json(products.filter(product => product.published).map(resolveProductImageForResponse));
});

app.get('/api/content', (req, res) => {
  const content = siteContent.readContent();
  const { revision, updatedAt, ...publicContent } = content;
  res.json(publicContent);
});

app.post('/api/admin/login', rateLimit({ windowMs: 900000, max: 8, message: { error: 'Too many attempts. Try again later.' } }), async (req, res) => {
  const { email, password } = req.body || {};
  if (
    !email ||
    !password ||
    email !== process.env.ADMIN_EMAIL ||
    !(await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH || ''))
  ) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  return res.json({
    token: jwt.sign({ role: 'admin', email }, process.env.JWT_SECRET, {
      expiresIn: '2h',
      issuer: 'fairviewApi',
      audience: 'fairview-admin'
    }),
    provider: 'password'
  });
});

app.post('/api/admin/google-login', rateLimit({ windowMs: 900000, max: 15, message: { error: 'Too many attempts. Try again later.' } }), async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Google token required.' });

  try {
    const ticket = await new google.auth.OAuth2({
      clientId: '352038115250-io37tumi7dseohtgklrlg435vpj2qddb.apps.googleusercontent.com'
    }).verifyIdToken({
      idToken: token,
      audience: '352038115250-io37tumi7dseohtgklrlg435vpj2qddb.apps.googleusercontent.com'
    });

    const payload = ticket.getPayload();
    if (!payload || payload.email !== process.env.ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Access denied. Not authorized.' });
    }

    return res.json({
      token: jwt.sign({ role: 'admin', email: payload.email }, process.env.JWT_SECRET, {
        expiresIn: '2h',
        issuer: 'fairviewApi',
        audience: 'fairview-admin'
      }),
      provider: 'google',
      email: payload.email
    });
  } catch (error) {
    console.error('Google auth error:', error);
    return res.status(401).json({ error: 'Invalid Google token.' });
  }
});

app.get('/api/admin/content', auth, (req, res) => {
  res.json(siteContent.readContent());
});

app.patch('/api/admin/content', auth, (req, res) => {
  try {
    const current = siteContent.readContent();
    const next = siteContent.mergeContent(current, req.body || {});
    const saved = siteContent.writeContent(next);
    return res.json({ content: saved });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Content is invalid.' });
  }
});

app.get('/api/admin/inquiries', auth, (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  const serviceFilter = String(req.query.service || '').trim();
  const statusFilter = String(req.query.status || '').trim();
  const allowedStatus = new Set(['new', 'in-progress', 'closed']);

  const inquiries = readInquiries()
    .map(inquiry => ({ ...inquiry, status: allowedStatus.has(inquiry.status) ? inquiry.status : 'new' }))
    .filter(inquiry => {
      if (serviceFilter && serviceFilter !== 'all' && inquiry.service !== serviceFilter) return false;
      if (statusFilter && statusFilter !== 'all' && inquiry.status !== statusFilter) return false;
      if (!query) return true;
      return [inquiry.name, inquiry.email, inquiry.message, inquiry.service]
        .map(value => String(value || '').toLowerCase())
        .some(value => value.includes(query));
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ inquiries });
});

app.patch('/api/admin/inquiries/:id', auth, (req, res) => {
  const id = String(req.params.id || '').trim();
  const status = String(req.body?.status || '').trim();
  if (!id) return res.status(400).json({ error: 'Inquiry id is required.' });
  if (!['new', 'in-progress', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  const updated = updateInquiryById(id, current => ({
    ...current,
    status,
    updatedAt: new Date().toISOString()
  }));

  if (!updated) return res.status(404).json({ error: 'Inquiry not found.' });
  return res.json({ inquiry: updated });
});

app.post('/api/admin/products', auth, async (req, res) => {
  const { title, category, price, description, media } = req.body || {};
  if (!title || !category || !Number.isInteger(price) || price < 100 || !media?.data || !media?.name || !media?.mimeType) {
    return res.status(400).json({ error: 'Product details or media are invalid.' });
  }

  try {
    const fileExt = path.extname(media.name);
    const fileName = `${randomUUID()}${fileExt}`;
    const upload = await saveProductMedia({
      fileName,
      mimeType: media.mimeType,
      buffer: Buffer.from(media.data, 'base64')
    });

    const product = ensureSku({
      id: randomUUID(),
      title,
      category,
      price,
      description: description || '',
      mediaType: media.mimeType.startsWith('video/') ? 'video' : 'image',
      mediaMimeType: media.mimeType,
      fileName: upload.fileName,
      driveFileId: upload.driveFileId,
      driveMimeType: upload.driveMimeType,
      storageProvider: upload.storageProvider,
      image: upload.image,
      published: true,
      createdAt: new Date().toISOString()
    });

    products.unshift(product);
    if (!writeProductsToDisk()) {
      return res.status(500).json({ error: 'Media uploaded but product could not be saved.' });
    }
    return res.status(201).json(resolveProductImageForResponse(product));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Media upload failed.' });
  }
});

app.post('/api/admin/products/from-gallery', auth, (req, res) => {
  const { title, category, price, description, details, image, mediaType } = req.body || {};
  if (!title || !category || !Number.isInteger(price) || price < 100 || typeof image !== 'string' || !image.trim()) {
    return res.status(400).json({ error: 'Product details are invalid.' });
  }

  const trimmedImage = image.trim();
  if (!trimmedImage.startsWith('assets/gallery/')) {
    return res.status(400).json({ error: 'Only gallery images can be published from this endpoint.' });
  }

  const resolvedMediaType = mediaType === 'video' || /\.mp4(\?|$)/i.test(trimmedImage) ? 'video' : 'image';

  const absoluteImageUrl = `${origin.replace(/\/$/, '')}/${trimmedImage.replace(/^\/+/, '')}`;
  const product = ensureSku({
    id: randomUUID(),
    title,
    category,
    price,
    description: description || '',
    details: details || '',
    mediaType: resolvedMediaType,
    image: absoluteImageUrl,
    published: true,
    createdAt: new Date().toISOString()
  });

  products.unshift(product);
  if (!writeProductsToDisk()) {
    return res.status(500).json({ error: 'Product was created but could not be saved.' });
  }
  return res.status(201).json(resolveProductImageForResponse(product));
});

app.delete('/api/admin/products/:id', auth, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Product id is required.' });

  const product = products.find(item => item.id === id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  products = products.filter(item => item.id !== id);

  await removeProductMedia(product);
  if (!writeProductsToDisk()) {
    return res.status(500).json({ error: 'Product removed from memory but could not be saved.' });
  }

  return res.json({ ok: true, id });
});

app.patch('/api/admin/gallery/category', auth, async (req, res) => {
  const image = toGalleryRelativeImage(req.body?.image);
  const requestedCategory = String(req.body?.category || '').trim();
  if (!image || !requestedCategory) {
    return res.status(400).json({ error: 'Image and category are required.' });
  }

  if (!image.startsWith('assets/gallery/')) {
    return res.status(400).json({ error: 'Only gallery images can be moved.' });
  }

  const parts = image.split('/');
  if (parts.length < 4) {
    return res.status(400).json({ error: 'Image path is invalid.' });
  }

  const currentFolder = String(parts[2] || '').toLowerCase();
  const fileName = decodeURIComponent(parts.slice(3).join('/'));
  const targetFolder = toCategoryFolder(requestedCategory);
  const availableFolders = new Set(listGalleryCategories());
  if (!availableFolders.has(targetFolder)) {
    return res.status(400).json({ error: 'Target category is invalid.' });
  }

  const sourcePath = path.join(galleryDir, currentFolder, fileName);
  const destinationPath = path.join(galleryDir, targetFolder, fileName);
  const nextImage = `assets/gallery/${targetFolder}/${encodeURIComponent(fileName)}`;

  // The bucket is what serves the gallery, so a host without the photos on
  // disk can still recategorise them -- the move just happens only in R2.
  const hasLocalCopy = fs.existsSync(sourcePath);
  if (!hasLocalCopy && !isR2Configured()) {
    return res.status(404).json({ error: 'Source media file was not found.' });
  }

  if (currentFolder !== targetFolder) {
    if (hasLocalCopy) {
      if (fs.existsSync(destinationPath)) {
        return res.status(409).json({ error: 'A file with the same name already exists in that category.' });
      }
      fs.renameSync(sourcePath, destinationPath);
    }

    // Keep the bucket in step. If this fails the local move has already
    // happened, so roll it back rather than leave disk and CDN disagreeing.
    if (isR2Configured()) {
      try {
        await moveGalleryObjectInR2(image, nextImage);
      } catch (error) {
        console.error('R2 category move failed; rolling back local move.', error.message || error);
        if (hasLocalCopy) {
          try {
            fs.renameSync(destinationPath, sourcePath);
          } catch (rollbackError) {
            console.error('Rollback of local move also failed.', rollbackError.message || rollbackError);
          }
        }
        return res.status(502).json({ error: 'Could not move the media in remote storage. Nothing was changed.' });
      }
    }
  }

  const nextPublicImage = toGalleryPublicImage(nextImage);

  products = products.map(product => {
    const relative = toGalleryRelativeImage(product.image);
    if (relative !== image) return product;
    return {
      ...product,
      image: isCdnEnabled() ? nextPublicImage : toAbsoluteImage(nextImage)
    };
  });
  if (!writeProductsToDisk()) {
    return res.status(500).json({ error: 'Gallery update saved in memory but failed to persist.' });
  }

  if (fs.existsSync(galleryManifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(galleryManifestPath, 'utf8'));
      if (Array.isArray(manifest)) {
        const categoryLabel = targetFolder.charAt(0).toUpperCase() + targetFolder.slice(1);
        const updated = manifest.map(item => {
          // Manifest entries are absolute CDN URLs in R2 mode and relative
          // paths otherwise; normalise both sides before comparing.
          if (toGalleryRelativeImage(item?.image) !== image) return item;
          return {
            ...item,
            category: categoryLabel,
            image: nextPublicImage
          };
        });
        fs.writeFileSync(galleryManifestPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
      }
    } catch (error) {
      console.error('Failed to update gallery manifest after category move:', error);
    }
  }

  return res.json({
    ok: true,
    image: nextPublicImage,
    absoluteImage: isCdnEnabled() ? nextPublicImage : toAbsoluteImage(nextImage),
    category: targetFolder.charAt(0).toUpperCase() + targetFolder.slice(1)
  });
});

const CHURCH_SERVICES_FOLDER = 'church-services';
const CHURCH_SERVICES_LABEL = 'Church services';
const churchServicesDir = path.join(galleryDir, CHURCH_SERVICES_FOLDER);

function readGalleryManifest() {
  try {
    return JSON.parse(fs.readFileSync(galleryManifestPath, 'utf8'));
  } catch {
    return [];
  }
}

function writeGalleryManifest(items) {
  fs.writeFileSync(galleryManifestPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

// Lets the admin add photos/videos for visitors to see on the Church page
// without touching the CLI media pipeline. Writes straight to the same
// category folder the gallery manifest is generated from, so a plain drop-in
// photo and an admin upload end up indistinguishable on disk.
app.post('/api/admin/church-services', auth, async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const media = req.body?.media;
  if (!title || !media?.data || !media?.name || !media?.mimeType) {
    return res.status(400).json({ error: 'Title and media are required.' });
  }
  const isVideo = media.mimeType.startsWith('video/');
  if (!isVideo && !media.mimeType.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image or video files are supported.' });
  }

  try {
    fs.mkdirSync(churchServicesDir, { recursive: true });
    const ext = path.extname(media.name) || (isVideo ? '.mp4' : '.jpg');
    const fileName = `${randomUUID()}${ext}`;
    fs.writeFileSync(path.join(churchServicesDir, fileName), Buffer.from(media.data, 'base64'));

    const relativeImage = `assets/gallery/${CHURCH_SERVICES_FOLDER}/${encodeURIComponent(fileName)}`;
    const item = {
      category: CHURCH_SERVICES_LABEL,
      title,
      image: toGalleryPublicImage(relativeImage),
      mediaType: isVideo ? 'video' : 'image'
    };

    const manifest = readGalleryManifest();
    manifest.push(item);
    writeGalleryManifest(manifest);

    return res.status(201).json(item);
  } catch (error) {
    console.error('Church services upload failed:', error);
    return res.status(500).json({ error: 'Upload failed.' });
  }
});

app.delete('/api/admin/church-services/:fileName', auth, (req, res) => {
  const fileName = String(req.params.fileName || '').trim();
  // basename() strips any directory components a crafted param might carry,
  // so this can never resolve outside churchServicesDir.
  const safeName = path.basename(decodeURIComponent(fileName));
  if (!safeName || safeName !== decodeURIComponent(fileName)) {
    return res.status(400).json({ error: 'File name is invalid.' });
  }

  const filePath = path.join(churchServicesDir, safeName);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const relativeImage = `assets/gallery/${CHURCH_SERVICES_FOLDER}/${encodeURIComponent(safeName)}`;
    const publicImage = toGalleryPublicImage(relativeImage);
    const manifest = readGalleryManifest().filter(item => item.image !== publicImage);
    writeGalleryManifest(manifest);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Church services delete failed:', error);
    return res.status(500).json({ error: 'Could not delete this file.' });
  }
});

// The venue gallery ("See the space") has exactly two admin-manageable
// categories -- the two areas of the building visitors can book -- unlike
// church-services above, which is a single fixed folder for the separate
// Church ministry page.
const VENUE_GALLERY_FOLDERS = { 'community-center': 'Community Center', church: 'Church' };

app.post('/api/admin/venue-gallery', auth, async (req, res) => {
  const category = String(req.body?.category || '').trim().toLowerCase();
  const title = String(req.body?.title || '').trim();
  const media = req.body?.media;
  const label = VENUE_GALLERY_FOLDERS[category];
  if (!label) return res.status(400).json({ error: 'Category must be community-center or church.' });
  if (!title || !media?.data || !media?.name || !media?.mimeType) {
    return res.status(400).json({ error: 'Title and media are required.' });
  }
  const isVideo = media.mimeType.startsWith('video/');
  if (!isVideo && !media.mimeType.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image or video files are supported.' });
  }

  try {
    const categoryDir = path.join(galleryDir, category);
    fs.mkdirSync(categoryDir, { recursive: true });
    const ext = path.extname(media.name) || (isVideo ? '.mp4' : '.jpg');
    const fileName = `${randomUUID()}${ext}`;
    fs.writeFileSync(path.join(categoryDir, fileName), Buffer.from(media.data, 'base64'));

    const relativeImage = `assets/gallery/${category}/${encodeURIComponent(fileName)}`;
    const item = {
      category: label,
      title,
      image: toGalleryPublicImage(relativeImage),
      mediaType: isVideo ? 'video' : 'image'
    };

    const manifest = readGalleryManifest();
    manifest.push(item);
    writeGalleryManifest(manifest);

    return res.status(201).json(item);
  } catch (error) {
    console.error('Venue gallery upload failed:', error);
    return res.status(500).json({ error: 'Upload failed.' });
  }
});

app.delete('/api/admin/venue-gallery/:category/:fileName', auth, (req, res) => {
  const category = String(req.params.category || '').trim().toLowerCase();
  const label = VENUE_GALLERY_FOLDERS[category];
  if (!label) return res.status(400).json({ error: 'Category must be community-center or church.' });

  const fileName = String(req.params.fileName || '').trim();
  // basename() strips any directory components a crafted param might carry,
  // so this can never resolve outside the category folder.
  const safeName = path.basename(decodeURIComponent(fileName));
  if (!safeName || safeName !== decodeURIComponent(fileName)) {
    return res.status(400).json({ error: 'File name is invalid.' });
  }

  const filePath = path.join(galleryDir, category, safeName);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const relativeImage = `assets/gallery/${category}/${encodeURIComponent(safeName)}`;
    const publicImage = toGalleryPublicImage(relativeImage);
    const manifest = readGalleryManifest().filter(item => item.image !== publicImage);
    writeGalleryManifest(manifest);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Venue gallery delete failed:', error);
    return res.status(500).json({ error: 'Could not delete this file.' });
  }
});

app.post('/api/contact', rateLimit({ windowMs: 900000, max: 30, message: { error: 'Too many inquiries. Please try again shortly.' } }), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  const service = String(req.body?.service || '').trim();
  const message = String(req.body?.message || '').trim();

  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (service.length < 2 || service.length > 80) return res.status(400).json({ error: 'Please choose a service.' });
  if (message.length < 8 || message.length > 4000) return res.status(400).json({ error: 'Please include project details.' });

  const inquiry = {
    id: randomUUID(),
    name,
    email,
    service,
    message,
    status: 'new',
    emailDelivered: false,
    createdAt: new Date().toISOString()
  };

  try {
    appendInquiry(inquiry);

    let emailDelivered = false;
    try {
      emailDelivered = await sendInquiryEmail(inquiry);
    } catch (error) {
      console.error('Contact inquiry email failed:', error);
    }

    if (emailDelivered) {
      const emailedAt = new Date().toISOString();
      updateInquiryById(inquiry.id, current => ({
        ...current,
        emailDelivered: true,
        emailedAt
      }));
      inquiry.emailDelivered = true;
      inquiry.emailedAt = emailedAt;
    }

    console.log('Contact inquiry received:', inquiry.id, inquiry.service, inquiry.email);
    return res.status(201).json({ ok: true, id: inquiry.id, emailDelivered });
  } catch (error) {
    console.error('Contact inquiry save failed:', error);
    return res.status(500).json({ error: 'Could not submit your inquiry right now.' });
  }
});

app.post('/api/checkout', async (req, res) => {
  const product = products.find(item => item.id === req.body?.productId && item.published);
  if (!product) return res.status(404).json({ error: 'Product unavailable.' });
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured yet.' });

  const order = orderStore.createPendingOrder({
    kind: 'shop',
    items: [buildOrderItem(product, 1, req.body || {})]
  });

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [buildCheckoutLineItem(product, 1)],
      metadata: { orderId: order.id, productId: product.id },
      client_reference_id: order.id,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`
    });
  } catch (error) {
    console.error('Stripe session failed:', error?.message || error);
    return res.status(502).json({ error: 'Could not start checkout. Please try again.' });
  }

  orderStore.attachSession(order.id, session.id);
  res.json({ url: session.url });
});

app.post('/api/checkout/preview', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured yet.' });
  const preview = resolvePreviewProduct(req.body?.preview);
  if (!preview) return res.status(400).json({ error: 'Preview product is invalid.' });

  const order = orderStore.createPendingOrder({
    kind: 'shop',
    items: [buildOrderItem({ ...preview, id: '' }, 1, req.body?.preview || {})],
    metadata: { preview: 'true' }
  });

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [buildCheckoutLineItem(preview, 1)],
      metadata: { orderId: order.id, previewSku: preview.sku || '', preview: 'true' },
      client_reference_id: order.id,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`
    });
  } catch (error) {
    console.error('Stripe session failed:', error?.message || error);
    return res.status(502).json({ error: 'Could not start checkout. Please try again.' });
  }

  orderStore.attachSession(order.id, session.id);
  res.json({ url: session.url });
});

app.post('/api/checkout/cart', async (req, res) => {
  const incomingItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const digitalDeliveryEmail = String(req.body?.digitalDeliveryEmail || '').trim();
  const digitalEmailOptIn = req.body?.digitalEmailOptIn === true;
  if (!incomingItems.length) return res.status(400).json({ error: 'Cart is empty.' });
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured yet.' });
  const requiresDigitalDelivery = incomingItems.some(entry => String(entry?.orderType || '').trim() === 'digital');
  if (requiresDigitalDelivery && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(digitalDeliveryEmail)) {
    return res.status(400).json({ error: 'A valid digital delivery email is required for digital items.' });
  }

  const lineItems = [];
  const orderItems = [];
  for (const entry of incomingItems) {
    const quantity = Math.max(1, Math.min(10, parseInt(entry?.quantity, 10) || 1));

    if (entry?.productId) {
      const product = products.find(item => item.id === entry.productId && item.published);
      if (!product) return res.status(404).json({ error: 'One or more cart items are unavailable.' });
      lineItems.push(buildCheckoutLineItem(product, quantity));
      orderItems.push(buildOrderItem(product, quantity, entry));
      continue;
    }

    if (entry?.preview) {
      const preview = resolvePreviewProduct(entry.preview);
      if (!preview) return res.status(400).json({ error: 'One or more preview items are invalid.' });
      lineItems.push(buildCheckoutLineItem(preview, quantity));
      orderItems.push(buildOrderItem({ ...preview, id: '' }, quantity, entry));
      continue;
    }

    return res.status(400).json({ error: 'Cart item format is invalid.' });
  }

  const order = orderStore.createPendingOrder({
    kind: 'shop',
    email: requiresDigitalDelivery ? digitalDeliveryEmail : '',
    items: orderItems,
    metadata: { digitalEmailOptIn: String(digitalEmailOptIn) }
  });

  let session;
  try {
    session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: lineItems,
    metadata: {
      orderId: order.id,
      cartSize: String(lineItems.length),
      hasDigitalItems: requiresDigitalDelivery ? 'true' : 'false',
      digitalDeliveryEmail: requiresDigitalDelivery ? digitalDeliveryEmail.slice(0, 200) : '',
      digitalEmailOptIn: requiresDigitalDelivery ? String(digitalEmailOptIn) : 'false'
    },
    client_reference_id: order.id,
    customer_email: requiresDigitalDelivery ? digitalDeliveryEmail : undefined,
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancel`
    });
  } catch (error) {
    console.error('Stripe session failed:', error?.message || error);
    return res.status(502).json({ error: 'Could not start checkout. Please try again.' });
  }

  orderStore.attachSession(order.id, session.id);
  res.json({ url: session.url });
});

// ---------------------------------------------------------------- booking
app.get('/api/booking/slots', (req, res) => {
  res.json({
    slots: bookingStore.listOpenSlots({
      from: String(req.query.from || '').trim(),
      to: String(req.query.to || '').trim(),
      service: String(req.query.service || '').trim()
    }),
    depositRate: bookingStore.DEPOSIT_RATE,
    refundPolicy: bookingStore.refundPolicyText(),
    holdMinutes: bookingStore.holdMinutes()
  });
});

// Shared by /api/booking/hold and /api/booking/request-hold: holds an already
// -identified slot, opens a Stripe session for the deposit, and returns either
// an { error, status } to relay as-is or the response body to send. The hold
// expires on its own if the client never pays, so an abandoned checkout cannot
// park a date indefinitely.
async function holdSlotAndCheckout(slotId, { name, email, phone, notes }) {
  const held = bookingStore.holdSlot(slotId, { name, email, phone, notes });
  if (held.error) return { error: held.error, status: held.status || 400 };

  const booking = held.booking;
  const order = orderStore.createPendingOrder({
    kind: 'booking',
    email: booking.email,
    items: [{
      productId: '',
      sku: `BOOKING-${booking.date}${booking.startTime ? `-${booking.startTime}` : ''}`,
      title: `${booking.service} session deposit (${booking.date}${booking.startTime ? ` at ${booking.startTime}` : ''})`,
      mediaType: 'image',
      imageKey: '',
      quantity: 1,
      unitAmount: booking.deposit,
      orderType: 'booking',
      isPrint: false,
      printSize: '',
      printUnitPrice: 0,
      deliverDigital: false,
      downloads: 0
    }],
    metadata: { bookingId: booking.id, slotId: booking.slotId }
  });
  bookingStore.attachOrder(booking.id, order.id);

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: booking.deposit,
          product_data: {
            name: `${booking.service} session deposit`,
            description: `Reserves ${booking.date}. Balance of $${(booking.balanceDue / 100).toFixed(2)} due on the day. ${booking.refundPolicy}`
          }
        }
      }],
      metadata: { orderId: order.id, bookingId: booking.id },
      client_reference_id: order.id,
      customer_email: booking.email,
      success_url: `${origin}/?booking=success`,
      cancel_url: `${origin}/?booking=cancel`
    });
  } catch (error) {
    console.error('Stripe booking session failed:', error?.message || error);
    // Give the day straight back rather than leaving it held for the full window.
    bookingStore.cancelBooking(booking.id);
    return { error: 'Could not start checkout. Please try again.', status: 502 };
  }

  orderStore.attachSession(order.id, session.id);
  return { body: { url: session.url, bookingId: booking.id, deposit: booking.deposit, balanceDue: booking.balanceDue } };
}

// Holds the day, then opens a Stripe session for the deposit.
app.post('/api/booking/hold', rateLimit({ windowMs: 900000, max: 20, message: { error: 'Too many booking attempts. Please try again shortly.' } }), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured yet.' });

  const result = await holdSlotAndCheckout(String(req.body?.slotId || ''), {
    name,
    email,
    phone: String(req.body?.phone || '').trim(),
    notes: String(req.body?.notes || '').trim()
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result.body);
});

// A visitor requesting a date with nothing published: creates the slot on
// demand (priced from the service's listed starting price, since there is no
// studio-set fee to read yet) and then reuses the exact same hold + Stripe
// pipeline as booking an already-published time.
app.post('/api/booking/request-hold', rateLimit({ windowMs: 900000, max: 20, message: { error: 'Too many booking attempts. Please try again shortly.' } }), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured yet.' });

  const created = bookingStore.createRequestedSlot({
    service: req.body?.service,
    date: req.body?.date,
    startTime: req.body?.startTime
  });
  if (created.error) return res.status(created.status || 400).json({ error: created.error });

  const result = await holdSlotAndCheckout(created.slotId, {
    name,
    email,
    phone: String(req.body?.phone || '').trim(),
    notes: String(req.body?.notes || '').trim()
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result.body);
});

app.get('/api/admin/bookings', auth, (req, res) => {
  bookingStore.releaseExpiredHolds();
  const status = String(req.query.status || '').trim();
  const all = bookingStore.readBookings()
    .map(booking => ({ ...booking, refundable: bookingStore.isRefundable(booking) }))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  res.json({ bookings: !status || status === 'all' ? all : all.filter(booking => booking.status === status) });
});

app.get('/api/admin/booking/slots', auth, (req, res) => {
  bookingStore.releaseExpiredHolds();
  const blocks = bookingStore.readBlocks();
  const unblocks = bookingStore.readUnblocks();
  res.json({
    slots: bookingStore.readSlots()
      .map(slot => ({
        ...slot,
        // Surface whether a block rule currently hides this open session, so the
        // admin can unblock it directly.
        blocked: slot.status === bookingStore.SLOT.OPEN
          ? bookingStore.slotIsBlocked(slot, blocks, unblocks)
          : false
      }))
      .sort((left, right) => (
        String(left.date).localeCompare(String(right.date))
        || String(left.startTime || '').localeCompare(String(right.startTime || ''))
      ))
  });
});

// Publishes open hours for one day, or -- when endDate is present -- for
// every calendar day from date to endDate inclusive (the admin panel's
// week/month range options).
app.post('/api/admin/booking/slots', auth, (req, res) => {
  const endDate = String(req.body?.endDate || '').trim();
  const created = endDate
    ? bookingStore.publishRange({
      service: req.body?.service,
      startDate: req.body?.date,
      endDate,
      openTime: req.body?.openTime,
      closeTime: req.body?.closeTime,
      sessionFee: req.body?.sessionFee,
      sessionMinutes: req.body?.sessionMinutes,
      gapMinutes: req.body?.gapMinutes,
      location: req.body?.location,
      unblockDays: Boolean(req.body?.unblockDay)
    })
    : bookingStore.publishDay({
      service: req.body?.service,
      date: req.body?.date,
      openTime: req.body?.openTime,
      closeTime: req.body?.closeTime,
      sessionFee: req.body?.sessionFee,
      sessionMinutes: req.body?.sessionMinutes,
      gapMinutes: req.body?.gapMinutes,
      location: req.body?.location,
      unblockDay: Boolean(req.body?.unblockDay)
    });
  if (created.error) return res.status(400).json({ error: created.error });
  res.status(201).json({
    slots: created.slots,
    created: created.created,
    skipped: created.skipped,
    unblockedDay: Boolean(created.unblockedDay),
    daysPublished: created.daysPublished,
    daysAttempted: created.daysAttempted,
    daysSkippedPast: created.daysSkippedPast
  });
});

app.delete('/api/admin/booking/slots/:id', auth, (req, res) => {
  const removed = bookingStore.deleteSlot(String(req.params.id || ''));
  if (removed.error) return res.status(removed.status || 400).json({ error: removed.error });
  res.json({ ok: true });
});

// Recurring unavailability, e.g. Mon-Fri 09:00-17:00 for a day job. Reports how
// many already-published sessions each block hides, so the effect of adding one
// is visible without hunting through the calendar.
app.get('/api/admin/booking/blocks', auth, (req, res) => {
  const blocks = bookingStore.readBlocks();
  const slots = bookingStore.readSlots().filter(slot => slot.status === bookingStore.SLOT.OPEN);
  res.json({
    blocks: blocks.map(block => ({
      ...block,
      label: bookingStore.blockLabel(block),
      hiddenSessions: slots.filter(slot => bookingStore.slotIsBlocked(slot, [block])).length
    }))
  });
});

app.post('/api/admin/booking/blocks', auth, (req, res) => {
  const created = bookingStore.createBlock({
    weekdays: req.body?.weekdays,
    startTime: req.body?.startTime,
    endTime: req.body?.endTime,
    reason: req.body?.reason
  });
  if (created.error) return res.status(400).json({ error: created.error });
  const hidden = bookingStore.readSlots()
    .filter(slot => slot.status === bookingStore.SLOT.OPEN)
    .filter(slot => bookingStore.slotIsBlocked(slot, [created.block])).length;
  res.status(201).json({ block: created.block, hiddenSessions: hidden });
});

// One-off exceptions to the recurring blocks above: free a whole day or a
// single session so it can be published and booked.
app.get('/api/admin/booking/unblocks', auth, (req, res) => {
  const unblocks = bookingStore.readUnblocks();
  res.json({
    unblocks: unblocks.map(rule => ({
      ...rule,
      label: bookingStore.unblockLabel(rule)
    }))
  });
});

// A single date/session, or -- when endDate is present -- every day from
// date to endDate inclusive that a block actually covers (the admin panel's
// bulk unblock).
app.post('/api/admin/booking/unblocks', auth, (req, res) => {
  const endDate = String(req.body?.endDate || '').trim();
  if (endDate) {
    const created = bookingStore.unblockRange({
      startDate: req.body?.date,
      endDate,
      reason: req.body?.reason
    });
    if (created.error) return res.status(400).json({ error: created.error });
    return res.status(201).json(created);
  }

  const created = bookingStore.createUnblock({
    date: req.body?.date,
    startTime: req.body?.startTime,
    reason: req.body?.reason
  });
  if (created.error) return res.status(created.status || 400).json({ error: created.error });
  res.status(201).json({ unblock: created.unblock });
});

app.delete('/api/admin/booking/unblocks/:id', auth, (req, res) => {
  const removed = bookingStore.deleteUnblock(String(req.params.id || ''));
  if (removed.error) return res.status(removed.status || 400).json({ error: removed.error });
  res.json({ ok: true });
});

app.delete('/api/admin/booking/blocks/:id', auth, (req, res) => {
  const removed = bookingStore.deleteBlock(String(req.params.id || ''));
  if (removed.error) return res.status(removed.status || 400).json({ error: removed.error });
  res.json({ ok: true });
});

// Records the start time once studio and client have agreed it.
app.patch('/api/admin/bookings/:id/time', auth, (req, res) => {
  const updated = bookingStore.setAgreedTime(String(req.params.id || ''), req.body?.agreedTime);
  if (!updated) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ booking: updated });
});

// Releases the day. Any deposit refund is issued by hand in Stripe -- `refundable`
// reports whether the client is still inside the window they agreed to.
app.post('/api/admin/bookings/:id/cancel', auth, (req, res) => {
  const booking = bookingStore.findBooking(String(req.params.id || ''));
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  const cancelled = bookingStore.cancelBooking(booking.id);
  res.json({ booking: { ...cancelled, refundable: bookingStore.isRefundable(booking) } });
});

// Signed download of a purchased master. The token names the order and line
// item, so it grants exactly one file and nothing else.
app.get('/api/download/:token', async (req, res) => {
  let decoded;
  try {
    decoded = jwt.verify(String(req.params.token || ''), process.env.JWT_SECRET, {
      issuer: 'fairviewApi',
      audience: 'fairview-download'
    });
  } catch (error) {
    const expired = error?.name === 'TokenExpiredError';
    return res.status(expired ? 410 : 401).json({
      error: expired ? 'This download link has expired. Contact us and we will reissue it.' : 'Invalid download link.'
    });
  }

  const order = orderStore.findOrderById(String(decoded?.orderId || ''));
  if (!order || order.status !== orderStore.STATUS.PAID) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  const itemIndex = Number(decoded?.itemIndex);
  const item = Number.isInteger(itemIndex) ? order.items[itemIndex] : null;
  if (!item || !item.deliverDigital || !item.imageKey) {
    return res.status(404).json({ error: 'That item has no downloadable file.' });
  }

  const object = await fetchOriginalObject(item.imageKey);
  if (!object) return res.status(404).json({ error: 'File unavailable. Please contact us.' });

  const fileName = item.imageKey.split('/').pop() || 'fairview-download';
  res.setHeader('Content-Type', object.contentType || 'application/octet-stream');
  if (object.contentLength) res.setHeader('Content-Length', String(object.contentLength));
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  orderStore.countDownload(order.id, itemIndex);

  object.body.on('error', (error) => {
    console.error('Download stream failed:', error?.message || error);
    if (!res.headersSent) res.status(502).end();
  });
  object.body.pipe(res);
});

app.get('/api/admin/orders', auth, (req, res) => {
  const status = String(req.query.status || '').trim();
  const all = orderStore.readOrders().sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const filtered = !status || status === 'all' ? all : all.filter(order => order.status === status);
  res.json({ orders: filtered });
});

// Reissue delivery for an order the studio has checked -- covers a bounced
// email, an expired link, or a delivery that failed while the mailer was down.
app.post('/api/admin/orders/:id/resend', auth, async (req, res) => {
  const order = orderStore.findOrderById(String(req.params.id || ''));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.status !== orderStore.STATUS.PAID) return res.status(400).json({ error: 'Order is not paid.' });

  orderStore.setDelivery(order.id, { status: orderStore.FULFILMENT.PENDING, error: '' });
  const updated = await fulfilOrder(orderStore.findOrderById(order.id));
  res.json({ order: updated });
});

app.get('/api/media/:token', async (req, res) => {
  if (!driveClient) return res.status(404).json({ error: 'Media proxy unavailable.' });

  try {
    const decoded = jwt.verify(String(req.params.token || ''), process.env.JWT_SECRET, {
      issuer: 'fairviewApi',
      audience: 'fairview-media'
    });

    if (decoded?.provider !== 'gdrive' || !decoded?.fileId) {
      return res.status(400).json({ error: 'Invalid media token.' });
    }

    const mimeType = String(decoded?.mimeType || '').trim();
    if (mimeType) {
      res.setHeader('Content-Type', mimeType);
    }
    res.setHeader('Cache-Control', 'private, max-age=300');

    const response = await driveClient.files.get({
      fileId: String(decoded.fileId),
      alt: 'media',
      supportsAllDrives: true
    }, {
      responseType: 'stream'
    });

    response.data.on('error', (error) => {
      console.error('Drive media stream failed:', error.message || error);
      if (!res.headersSent) res.status(502).end();
    });

    response.data.pipe(res);
  } catch (error) {
    if (error?.name === 'TokenExpiredError' || error?.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Media token expired or invalid.' });
    }
    console.error('Media proxy error:', error.message || error);
    return res.status(404).json({ error: 'Media unavailable.' });
  }
});

async function stripeWebhook(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(400);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = String(session.metadata?.orderId || session.client_reference_id || '').trim();

    if (!orderId) {
      // Predates order records, or a session created outside this API. Nothing
      // to deliver, but do not fail the webhook -- Stripe would retry forever.
      console.warn('Paid session carried no order id:', session.id);
      return res.json({ received: true });
    }

    // markPaid is idempotent; a retry returns null and we fall through to the
    // stored order, so only the steps that have not succeeded are re-run.
    let order = orderStore.markPaid(orderId, {
      sessionId: session.id,
      paymentIntentId: String(session.payment_intent || ''),
      email: String(session.customer_details?.email || session.customer_email || ''),
      amountTotal: Number(session.amount_total) || 0,
      currency: String(session.currency || 'usd')
    }) || orderStore.findOrderById(orderId);

    if (!order) {
      console.warn('Paid session referenced an unknown order:', orderId);
      return res.json({ received: true });
    }

    try {
      await fulfilOrder(order);
    } catch (error) {
      // Never 500 here: Stripe retries on non-2xx, and the order is already
      // recorded as paid. The admin view shows what still needs attention.
      console.error('Order fulfilment failed:', error?.message || error);
    }
  }

  return res.json({ received: true });
}

loadProductsFromDisk();
console.log(`Products loaded: ${products.length}`);

// Bind the port before probing Google Drive, not after. The probe is a network
// round-trip with no timeout, and nothing served here needs it to have finished:
// gallery media is read straight off disk, and uploads re-check
// canUseGoogleDriveMedia() at call time. Blocking listen on it meant the dev
// server proxied gallery requests to a socket that was not open yet and logged
// ECONNREFUSED for the first seconds of every boot -- or forever, if Drive was
// unreachable.
// Async handlers that reject would otherwise crash the process under Express 4.
app.use((error, req, res, next) => {
  console.error('Unhandled route error:', error?.message || error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason?.message || reason);
});

// Bind to loopback: nginx proxies from 127.0.0.1, so nothing else needs to
// reach this port. Binding *:3000 would let any host on the LAN hit the API
// directly and forge X-Forwarded-For past the rate limiters above.
const bindHost = process.env.BIND_HOST || '127.0.0.1';
app.listen(port, bindHost, () => console.log(`Fairview API running on http://${bindHost}:${port}`));
console.log(isCdnEnabled()
  ? `Gallery media: CDN (${r2Config.cdnUrl})`
  : 'Gallery media: local disk');

initializeMediaStorage().catch((error) => {
  console.error('Media storage init failed; continuing in local filesystem mode.', error.message || error);
});
