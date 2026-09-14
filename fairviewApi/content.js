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
    poster: ''
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
    email: 'hello@example.com'
  },
  tours: { communityCenter: '' },
  theme: { primary: '#26362e', background: '#f4f2ec', text: '#1f211d' }
};

const maxLengths = {
  brand: 80, title: 120, description: 320, contactEmail: 254, footerText: 180,
  eyebrow: 100, headline: 180, intro: 500, ctaLabel: 80, heading: 180, copy: 600,
  paragraph: 1200, label: 60, media: 300, serviceName: 100, serviceText: 600,
  workTitle: 120, category: 80, featureTitle: 80, featureText: 400
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
  assertKeys(input, ['site', 'navigation', 'hero', 'statement', 'about', 'contact', 'tours', 'theme'], 'content');

  const site = input.site;
  if (!isPlainObject(site)) throw new Error('site must be an object.');
  assertKeys(site, ['brand', 'title', 'description', 'contactEmail', 'footerText', 'socialLinks', 'logo'], 'site');
  for (const field of ['brand', 'title', 'description', 'contactEmail', 'footerText']) assertString(site[field], maxLengths[field], `site.${field}`, field !== 'footerText');
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
  assertKeys(hero, ['eyebrow', 'headline', 'intro', 'ctaLabel', 'ctaTarget', 'video', 'poster'], 'hero');
  for (const field of ['eyebrow', 'headline', 'intro', 'ctaLabel']) assertString(hero[field], maxLengths[field], `hero.${field}`, true);
  // A free-text target would let a typo silently break the hero button (it
  // drives goToSection(), which just no-ops on an unknown section), so this
  // is a closed set rather than assertString.
  if (!['home', 'about', 'eventCenter', 'booking', 'contact'].includes(hero.ctaTarget)) {
    throw new Error('hero.ctaTarget must be one of: home, about, eventCenter, booking, contact.');
  }
  assertMediaReference(hero.video, 'hero.video');
  assertMediaReference(hero.poster, 'hero.poster');

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
    assertKeys(feature, ['title', 'description', 'image'], 'about.features[]');
    assertString(feature.title, maxLengths.featureTitle, 'feature title', true);
    assertString(feature.description, maxLengths.featureText, 'feature description', true);
    assertMediaReference(feature.image, 'feature image');
  }

  const contact = input.contact;
  if (!isPlainObject(contact)) throw new Error('contact must be an object.');
  assertKeys(contact, ['eyebrow', 'heading', 'email'], 'contact');
  assertString(contact.eyebrow, maxLengths.eyebrow, 'contact.eyebrow', true);
  assertString(contact.heading, maxLengths.heading, 'contact.heading', true);
  assertString(contact.email, maxLengths.contactEmail, 'contact.email', true);

  const tours = input.tours;
  if (!isPlainObject(tours)) throw new Error('tours must be an object.');
  assertKeys(tours, ['communityCenter'], 'tours');
  assertEmbedUrl(tours.communityCenter, 'tours.communityCenter');

  const theme = input.theme;
  if (!isPlainObject(theme)) throw new Error('theme must be an object.');
  assertKeys(theme, ['primary', 'background', 'text'], 'theme');
  assertHexColor(theme.primary, 'theme.primary');
  assertHexColor(theme.background, 'theme.background');
  assertHexColor(theme.text, 'theme.text');
  return input;
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
