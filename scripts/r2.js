// Cloudflare R2 access, shared by the sync script and the API.
//
// R2 speaks the S3 API, so we use the AWS SDK pointed at the R2 endpoint.
//
// Object keys deliberately keep the `assets/gallery/<category>/<file>` prefix
// that the app already uses for local media. Both getProductImageKey() in the
// Angular app and toGalleryRelativeImage() in the API strip protocol+host
// before matching on that prefix, so absolute CDN URLs flow through the
// existing gallery logic without any change to either.

const path = require('path');

const MEDIA_PREFIX = 'assets/gallery';

// Human-written titles and descriptions for the gallery, keyed by
// `<category>/<file>`. It lives beside the media in the bucket because the
// manifest can be built from the bucket alone, on a machine that has never
// held the photos -- descriptions have to be reachable from there too.
//
// Three path segments, not four, so fromObjectKey() below rejects it and it
// never turns up as a gallery item.
const DESCRIPTIONS_KEY = `${MEDIA_PREFIX}/descriptions.json`;
const DESCRIPTIONS_FILE = 'descriptions.json';

const config = {
  accountId: String(process.env.R2_ACCOUNT_ID || '').trim(),
  accessKeyId: String(process.env.R2_ACCESS_KEY_ID || '').trim(),
  secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY || '').trim(),
  bucket: String(process.env.R2_BUCKET || '').trim(),
  // Public base URL media is served from, e.g. https://media.fairview-event-center.com
  // (a custom domain bound to the bucket). No trailing slash.
  cdnUrl: String(process.env.MEDIA_CDN_URL || '').trim().replace(/\/+$/, '')
};

function isR2Configured() {
  return Boolean(config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket);
}

// Media is served from the CDN only once a public base URL is set. Until then
// everything falls back to local disk, so dev and a half-finished migration
// both keep working.
//
// The S3 API endpoint (<account>.r2.cloudflarestorage.com) is a tempting but
// wrong value here: it only answers SigV4-signed requests, so a browser gets
// 401/403 and the gallery silently goes blank. Refuse it rather than emit 154
// broken URLs.
let warnedAboutS3Endpoint = false;

function isCdnEnabled() {
  if (!config.cdnUrl) return false;
  if (/\.r2\.cloudflarestorage\.com/i.test(config.cdnUrl)) {
    if (!warnedAboutS3Endpoint) {
      warnedAboutS3Endpoint = true;
      console.warn(
        'MEDIA_CDN_URL points at the R2 S3 API endpoint, which cannot serve public reads.\n' +
        'Bind a custom domain to the bucket and use that instead. ' +
        'Serving gallery media from local disk for now.'
      );
    }
    return false;
  }
  return true;
}

function createR2Client() {
  if (!isR2Configured()) return null;
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

// storage/media/beach/foo.jpg -> assets/gallery/beach/foo.jpg
function toObjectKey(relativePath) {
  const normalized = String(relativePath).split(path.sep).join('/').replace(/^\/+/, '');
  return `${MEDIA_PREFIX}/${normalized}`;
}

// assets/gallery/beach/foo.jpg -> https://media.example.com/assets/gallery/beach/foo.jpg
function toPublicUrl(objectKey) {
  if (!config.cdnUrl) return objectKey;
  const encoded = objectKey.split('/').map(encodeURIComponent).join('/');
  return `${config.cdnUrl}/${encoded}`;
}

// Every media object in the bucket, keyed as `assets/gallery/<category>/<file>`.
// This is what lets the manifest be built from the bucket rather than from
// local disk: a machine that has never held the photos can still describe the
// gallery correctly, because the bucket is what actually serves it.
async function listMediaObjects(client) {
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const objects = [];
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: `${MEDIA_PREFIX}/`,
      ContinuationToken: token
    }));
    for (const object of page.Contents || []) {
      objects.push({ key: object.Key, size: object.Size });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

// assets/gallery/beach/foo.jpg -> { folder: 'beach', name: 'foo.jpg' }
// Anything not shaped like that (a stray top-level object, a deeper nesting)
// returns null and is skipped by callers.
function fromObjectKey(objectKey) {
  const parts = String(objectKey || '').split('/');
  if (parts.length !== 4) return null;
  const [assets, gallery, folder, name] = parts;
  if (`${assets}/${gallery}` !== MEDIA_PREFIX || !folder || !name) return null;
  return { folder: folder.toLowerCase(), name };
}

// Body of a single object, or null when it is simply not there yet. A missing
// descriptions file is an ordinary state -- nobody has written one -- so it
// must not read as a bucket failure and send the manifest to its local
// fallback.
async function getObjectText(client, key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    return await response.Body.transformToString();
  } catch (error) {
    const code = error?.name || error?.Code;
    if (code === 'NoSuchKey' || code === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.json': 'application/json'
};

function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  config,
  MEDIA_PREFIX,
  DESCRIPTIONS_KEY,
  DESCRIPTIONS_FILE,
  isR2Configured,
  isCdnEnabled,
  createR2Client,
  listMediaObjects,
  getObjectText,
  toObjectKey,
  fromObjectKey,
  toPublicUrl,
  contentTypeFor
};
