#!/usr/bin/env node
// Sync storage/media/<category>/ to a Cloudflare R2 bucket.
//
//   npm run media:sync -- --dry-run     preview, upload nothing
//   npm run media:sync                  upload new and changed files
//   npm run media:sync -- --prune       also delete objects with no local file
//
// Local disk is the authoring master for NEW media: drop files into a category
// folder, run this, and R2 mirrors it. Safe to re-run -- files whose size
// already matches the stored object are skipped, so an interrupted run resumes.
//
// It is NOT the master for media already published. Two passes derive the
// public copy from the local file and keep the master under `originals/`:
//
//   watermark-media.js  stamps each public image in place
//   webify-videos.js    re-encodes each HEVC video to browser-playable H.264
//
// Either way the published bytes differ from disk by design and can never
// size-match, so without a guard this script would read every one of them as
// "changed" and undo the work -- un-watermarking the gallery, or putting HEVC
// files browsers cannot decode back in front of visitors. A derived object is
// skipped unless --replace-derived says otherwise.
//
// To rename published media, use rename-r2-objects.js, which moves objects
// inside the bucket and keeps the derived bytes intact.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { resolveMediaDir } = require('./media-dir');
const {
  config, MEDIA_PREFIX, isR2Configured, createR2Client, listMediaObjects,
  toObjectKey, toPublicUrl, contentTypeFor, DESCRIPTIONS_KEY, DESCRIPTIONS_FILE
} = require('./r2');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const prune = args.includes('--prune');
// Deliberately verbose: overwriting a watermarked object destroys the only
// copy of those bytes, so it should never be reachable by a short flag or a
// habit.
// --replace-watermarked is kept as an alias: it was the flag's name before
// web-encoded videos joined watermarked images under the same protection.
const replaceDerived = args.includes('--replace-derived') || args.includes('--replace-watermarked');

// Files above this go up in parts rather than one request. The library handles
// the multipart lifecycle; several gallery videos are hundreds of MB.
const MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// What the media walk picks up. Notably this excludes gallery-manifest.json:
// it is regenerated on every build and rewritten by category moves, so it must
// not be served with the immutable cache header used for media below.
// descriptions.json is also excluded here, but unlike the manifest it does go
// to the bucket -- see syncDescriptions(), which sends it with its own TTL.
const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.mp4']);
const isMedia = (file) => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase());

function walk(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, base));
    } else if (entry.isFile()) {
      out.push({ full, relative: path.relative(base, full), size: fs.statSync(full).size });
    }
  }
  return out;
}

// A public object that was produced FROM the local file rather than being a
// copy of it, and so must never be overwritten by one:
//
//   watermarked=1  set by watermark-media.js on every image it stamps
//   webencoded=1   set by webify-videos.js on every H.264 video it publishes
//
// Both differ from disk by design and can never size-match, so without this
// every sync would look at them and see "changed, re-upload" -- undoing the
// stamping or putting an undecodable HEVC file back in the gallery.
//
// Checked only for objects that already exist and failed the size match, so it
// costs one HeadObject per would-be replacement rather than one per file.
async function isDerived(client, key) {
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return head.Metadata?.watermarked === '1' || head.Metadata?.webencoded === '1';
  } catch {
    // Unreadable metadata is not a licence to overwrite: treat it as protected
    // and let the operator decide.
    return true;
  }
}

async function listRemote(client) {
  const remote = new Map();
  for (const object of await listMediaObjects(client)) remote.set(object.key, object.size);
  return remote;
}

// Media is immutable in practice: a changed photo gets a new filename.
const IMMUTABLE = 'public, max-age=31536000, immutable';

// descriptions.json is the exception -- it is edited in place under a stable
// key, so caching it for a year would strand the old copy on every CDN edge
// and silently freeze the gallery's captions.
const DESCRIPTIONS_CACHE = 'public, max-age=300, must-revalidate';

async function upload(client, file, key, cacheControl = IMMUTABLE) {
  const { Upload } = require('@aws-sdk/lib-storage');
  const uploader = new Upload({
    client,
    params: {
      Bucket: config.bucket,
      Key: key,
      Body: fs.createReadStream(file.full),
      ContentType: contentTypeFor(file.full),
      CacheControl: cacheControl
    },
    partSize: MULTIPART_THRESHOLD,
    queueSize: 4
  });
  await uploader.done();
}

// Uploaded on its own rather than through the media loop above: it is not
// media, it needs the shorter TTL, and it is rewritten in place rather than
// replaced under a new name -- so the size-match skip would wrongly consider
// an edit of the same length already uploaded.
async function syncDescriptions(client, mediaDir) {
  const full = path.join(mediaDir, DESCRIPTIONS_FILE);
  if (!fs.existsSync(full)) {
    console.log(`\nNo ${DESCRIPTIONS_FILE} on disk; gallery titles will come from filenames.`);
    return true;
  }
  if (dryRun) {
    console.log(`\n  [dry-run] upload ${DESCRIPTIONS_KEY}`);
    return true;
  }
  process.stdout.write(`\n  upload ${DESCRIPTIONS_KEY} ... `);
  try {
    await upload(client, { full }, DESCRIPTIONS_KEY, DESCRIPTIONS_CACHE);
    console.log('ok');
    return true;
  } catch (error) {
    console.log(`FAILED: ${error.message || error}`);
    return false;
  }
}

async function main() {
  if (!isR2Configured()) {
    console.error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,');
    console.error('R2_SECRET_ACCESS_KEY and R2_BUCKET in .env (see .env.example).');
    process.exit(1);
  }

  const mediaDir = resolveMediaDir();
  const files = walk(mediaDir).filter(f => isMedia(f.relative));
  if (!files.length) {
    console.log(`No media found in ${mediaDir}. Nothing to sync.`);
    return;
  }

  const client = createR2Client();
  console.log(`Local : ${files.length} file(s), ${mb(files.reduce((n, f) => n + f.size, 0))}`);
  console.log(`Bucket: ${config.bucket} (prefix ${MEDIA_PREFIX}/)`);
  if (dryRun) console.log('DRY RUN - nothing will be uploaded.\n');

  const remote = await listRemote(client);
  console.log(`Remote: ${remote.size} existing object(s)\n`);

  let uploaded = 0, skipped = 0, failed = 0, bytes = 0, protectedCount = 0;
  const localKeys = new Set();

  for (const file of files) {
    const key = toObjectKey(file.relative);
    localKeys.add(key);

    // Size match is the cheap proxy for "already uploaded". Sufficient here
    // because these files are write-once; a re-edit lands under a new name.
    if (remote.get(key) === file.size) {
      skipped++;
      continue;
    }

    // A published image differs from disk because it was stamped; a published
    // video because it was re-encoded for the browser. Either way disk is not
    // newer, and replacing it would undo the derivation.
    if (remote.has(key) && !replaceDerived && await isDerived(client, key)) {
      protectedCount++;
      continue;
    }

    const verb = remote.has(key) ? 'replace' : 'upload';
    if (dryRun) {
      console.log(`  [dry-run] ${verb} ${key} (${mb(file.size)})`);
      uploaded++;
      bytes += file.size;
      continue;
    }

    process.stdout.write(`  ${verb} ${key} (${mb(file.size)}) ... `);
    try {
      await upload(client, file, key);
      console.log('ok');
      uploaded++;
      bytes += file.size;
    } catch (error) {
      console.log(`FAILED: ${error.message || error}`);
      failed++;
    }
  }

  if (!await syncDescriptions(client, mediaDir)) failed++;
  // Not produced by the media walk, so --prune below would otherwise read it
  // as an object with no local file and delete the captions it just uploaded.
  localKeys.add(DESCRIPTIONS_KEY);

  if (prune) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const orphans = [...remote.keys()].filter(key => !localKeys.has(key));
    for (const key of orphans) {
      if (dryRun) {
        console.log(`  [dry-run] delete ${key}`);
        continue;
      }
      process.stdout.write(`  delete ${key} ... `);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
        console.log('ok');
      } catch (error) {
        console.log(`FAILED: ${error.message || error}`);
        failed++;
      }
    }
    if (orphans.length) console.log(`\n${orphans.length} orphaned object(s) handled.`);
  }

  console.log(`\nuploaded ${uploaded}  skipped ${skipped}  protected ${protectedCount}  failed ${failed}  (${mb(bytes)} transferred)`);
  if (protectedCount) {
    console.log(`\n${protectedCount} derived object(s) left untouched.`);
    console.log('They differ from disk because the bucket copy is watermarked or re-encoded');
    console.log('for the browser, and disk holds the master. That is expected, not drift.');
    console.log('\nTo rename published media, keeping the derived bytes:');
    console.log('  npm run media:rename -- <review.csv> --apply');
    console.log('To genuinely re-publish from disk (DROPS watermarks and re-publishes HEVC):');
    console.log('  npm run media:sync -- --replace-derived');
  }
  if (config.cdnUrl) {
    console.log(`\nPublic URL example:\n  ${toPublicUrl(toObjectKey(files[0].relative))}`);
    console.log('\nRegenerate the manifest so it points at the CDN:\n  npm run manifest');
  } else {
    console.log('\nMEDIA_CDN_URL is not set, so the app still serves media from local disk.');
    console.log('Set it to your R2 public domain, then run: npm run manifest');
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Sync failed:', error.message || error);
  process.exit(1);
});
