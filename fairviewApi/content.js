const fs = require('fs');
const path = require('path');

const contentDir = path.join(__dirname, '../storage/content');
const contentFile = path.join(contentDir, 'site-content.json');
const backupFile = path.join(contentDir, 'site-content.json.bak');

const defaults = {
  revision: 0,
  updatedAt: '',
  site: {
    brand: 'Fairview Community Center',
    title: 'Fairview Community Center',
    description: 'Fairview Community Center — event spaces, bookings, and galleries for weddings, meetings, and celebrations.',
    contactEmail: 'hello@example.com',
    // Optional -- shown in the footer and used for the site's structured
    // data (schema.org EventVenue "telephone") when set. Empty means "don't
    // publish a phone number."
    phone: '',
    footerText: 'All rights reserved.',
    socialLinks: [],
    logo: ''
  },
  navigation: {
    home: { label: 'Home', visible: true },
    about: { label: 'About', visible: true },
    eventCenter: { label: 'Event Center', visible: true },
    booking: { label: 'Booking', visible: true }
  },
  hero: {
    eyebrow: 'Fairview Community Center',
    headline: 'A place to gather, celebrate, and grow.',
    intro: 'Open to the community for weddings, meetings, and celebrations of every kind.',
    ctaLabel: 'Plan your event',
    ctaTarget: 'eventCenter',
    video: '',
    poster: '',
    logoSize: 148,
    eyebrowSize: 9,
    headlineSize: 60,
    introSize: 13
  },
  statement: {
    eyebrow: 'Welcome',
    heading: 'Community, celebration, and shared space.',
    copy: 'Book the space for your next event, meeting, or celebration.'
  },
  about: {
    eyebrow: 'WHO WE ARE',
    heading: 'Community,',
    headingEmphasis: 'together.',
    body: "Fairview Community Center is a shared space for the neighbors, families, and groups who gather here throughout the week.\n\nThe center opens its doors to weddings, celebrations, meetings, and events of every kind, with rooms and grounds to fit gatherings large and small.\n\nWhether you're planning a wedding, a meeting, or a celebration, we'd love to help you book the space.",
    ctaLabel: 'Get in touch',
    portraitImage: '',
    features: []
  },
  contact: {
    eyebrow: 'Get in touch',
    heading: "Questions about booking the center? Let's talk.",
    email: 'hello@example.com',
    address: '1053 Panola Rd #3029, Ellenwood, GA 30294',
    faq: [
      {
        question: 'How do I book a date?',
        answer: "Pick an open date on the Booking page and pay the reservation fee online to hold it, or reach out here and we'll help you find one."
      },
      {
        question: 'What does the reservation fee cover?',
        answer: 'The reservation fee is paid up front to hold your date. The rental fee is separate and due 15 days before your event.'
      },
      {
        question: 'Can I tour the space before booking?',
        answer: 'Yes -- reach out to schedule a walkthrough, or check the Event Center page for photos and a virtual tour.'
      },
      {
        question: "What's the cancellation policy?",
        answer: 'Reservation fees are refundable up until the refund window shown on your booking confirmation. After that window, the fee is non-refundable.'
      }
    ]
  },
  rates: {
    eyebrow: 'Pricing',
    heading: 'Rate schedule',
    intro: 'Current rental and reservation fees for the Fairview Community Center. Reach out if you have questions about a specific date.',
    // Empty until an admin uploads a PDF/Word document through the Site
    // content form -- rates change often enough that a re-upload, rather than
    // hand-edited page copy, is the easiest way to keep this current.
    document: '',
    // Seeded from the 2026 pricing schedule; admin-editable line items so
    // rates can be updated without a new document upload.
    items: [
      { name: 'Standard Package (Morning Only)', detail: 'Community Center, Picnic Pavilion & Ball Field · 9:00 AM – 3:00 PM', price: '$995.00', category: 'All-Season Days' },
      { name: 'Standard Package (Evening Only)', detail: 'Community Center, Picnic Pavilion & Ball Field · 5:00 PM – 10:00 PM', price: '$1,200.00', category: 'All-Season Days' },
      { name: 'Standard Package (All Day)', detail: 'Community Center, Picnic Pavilion & Ball Field · 9:00 AM – 10:00 PM', price: '$1,750.00', category: 'All-Season Days' },
      { name: 'Community Center Only (Weekday)', detail: 'Monday–Thursday · 6-hour minimum', price: '$125.00/hour', category: 'All-Season Days' },
      { name: 'Bereavement Package', detail: 'Community Center · 6 hours', price: '$750.00', category: 'Special Community Events Only' },
      { name: 'Sunday Event', detail: 'Community Center, Picnic Pavilion & Ball Field · 1:00 PM – 8:00 PM', price: '$1,200.00', category: 'Special Community Events Only' },
      { name: 'Refundable Rental Deposit', detail: 'Required for all bookings', price: '$175.00', category: '' }
    ]
  },
  // `panoramas` supports multiple rooms/views; each is shown in a labeled
  // tab. Falls back to a single "Venue" room migrated from the pre-multi-room
  // `panoramaImage` field on read (see readContent's migration step).
  tours: { communityCenter: '', panoramas: [] },
  theme: { primary: '#26362e', background: '#f4f2ec', text: '#1f211d' },
  // Per-field font overrides, e.g. { 'about.body': { size: 18, font: 'georgia' } }.
  // Empty means every field uses the stylesheet's own size and font.
  textStyles: {}
};

// Ids the admin may style, and the fonts they may pick. Fonts are stored as
// ids and mapped to real CSS stacks in the frontend (src/app/text-style.ts),
// so a saved value can never carry arbitrary CSS. Keep both lists in sync.
const textStyleKeys = [
  'site.brand', 'navigation.label',
  'hero.eyebrow', 'hero.headline', 'hero.intro', 'hero.ctaLabel',
  'statement.eyebrow', 'statement.heading', 'statement.copy',
  'about.eyebrow', 'about.heading', 'about.body', 'about.ctaLabel',
  'about.featureTitle', 'about.featureDescription', 'about.featurePrice',
  'rates.eyebrow', 'rates.heading', 'rates.intro',
  'rates.category', 'rates.itemName', 'rates.itemDetail', 'rates.itemPrice',
  'contact.eyebrow', 'contact.heading', 'contact.email', 'contact.address',
  'contact.faqQuestion', 'contact.faqAnswer'
];
const textFontIds = ['georgia', 'times', 'palatino', 'arial', 'verdana', 'trebuchet', 'courier'];

const maxLengths = {
  brand: 80, title: 120, description: 320, contactEmail: 254, footerText: 180,
  phone: 40,
  eyebrow: 100, headline: 180, intro: 500, ctaLabel: 80, heading: 180, copy: 600,
  paragraph: 1200, label: 60, media: 300, serviceName: 100, serviceText: 600,
  workTitle: 120, category: 80, featureTitle: 80, featureText: 400,
  address: 300, faqQuestion: 200, faqAnswer: 600,
  price: 40, rateItemName: 100, rateItemDetail: 240
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value, max, field, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`${field} must be a string of ${required ? '1' : '0'}-${max} characters.`);
  }
}

function assertNumberInRange(value, min, max, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be a number between ${min} and ${max}.`);
  }
}

function assertMediaReference(value, field) {
  if (value === '') return;
  assertString(value, maxLengths.media, field);
  if (!value.startsWith('assets/gallery/')) throw new Error(`${field} must reference public gallery media.`);
}

// Virtual tour links point at a third-party embed (Matterport, YouTube, etc.),
// not gallery media, so this only enforces HTTPS rather than the
// assets/gallery/ prefix assertMediaReference requires.
function assertEmbedUrl(value, field) {
  if (value === '') return;
  assertString(value, 500, field);
  if (!/^https:\/\//i.test(value)) throw new Error(`${field} must be an HTTPS URL.`);
}

// Theme colors are applied as raw CSS custom-property values (see
// AppComponent.applyTheme), so this is deliberately narrow: a 3/4/6/8-digit
// hex color only, never an arbitrary CSS value that could inject something
// unexpected into a runtime style declaration.
function assertHexColor(value, field) {
  if (!/^#[0-9a-fA-F]{3,8}$/.test(String(value || ''))) throw new Error(`${field} must be a hex color like #26362e.`);
}

function assertKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${field}.${key} is not editable.`);
  }
}

function validateContent(input) {
  if (!isPlainObject(input)) throw new Error('Content must be an object.');
  assertKeys(input, ['site', 'navigation', 'hero', 'statement', 'about', 'contact', 'rates', 'tours', 'theme', 'textStyles'], 'content');

  const site = input.site;
  if (!isPlainObject(site)) throw new Error('site must be an object.');
  assertKeys(site, ['brand', 'title', 'description', 'contactEmail', 'phone', 'footerText', 'socialLinks', 'logo'], 'site');
  for (const field of ['brand', 'title', 'description', 'contactEmail', 'footerText']) assertString(site[field], maxLengths[field], `site.${field}`, field !== 'footerText');
  assertString(site.phone || '', maxLengths.phone, 'site.phone');
  assertMediaReference(site.logo, 'site.logo');
  if (!Array.isArray(site.socialLinks) || site.socialLinks.length > 8) throw new Error('site.socialLinks is invalid.');
  for (const link of site.socialLinks) {
    if (!isPlainObject(link)) throw new Error('Each social link must be an object.');
    assertKeys(link, ['label', 'url'], 'site.socialLinks[]');
    assertString(link.label, maxLengths.label, 'social link label', true);
    assertString(link.url, 500, 'social link url', true);
    if (!/^https:\/\//i.test(link.url)) throw new Error('Social links must use HTTPS URLs.');
  }

  const navigation = input.navigation;
  if (!isPlainObject(navigation)) throw new Error('navigation must be an object.');
  assertKeys(navigation, ['home', 'about', 'eventCenter', 'booking'], 'navigation');
  for (const key of Object.keys(navigation)) {
    const item = navigation[key];
    if (!isPlainObject(item)) throw new Error(`navigation.${key} is invalid.`);
    assertKeys(item, ['label', 'visible'], `navigation.${key}`);
    assertString(item.label, maxLengths.label, `navigation.${key}.label`, true);
    if (typeof item.visible !== 'boolean') throw new Error(`navigation.${key}.visible must be boolean.`);
  }

  const hero = input.hero;
  if (!isPlainObject(hero)) throw new Error('hero must be an object.');
  assertKeys(hero, ['eyebrow', 'headline', 'intro', 'ctaLabel', 'ctaTarget', 'video', 'poster', 'logoSize', 'eyebrowSize', 'headlineSize', 'introSize'], 'hero');
  for (const field of ['eyebrow', 'headline', 'intro', 'ctaLabel']) assertString(hero[field], maxLengths[field], `hero.${field}`, true);
  // A free-text target would let a typo silently break the hero button (it
  // drives goToSection(), which just no-ops on an unknown section), so this
  // is a closed set rather than assertString.
  if (!['home', 'about', 'eventCenter', 'booking', 'contact'].includes(hero.ctaTarget)) {
    throw new Error('hero.ctaTarget must be one of: home, about, eventCenter, booking, contact.');
  }
  assertMediaReference(hero.video, 'hero.video');
  assertMediaReference(hero.poster, 'hero.poster');
  assertNumberInRange(hero.logoSize, 40, 320, 'hero.logoSize');
  assertNumberInRange(hero.eyebrowSize, 6, 18, 'hero.eyebrowSize');
  assertNumberInRange(hero.headlineSize, 28, 110, 'hero.headlineSize');
  assertNumberInRange(hero.introSize, 10, 26, 'hero.introSize');

  const statement = input.statement;
  if (!isPlainObject(statement)) throw new Error('statement must be an object.');
  assertKeys(statement, ['eyebrow', 'heading', 'copy'], 'statement');
  assertString(statement.eyebrow, maxLengths.eyebrow, 'statement.eyebrow', true);
  assertString(statement.heading, maxLengths.heading, 'statement.heading', true);
  assertString(statement.copy, maxLengths.copy, 'statement.copy', true);

  const about = input.about;
  if (!isPlainObject(about)) throw new Error('about must be an object.');
  assertKeys(about, ['eyebrow', 'heading', 'headingEmphasis', 'body', 'ctaLabel', 'portraitImage', 'features'], 'about');
  assertString(about.eyebrow, maxLengths.eyebrow, 'about.eyebrow', true);
  assertString(about.heading, maxLengths.heading, 'about.heading', true);
  assertString(about.headingEmphasis, maxLengths.heading, 'about.headingEmphasis', true);
  assertString(about.body, maxLengths.paragraph, 'about.body', true);
  assertString(about.ctaLabel, maxLengths.ctaLabel, 'about.ctaLabel', true);
  assertMediaReference(about.portraitImage, 'about.portraitImage');
  if (!Array.isArray(about.features) || about.features.length > 12) throw new Error('about.features is invalid.');
  for (const feature of about.features) {
    if (!isPlainObject(feature)) throw new Error('Each about feature must be an object.');
    assertKeys(feature, ['title', 'description', 'image', 'price'], 'about.features[]');
    assertString(feature.title, maxLengths.featureTitle, 'feature title', true);
    assertString(feature.description, maxLengths.featureText, 'feature description', true);
    assertMediaReference(feature.image, 'feature image');
    // Optional, and absent on features saved before this field existed --
    // tolerate undefined here rather than backfilling every saved feature.
    assertString(feature.price || '', maxLengths.price, 'feature price');
  }

  const contact = input.contact;
  if (!isPlainObject(contact)) throw new Error('contact must be an object.');
  assertKeys(contact, ['eyebrow', 'heading', 'email', 'address', 'faq'], 'contact');
  assertString(contact.eyebrow, maxLengths.eyebrow, 'contact.eyebrow', true);
  assertString(contact.heading, maxLengths.heading, 'contact.heading', true);
  assertString(contact.email, maxLengths.contactEmail, 'contact.email', true);
  assertString(contact.address, maxLengths.address, 'contact.address', true);
  if (!Array.isArray(contact.faq) || contact.faq.length > 20) throw new Error('contact.faq is invalid.');
  for (const item of contact.faq) {
    if (!isPlainObject(item)) throw new Error('Each FAQ item must be an object.');
    assertKeys(item, ['question', 'answer'], 'contact.faq[]');
    assertString(item.question, maxLengths.faqQuestion, 'FAQ question', true);
    assertString(item.answer, maxLengths.faqAnswer, 'FAQ answer', true);
  }

  const rates = input.rates;
  if (!isPlainObject(rates)) throw new Error('rates must be an object.');
  assertKeys(rates, ['eyebrow', 'heading', 'intro', 'document', 'items'], 'rates');
  assertString(rates.eyebrow, maxLengths.eyebrow, 'rates.eyebrow', true);
  assertString(rates.heading, maxLengths.heading, 'rates.heading', true);
  assertString(rates.intro, maxLengths.intro, 'rates.intro', true);
  assertMediaReference(rates.document, 'rates.document');
  if (!Array.isArray(rates.items) || rates.items.length > 40) throw new Error('rates.items is invalid.');
  for (const item of rates.items) {
    if (!isPlainObject(item)) throw new Error('Each rate item must be an object.');
    assertKeys(item, ['name', 'detail', 'price', 'category'], 'rates.items[]');
    assertString(item.name, maxLengths.rateItemName, 'rate item name', true);
    assertString(item.detail, maxLengths.rateItemDetail, 'rate item detail');
    assertString(item.price, maxLengths.price, 'rate item price');
    // Optional grouping label; empty items render outside any category.
    assertString(item.category || '', maxLengths.rateItemName, 'rate item category');
  }

  const tours = input.tours;
  if (!isPlainObject(tours)) throw new Error('tours must be an object.');
  assertKeys(tours, ['communityCenter', 'panoramas'], 'tours');
  assertEmbedUrl(tours.communityCenter, 'tours.communityCenter');
  if (!Array.isArray(tours.panoramas) || tours.panoramas.length > 12) throw new Error('tours.panoramas is invalid.');
  const roomIds = new Set();
  for (const room of tours.panoramas) {
    if (!isPlainObject(room)) throw new Error('Each panorama room must be an object.');
    assertKeys(room, ['id', 'label', 'image', 'mode', 'haov', 'vaov', 'vOffset', 'description', 'capacity', 'layouts', 'hotspots'], 'tours.panoramas[]');
    assertString(room.label, maxLengths.label, 'panorama room label', true);
    assertMediaReference(room.image, 'panorama room image');
    // Everything below is optional so rooms saved before these fields existed
    // (and clients that omit them) still validate.
    if (room.id !== undefined) {
      if (typeof room.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(room.id)) throw new Error('panorama room id is invalid.');
      if (roomIds.has(room.id)) throw new Error('panorama room ids must be unique.');
      roomIds.add(room.id);
    }
    if (room.mode !== undefined && !['auto', 'flat', 'partial', '360'].includes(room.mode)) throw new Error('panorama room mode is invalid.');
    if (room.haov !== undefined) assertNumberInRange(room.haov, 1, 360, 'panorama room haov');
    if (room.vaov !== undefined) assertNumberInRange(room.vaov, 1, 180, 'panorama room vaov');
    if (room.vOffset !== undefined) assertNumberInRange(room.vOffset, -90, 90, 'panorama room vOffset');
    assertString(room.description || '', maxLengths.copy, 'panorama room description');
    assertString(room.capacity || '', maxLengths.label, 'panorama room capacity');
    const layouts = room.layouts === undefined ? [] : room.layouts;
    if (!Array.isArray(layouts) || layouts.length > 6) throw new Error('panorama room layouts are invalid.');
    for (const layout of layouts) {
      if (!isPlainObject(layout)) throw new Error('Each panorama layout must be an object.');
      assertKeys(layout, ['label', 'image'], 'tours.panoramas[].layouts[]');
      assertString(layout.label, maxLengths.label, 'panorama layout label', true);
      assertMediaReference(layout.image, 'panorama layout image');
    }
    const hotspots = room.hotspots === undefined ? [] : room.hotspots;
    if (!Array.isArray(hotspots) || hotspots.length > 12) throw new Error('panorama room hotspots are invalid.');
    for (const hotspot of hotspots) {
      if (!isPlainObject(hotspot)) throw new Error('Each panorama hotspot must be an object.');
      assertKeys(hotspot, ['x', 'y', 'toRoom', 'label'], 'tours.panoramas[].hotspots[]');
      assertNumberInRange(hotspot.x, 0, 100, 'panorama hotspot x');
      assertNumberInRange(hotspot.y, 0, 100, 'panorama hotspot y');
      assertString(hotspot.toRoom, 40, 'panorama hotspot target', true);
      assertString(hotspot.label || '', maxLengths.label, 'panorama hotspot label');
    }
  }

  const theme = input.theme;
  if (!isPlainObject(theme)) throw new Error('theme must be an object.');
  assertKeys(theme, ['primary', 'background', 'text'], 'theme');
  assertHexColor(theme.primary, 'theme.primary');
  assertHexColor(theme.background, 'theme.background');
  assertHexColor(theme.text, 'theme.text');

  // Optional so content written before this field existed still validates.
  const textStyles = input.textStyles === undefined ? {} : input.textStyles;
  if (!isPlainObject(textStyles)) throw new Error('textStyles must be an object.');
  assertKeys(textStyles, textStyleKeys, 'textStyles');
  for (const [key, style] of Object.entries(textStyles)) {
    if (!isPlainObject(style)) throw new Error(`textStyles.${key} is invalid.`);
    assertKeys(style, ['size', 'font'], `textStyles.${key}`);
    if (style.size !== undefined) assertNumberInRange(style.size, 8, 120, `textStyles.${key}.size`);
    if (style.font !== undefined && !textFontIds.includes(style.font)) {
      throw new Error(`textStyles.${key}.font must be one of: ${textFontIds.join(', ')}.`);
    }
  }
  return input;
}

// One-time upgrade, in place, from the single-image `tours.panoramaImage`
// field (pre-multi-room) to the `tours.panoramas` array. A file saved under
// the old schema still has `panoramaImage` sitting alongside the new
// `panoramas` key after mergeContent (merge adds/overrides by key, it doesn't
// drop keys the new defaults no longer have), and validateContent's
// assertKeys would reject that leftover key outright -- so this must both
// migrate a real value across and always delete the old key, whether or not
// there was anything to migrate.
function migrateLegacyTours(content) {
  const tours = content.tours;
  if (!tours || typeof tours !== 'object') return;
  const legacyImage = tours.panoramaImage;
  if (legacyImage && (!Array.isArray(tours.panoramas) || !tours.panoramas.length)) {
    tours.panoramas = [{ label: 'Venue', image: legacyImage }];
  }
  delete tours.panoramaImage;
}

function readContent() {
  if (!fs.existsSync(contentFile)) return clone(defaults);
  try {
    const { revision, updatedAt, ...parsed } = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
    // Backfills any section/field the schema has grown since this file was
    // last written (e.g. `about`/`theme` didn't always exist) -- without
    // this, a file saved under an older schema fails validateContent's
    // required-key checks outright and this whole function falls back to
    // clone(defaults), silently discarding every real edit it has ever seen.
    // `defaults` itself carries revision/updatedAt (for the plain
    // clone(defaults) fallback elsewhere), so those have to come back out
    // post-merge or assertKeys rejects them as top-level content fields.
    const { revision: _r, updatedAt: _u, ...defaultsContentOnly } = defaults;
    const merged = mergeContent(defaultsContentOnly, parsed);
    migrateLegacyTours(merged);
    return { ...validateContent(merged), revision: Number(revision) || 0, updatedAt: updatedAt || '' };
  } catch (error) {
    console.error('Failed to read site content; using defaults.', error.message || error);
    return clone(defaults);
  }
}

function writeContent(next) {
  const { revision, updatedAt, ...contentOnly } = next;
  validateContent(contentOnly);
  fs.mkdirSync(contentDir, { recursive: true });
  const payload = { ...clone(contentOnly), revision: Number(revision || 0) + 1, updatedAt: new Date().toISOString() };
  const tempFile = `${contentFile}.${process.pid}.tmp`;
  if (fs.existsSync(contentFile)) fs.copyFileSync(contentFile, backupFile);
  fs.writeFileSync(tempFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempFile, contentFile);
  return payload;
}

function mergeContent(current, patch) {
  if (!isPlainObject(patch)) throw new Error('Content update must be an object.');
  const merge = (left, right) => {
    if (!isPlainObject(right)) return right;
    const result = { ...left };
    for (const [key, value] of Object.entries(right)) {
      result[key] = isPlainObject(value) && isPlainObject(result[key])
        ? merge(result[key], value)
        : value;
    }
    return result;
  };
  return merge(current, patch);
}

module.exports = { defaults, readContent, writeContent, validateContent, mergeContent };
