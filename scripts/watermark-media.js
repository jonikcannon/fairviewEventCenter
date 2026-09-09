#!/usr/bin/env node
// Watermark the public gallery and preserve clean masters.
//
//   node scripts/watermark-media.js --dry-run     report what would change
//   node scripts/watermark-media.js --sample <n>  process n images only
//   node scripts/watermark-media.js               process everything
//   node scripts/watermark-media.js --out <dir>   write locally, touch nothing remote
//
// For every gallery image this does two things, in this order:
//
//   1. Copy the untouched file to `originals/<category>/<file>` if it is not
//      already there. That is the master a buyer receives after checkout, and
//      it must exist BEFORE the public copy is overwritten -- otherwise a failure
//      midway would leave a watermarked file as the only remaining version.
//   2. Overwrite `assets/gallery/<category>/<file>` with a watermarked copy at
//      full resolution.
//
// The public key never changes, so the gallery manifest, the product records and
// every cached URL keep working untouched.
//
// Idempotent: the watermarked object is tagged with metadata, and a tagged
// object is skipped. Re-running after an interruption resumes rather than
// double-stamping images that were already done.
//
// Videos are NOT handled here. Watermarking 29 clips means a full re-encode of
// several GB with ffmpeg, which is a different operation with different risks --
// see the README section this script is documented in.

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const {
  config: r2Config, isR2Configured, createR2Client, listMediaObjects, MEDIA_PREFIX
} = require('./r2');

const WATERMARK_FLAG = 'watermarked';
const WATERMARK_TEXT = String(process.env.WATERMARK_TEXT || 'FAIRVIEW EVENT CENTER').trim();
const ORIGINALS_PREFIX = 'originals/';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : '';
const sampleSize = args.includes('--sample') ? Number(args[args.indexOf('--sample') + 1]) || 1 : 0;

// assets/gallery/beach/foo.jpg -> originals/beach/foo.jpg
function toOriginalKey(galleryKey) {
  return galleryKey.replace(new RegExp(`^${MEDIA_PREFIX}/`), ORIGINALS_PREFIX);
}

// A single corner mark is the least intrusive option, but it is also the easiest
// to crop away. WATERMARK_STYLE=tiled repeats the mark diagonally across the
// frame, which cannot be cropped out without destroying the picture -- at the
// cost of a busier portfolio image. Corner is the default.
const WATERMARK_STYLE = String(process.env.WATERMARK_STYLE || 'corner').trim().toLowerCase();

function buildTiledSvg(width, height, text, fontSize) {
  const stepX = Math.round(fontSize * 13);
  const stepY = Math.round(fontSize * 7);
  const marks = [];
  for (let y = Math.round(stepY / 2); y < height + stepY; y += stepY) {
    // Offset every other row so the marks do not line up into obvious columns.
    const offset = ((y / stepY) | 0) % 2 ? Math.round(stepX / 2) : 0;
    for (let x = -stepX + offset; x < width + stepX; x += stepX) {
      marks.push(`<text x="${x}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" letter-spacing="${(fontSize * 0.12).toFixed(2)}" fill="#ffffff" fill-opacity="0.16" transform="rotate(-30 ${x} ${y})">${text}</text>`);
    }
  }
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${marks.join('')}</svg>`);
}

// Scaled to the image so a 6000px master and a 1200px one get a proportionate
// mark rather than a stamp that is invisible on one and overwhelming on the other.
function buildWatermarkSvg(width, height) {
  const fontSize = Math.max(14, Math.round(width * 0.028));
  const pad = Math.round(fontSize * 0.9);
  const text = WATERMARK_TEXT.replace(/[<>&]/g, '');
  if (WATERMARK_STYLE === 'tiled') return buildTiledSvg(width, height, text, Math.max(12, Math.round(width * 0.022)));
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
       <defs>
         <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
           <feDropShadow dx="0" dy="${Math.max(1, Math.round(fontSize * 0.05))}"
                         stdDeviation="${Math.max(1, Math.round(fontSize * 0.06))}"
                         flood-color="#000" flood-opacity="0.45"/>
         </filter>
       </defs>
       <text x="${width - pad}" y="${height - pad}"
             text-anchor="end"
             font-family="Georgia, 'Times New Roman', serif"
             font-size="${fontSize}"
             letter-spacing="${(fontSize * 0.12).toFixed(2)}"
             fill="#ffffff" fill-opacity="0.72"
             filter="url(#s)">${text}</text>
     </svg>`
  );
}

async function watermarkBuffer(input) {
  const image = sharp(input, { failOn: 'none' });
  const meta = await image.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) throw new Error('could not read image dimensions');

  // rotate() applies the EXIF orientation and drops the tag, so the mark cannot
  // end up rotated relative to how the photo is actually displayed.
  const pipeline = sharp(input, { failOn: 'none' }).rotate();
  const oriented = await pipeline.toBuffer({ resolveWithObject: true });
  const w = oriented.info.width;
  const h = oriented.info.height;

  return sharp(oriented.data)
    .composite([{ input: buildWatermarkSvg(w, h), top: 0, left: 0 }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  if (outDir) return runLocal();

  if (!isR2Configured()) {
    console.error('R2 is not configured. Set R2_* in .env, or use --out <dir> to write locally.');
    process.exit(1);
  }

  const { HeadObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = createR2Client();
  const objects = await listMediaObjects(client);
  let images = objects.filter(entry => IMAGE_EXTENSIONS.has(path.extname(entry.key || entry.Key || '').toLowerCase()));
  if (sampleSize) images = images.slice(0, sampleSize);

  console.log(`${images.length} gallery image(s) to consider.`);
  if (dryRun) console.log('DRY RUN -- nothing will be written.\n');

  let stamped = 0, skipped = 0, preserved = 0, failed = 0;

  for (const entry of images) {
    const key = entry.key || entry.Key;
    const originalKey = toOriginalKey(key);
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: r2Config.bucket, Key: key }));
      if (head.Metadata && head.Metadata[WATERMARK_FLAG] === '1') {
        skipped++;
        continue;
      }

      // Step 1: preserve the master before the public copy is touched.
      let masterExists = true;
      try {
        await client.send(new HeadObjectCommand({ Bucket: r2Config.bucket, Key: originalKey }));
      } catch {
        masterExists = false;
      }

      if (dryRun) {
        console.log(`would stamp ${key}${masterExists ? '' : `  (+ preserve master -> ${originalKey})`}`);
        stamped++;
        continue;
      }

      const source = await client.send(new GetObjectCommand({ Bucket: r2Config.bucket, Key: key }));
      const buffer = await streamToBuffer(source.Body);

      if (!masterExists) {
        await client.send(new PutObjectCommand({
          Bucket: r2Config.bucket,
          Key: originalKey,
          Body: buffer,
          ContentType: source.ContentType || 'image/jpeg'
        }));
        preserved++;
      }

      // Step 2: only now overwrite what the public sees.
      const marked = await watermarkBuffer(buffer);
      await client.send(new PutObjectCommand({
        Bucket: r2Config.bucket,
        Key: key,
        Body: marked,
        ContentType: 'image/jpeg',
        Metadata: { [WATERMARK_FLAG]: '1' },
        CacheControl: 'public, max-age=604800'
      }));
      stamped++;
      if (stamped % 10 === 0) console.log(`  ${stamped} stamped...`);
    } catch (error) {
      failed++;
      console.error(`FAILED ${key}: ${error.message || error}`);
    }
  }

  console.log(`\nStamped: ${stamped}   Masters preserved: ${preserved}   Already done: ${skipped}   Failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

// Local mode: stamp files from storage/media into a directory. Touches nothing
// remote, so the look of the mark can be judged before any bucket is modified.
async function runLocal() {
  const { resolveMediaDir } = require('./media-dir');
  const mediaDir = resolveMediaDir();
  fs.mkdirSync(outDir, { recursive: true });

  const files = [];
  for (const category of fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []) {
    const dir = path.join(mediaDir, category);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) files.push(path.join(dir, name));
    }
  }

  const selected = sampleSize ? files.slice(0, sampleSize) : files;
  console.log(`${selected.length} local image(s) -> ${outDir}`);
  for (const file of selected) {
    const marked = await watermarkBuffer(fs.readFileSync(file));
    const target = path.join(outDir, path.basename(file));
    fs.writeFileSync(target, marked);
    console.log(`  ${path.basename(file)} -> ${target}`);
  }
}

// Exported so the watermark itself can be exercised without touching a bucket.
module.exports = { watermarkBuffer, buildWatermarkSvg, buildTiledSvg, toOriginalKey, WATERMARK_FLAG, ORIGINALS_PREFIX, WATERMARK_STYLE };

if (require.main === module) {
  main().catch(error => {
    console.error('Watermarking failed:', error.message || error);
    process.exit(1);
  });
}
