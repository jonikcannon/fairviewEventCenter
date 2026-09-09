#!/usr/bin/env node
// Publish browser-playable versions of the gallery videos.
//
//   npm run webify:dry                 report what would change
//   npm run webify                     do it
//   npm run webify -- --only aerial    one category
//
// Why this exists: the drone and phone originals are HEVC (H.265). Chrome and
// Firefox cannot decode HEVC in <video> -- canPlayType returns "" for both
// hvc1 and hev1 -- so those clips fail with MEDIA_ERR_SRC_NOT_SUPPORTED and
// the player sits black. The files are also 4K at ~18 Mbps, which is far more
// than a gallery preview needs.
//
// This mirrors what watermark-media.js already does for images, and leans on
// the same delivery rule in server.js: fetchOriginalObject() tries
// `originals/<key>` first and falls back to the gallery key. So
//
//   1. copy the untouched HEVC master to `originals/<category>/<file>` -- this
//      is what a buyer receives, and it must exist BEFORE the gallery copy is
//      replaced, or a purchase in that window gets the downgraded file.
//   2. overwrite `assets/gallery/<category>/<file>` with an H.264 re-encode.
//
// The public key never changes, so the manifest, the product records and every
// cached URL keep working, and the buyer still gets the full-quality original.
//
// Idempotent: the published object is tagged webencoded=1 and a tagged object
// is skipped, so an interrupted run resumes instead of re-encoding everything.
// That tag is also what stops media:sync from pushing the HEVC file back over
// the top -- see isDerived() there.

require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveMediaDir, CATEGORIES } = require('./media-dir');
const {
  config: r2Config, isR2Configured, createR2Client, listMediaObjects, fromObjectKey
} = require('./r2');

const WEB_FLAG = 'webencoded';
const ORIGINALS_PREFIX = 'originals/';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
// Re-encode even objects already tagged webencoded=1. Needed when the encoder
// itself changes -- the tag records "a web version was published", not "it was
// published by the current recipe". The master under originals/ is left alone,
// so this re-derives from the local original rather than from the last output.
const force = args.includes('--force');
const onlyFile = args.includes('--file') ? args[args.indexOf('--file') + 1] : '';

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const toOriginalKey = (galleryKey) => galleryKey.replace(/^assets\/gallery\//, ORIGINALS_PREFIX);

// Cap on the long edge of the frame. Compared against max(width, height)
// rather than width, which makes it rotation-invariant: several clips are shot
// portrait and stored landscape with a rotation flag, and ffprobe reports the
// stored dimensions, but the long edge is the same either way.
const LONG_EDGE = 1920;
// Well above the 3 Mbps the encoder targets, so this only catches files that
// are plainly camera masters rather than previews. The raw clips here run
// 17-83 Mbps.
const MAX_MBPS = 6;

function probe(file) {
  const read = (entries, stream = true) => {
    try {
      return execFileSync('ffprobe', [
        '-v', 'error', ...(stream ? ['-select_streams', 'v:0'] : []),
        '-show_entries', entries, '-of', 'default=nw=1:nk=1', file
      ]).toString().trim().split('\n').map((s) => s.trim());
    } catch { return []; }
  };
  const [codec = 'unknown'] = read('stream=codec_name');
  const [w, h] = read('stream=width,height').map(Number);
  const [duration] = read('format=duration', false).map(Number);
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  return {
    codec,
    longEdge: Math.max(w || 0, h || 0),
    mbps: duration > 0 ? (size * 8) / duration / 1e6 : 0
  };
}

// A gallery object is a preview, not a master. Anything the browser cannot
// decode, or that is plainly still a camera file, gets re-encoded.
function needsWebVersion(info) {
  if (info.codec !== 'h264') return `${info.codec} is not browser-decodable`;
  if (info.longEdge > LONG_EDGE) return `${info.longEdge}px long edge`;
  if (info.mbps > MAX_MBPS) return `${info.mbps.toFixed(1)} Mbps`;
  return null;
}

// 1080p H.264 with +faststart. yuv420p because 10-bit HEVC sources decode to
// yuv420p10le, which H.264 High profile players will not touch. Audio is
// dropped: every gallery video is rendered muted.
//
// The scale fits inside a 1920x1920 box rather than pinning width to 1920.
// Several clips are shot portrait and stored landscape with rotation=-90, so
// ffmpeg auto-rotates them before the filter runs -- `scale=1920:-2` would
// then set the SHORT edge to 1920 and hand back a 1920x2560 frame, far more
// pixels than a gallery preview needs. force_divisible_by keeps both edges
// even, which yuv420p requires.
function encode(input, output) {
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-i', input,
    '-vf', 'scale=w=1920:h=1920:force_original_aspect_ratio=decrease:force_divisible_by=2',
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-crf', '23', '-maxrate', '3M', '-bufsize', '6M', '-preset', 'medium',
    '-an', '-movflags', '+faststart',
    output
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

async function head(client, key) {
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  try {
    return await client.send(new HeadObjectCommand({ Bucket: r2Config.bucket, Key: key }));
  } catch (error) {
    const code = error?.name || error?.Code;
    if (code === 'NotFound' || code === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

// Server-side: the master never leaves the bucket, so this costs no bandwidth.
async function preserveMaster(client, galleryKey) {
  const { CopyObjectCommand } = require('@aws-sdk/client-s3');
  const source = [r2Config.bucket, ...galleryKey.split('/')].map(encodeURIComponent).join('/');
  await client.send(new CopyObjectCommand({
    Bucket: r2Config.bucket,
    Key: toOriginalKey(galleryKey),
    CopySource: source
  }));
}

async function publish(client, file, key) {
  const { Upload } = require('@aws-sdk/lib-storage');
  await new Upload({
    client,
    params: {
      Bucket: r2Config.bucket,
      Key: key,
      Body: fs.createReadStream(file),
      ContentType: 'video/mp4',
      Metadata: { [WEB_FLAG]: '1' },
      CacheControl: 'public, max-age=31536000, immutable'
    },
    partSize: 8 * 1024 * 1024,
    queueSize: 4
  }).done();
}

async function main() {
  if (!isR2Configured()) {
    console.error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,');
    console.error('R2_SECRET_ACCESS_KEY and R2_BUCKET in .env (see .env.example).');
    process.exit(1);
  }
  if (only && !CATEGORIES.includes(only)) {
    console.error(`--only ${only} is not a category. Known: ${CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  const mediaDir = resolveMediaDir();
  const client = createR2Client();

  const videos = (await listMediaObjects(client))
    .filter((o) => /\.mp4$/i.test(o.key))
    .map((o) => ({ ...o, parsed: fromObjectKey(o.key) }))
    .filter((o) => o.parsed && CATEGORIES.includes(o.parsed.folder))
    .filter((o) => !only || o.parsed.folder === only)
    .sort((a, b) => a.key.localeCompare(b.key));

  console.log(`${videos.length} gallery video(s) in the bucket${only ? ` (category ${only})` : ''}`);
  if (dryRun) console.log('DRY RUN - nothing will be encoded or uploaded.\n');

  let done = 0, skipped = 0, missing = 0, failed = 0, before = 0, after = 0;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webify-'));

  for (const video of videos) {
    const { folder, name } = video.parsed;
    const local = path.join(mediaDir, folder, name);
    const label = `${folder}/${name}`;

    if (onlyFile && name !== onlyFile) continue;

    const existing = await head(client, video.key);
    if (!force && existing?.Metadata?.[WEB_FLAG] === '1') {
      skipped++;
      continue;
    }
    if (!fs.existsSync(local)) {
      console.log(`  SKIP ${label}: no local copy to encode from`);
      missing++;
      continue;
    }
    const info = probe(local);
    const reason = force ? 'forced' : needsWebVersion(info);
    if (!reason) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] ${label} (${reason}, ${mb(video.size)})`);
      done++;
      continue;
    }

    const output = path.join(tmpDir, name);
    process.stdout.write(`  ${label} (${reason}, ${mb(video.size)}) ... `);
    try {
      // Master first. A failure here must not leave the gallery holding the
      // only copy of the original.
      if (!(await head(client, toOriginalKey(video.key)))) await preserveMaster(client, video.key);

      encode(local, output);
      const size = fs.statSync(output).size;
      await publish(client, output, video.key);
      fs.unlinkSync(output);

      before += video.size;
      after += size;
      done++;
      console.log(`ok -> ${mb(size)} (-${Math.round((1 - size / video.size) * 100)}%)`);
    } catch (error) {
      console.log(`FAILED: ${String(error.message || error).split('\n')[0]}`);
      failed++;
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nencoded ${done}  already-web ${skipped}  no-local-copy ${missing}  failed ${failed}`);
  if (after) console.log(`gallery bytes: ${mb(before)} -> ${mb(after)} (-${Math.round((1 - after / before) * 100)}%)`);
  if (done && !dryRun) console.log('\nMasters preserved under originals/; purchases still resolve to them.');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Webify failed:', error.message || error);
  process.exit(1);
});
