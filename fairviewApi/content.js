const fs = require('fs');
const path = require('path');

const contentDir = path.join(__dirname, '../storage/content');
const contentFile = path.join(contentDir, 'site-content.json');
const backupFile = path.join(contentDir, 'site-content.json.bak');

const defaults = {
  revision: 0,
  updatedAt: '',
  site: {
    brand: 'Your Business Name',
    title: 'Your Business Name',
    description: 'A thoughtful visual studio for people, places, and stories.',
    contactEmail: 'hello@example.com',
    footerText: 'All rights reserved.',
    socialLinks: []
  },
  navigation: {
    home: { label: 'Home', visible: true },
    about: { label: 'About', visible: true },
    eventCenter: { label: 'Event Center', visible: true },
    church: { label: 'Church', visible: true }
  },
  hero: {
    eyebrow: 'Fairview Community Center',
    headline: 'A place to gather, worship, and grow.',
    intro: 'Home to Greater Harvest Church and open to the community for events, meetings, and celebrations.',
    ctaLabel: 'Plan your event',
    ctaTarget: 'eventCenter',
    video: '',
    poster: ''
  },
  statement: {
    eyebrow: 'Welcome',
    heading: 'Faith, fellowship, and community space.',
    copy: 'Join us for worship, or book the space for your next event.'
  },
  church: {
    eyebrow: 'Greater Harvest Church',
    heading: 'Worship, community, and belonging.',
    body: 'Service times and ministries are coming soon.'
  },
  contact: {
    eyebrow: 'Get in touch',
    heading: "Questions about worship or booking the center? Let's talk.",
    email: 'hello@example.com'
  },
  tours: { communityCenter: '', church: '' }
};

const maxLengths = {
  brand: 80, title: 120, description: 320, contactEmail: 254, footerText: 180,
  eyebrow: 100, headline: 180, intro: 500, ctaLabel: 80, heading: 180, copy: 600,
  paragraph: 1200, label: 60, media: 300, serviceName: 100, serviceText: 600,
  workTitle: 120, category: 80
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

function assertKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${field}.${key} is not editable.`);
  }
}

function validateContent(input) {
  if (!isPlainObject(input)) throw new Error('Content must be an object.');
  assertKeys(input, ['site', 'navigation', 'hero', 'statement', 'church', 'contact', 'tours'], 'content');

  const site = input.site;
  if (!isPlainObject(site)) throw new Error('site must be an object.');
  assertKeys(site, ['brand', 'title', 'description', 'contactEmail', 'footerText', 'socialLinks'], 'site');
  for (const field of ['brand', 'title', 'description', 'contactEmail', 'footerText']) assertString(site[field], maxLengths[field], `site.${field}`, field !== 'footerText');
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
  assertKeys(navigation, ['home', 'about', 'eventCenter', 'church'], 'navigation');
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
  for (const field of ['eyebrow', 'headline', 'intro', 'ctaLabel', 'ctaTarget']) assertString(hero[field], maxLengths[field], `hero.${field}`, true);
  assertMediaReference(hero.video, 'hero.video');
  assertMediaReference(hero.poster, 'hero.poster');

  const statement = input.statement;
  if (!isPlainObject(statement)) throw new Error('statement must be an object.');
  assertKeys(statement, ['eyebrow', 'heading', 'copy'], 'statement');
  assertString(statement.eyebrow, maxLengths.eyebrow, 'statement.eyebrow', true);
  assertString(statement.heading, maxLengths.heading, 'statement.heading', true);
  assertString(statement.copy, maxLengths.copy, 'statement.copy', true);

  const church = input.church;
  if (!isPlainObject(church)) throw new Error('church must be an object.');
  assertKeys(church, ['eyebrow', 'heading', 'body'], 'church');
  assertString(church.eyebrow, maxLengths.eyebrow, 'church.eyebrow', true);
  assertString(church.heading, maxLengths.heading, 'church.heading', true);
  assertString(church.body, maxLengths.paragraph, 'church.body', true);

  const contact = input.contact;
  if (!isPlainObject(contact)) throw new Error('contact must be an object.');
  assertKeys(contact, ['eyebrow', 'heading', 'email'], 'contact');
  assertString(contact.eyebrow, maxLengths.eyebrow, 'contact.eyebrow', true);
  assertString(contact.heading, maxLengths.heading, 'contact.heading', true);
  assertString(contact.email, maxLengths.contactEmail, 'contact.email', true);

  const tours = input.tours;
  if (!isPlainObject(tours)) throw new Error('tours must be an object.');
  assertKeys(tours, ['communityCenter', 'church'], 'tours');
  assertEmbedUrl(tours.communityCenter, 'tours.communityCenter');
  assertEmbedUrl(tours.church, 'tours.church');
  return input;
}

function readContent() {
  if (!fs.existsSync(contentFile)) return clone(defaults);
  try {
    const { revision, updatedAt, ...parsed } = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
    return { ...validateContent(parsed), revision: Number(revision) || 0, updatedAt: updatedAt || '' };
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
