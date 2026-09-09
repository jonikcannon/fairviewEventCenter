#!/usr/bin/env node
// Rename gallery objects in R2 to match a reviewed CSV, server-side.
//
//   npm run media:rename -- aerial-rename-review.csv            preview
//   npm run media:rename -- aerial-rename-review.csv --apply    do it
//
// Why this exists instead of re-uploading with media:sync:
//
// The bucket's images are NOT the files on local disk. watermark-media.js
// stamps each public image in place and keeps the clean master under
// `originals/`, so the public object is watermarked bytes that exist nowhere
// else. Re-uploading from disk would silently strip the watermark off the
// whole gallery.
//
// CopyObject runs inside R2: no bytes cross the wire, and the default
// MetadataDirective of COPY carries the `watermarked=1` flag and the
// Cache-Control across, which keeps watermark-media.js idempotent afterwards.
//
// Both prefixes move together. Purchases resolve to `originals/<key>` and fall
// back to the gallery key when it is missing (server.js), so renaming only the
// public object would quietly start delivering watermarked images to buyers.
//
// Re-running is safe: a row already renamed is counted as done, not retried.

require('dotenv').config();
const path = require('path');
const {
  config, MEDIA_PREFIX, isR2Configured, createR2Client, toObjectKey
} = require('./r2');
const { readReviewCsv } = require('./review-csv');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const csvPath = args.find((arg) => !arg.startsWith('--'));

const ORIGINALS_PREFIX = 'originals/';
// Mirrors toOriginalKey() in server.js and watermark-media.js.
const toOriginalKey = (galleryKey) => galleryKey.replace(new RegExp(`^${MEDIA_PREFIX}/`), ORIGINALS_PREFIX);

if (!csvPath) {
  console.error('Usage: npm run media:rename -- <review.csv> [--apply]');
  process.exit(1);
}

async function head(client, key) {
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  try {
    return await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (error) {
    const code = error?.name || error?.Code;
    if (code === 'NotFound' || code === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function copyThenDelete(client, from, to) {
  const { CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  // CopySource is a URL path, so each segment needs encoding -- an unencoded
  // space or '#' in a filename would otherwise address the wrong object.
  const source = [config.bucket, ...from.split('/')].map(encodeURIComponent).join('/');
  await client.send(new CopyObjectCommand({ Bucket: config.bucket, Key: to, CopySource: source }));
  // Only after the copy is acknowledged, so a failure leaves the original.
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: from }));
}

// One row becomes up to two moves: the public object, and its clean master.
// Videos have no master (watermark-media.js skips them), which is expected
// rather than an error.
function movesFor(row) {
  // A row that only supplies a title and description for an already
  // well-named file moves nothing. Without this the object would be compared
  // against itself and refused as "already exists".
  if (row.old_name === row.new_name) return [];
  const fromGallery = toObjectKey(`${row.category}/${row.old_name}`);
  const toGallery = toObjectKey(`${row.category}/${row.new_name}`);
  return [
    { label: 'gallery', from: fromGallery, to: toGallery, required: true },
    { label: 'master', from: toOriginalKey(fromGallery), to: toOriginalKey(toGallery), required: false }
  ];
}

// Everything is inspected before anything moves. A half-applied rename across
// two prefixes is considerably worse than a refusal.
async function preflight(client, rows) {
  const problems = [];
  const planned = [];
  const seen = new Map();
  // Two distinct non-actions worth telling apart: a row already renamed on a
  // previous run, and an image-only master that a video was never going to
  // have. Counting them together reads as "11 already done" for a set where
  // nothing had been done.
  let alreadyRenamed = 0;
  let withoutMaster = 0;

  for (const row of rows) {
    const label = `${row.category}/${row.old_name}`;
    if (!row.new_name) { problems.push(`${label}: no new_name`); continue; }
    if (path.extname(row.old_name).toLowerCase() !== path.extname(row.new_name).toLowerCase()) {
      problems.push(`${label}: extension changes to ${row.new_name} -- a rename must not reinterpret the file`);
    }
    const key = `${row.category}/${row.new_name}`.toLowerCase();
    if (seen.has(key)) problems.push(`${label}: new_name collides with ${seen.get(key)}`);
    else seen.set(key, label);

    for (const move of movesFor(row)) {
      const [source, target] = await Promise.all([head(client, move.from), head(client, move.to)]);
      if (!source) {
        if (target) { alreadyRenamed++; continue; }
        if (move.required) problems.push(`${label}: no ${move.label} object at ${move.from}`);
        else withoutMaster++;                        // absent master is normal for video
        continue;
      }
      if (target) {
        problems.push(`${label}: ${move.to} already exists -- refusing to overwrite it`);
        continue;
      }
      planned.push({ ...move, row, watermarked: source.Metadata?.watermarked === '1' });
    }
  }
  return { problems, planned, alreadyRenamed, withoutMaster };
}

async function main() {
  if (!isR2Configured()) {
    console.error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,');
    console.error('R2_SECRET_ACCESS_KEY and R2_BUCKET in .env (see .env.example).');
    process.exit(1);
  }

  let rows;
  try {
    rows = readReviewCsv(csvPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const client = createR2Client();
  console.log(`${rows.length} row(s) from ${csvPath}`);
  console.log(`Bucket: ${config.bucket}\n`);

  const { problems, planned, alreadyRenamed, withoutMaster } = await preflight(client, rows);
  if (problems.length) {
    console.error(`Refusing to run -- ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  if (!planned.length) {
    console.log('Nothing to move; every row is already renamed in the bucket.');
    return;
  }

  let moved = 0, failed = 0;
  for (const move of planned) {
    const mark = move.watermarked ? ' [watermarked]' : '';
    if (!apply) {
      console.log(`  [preview] ${move.label}${mark}  ${move.from}  ->  ${path.basename(move.to)}`);
      continue;
    }
    process.stdout.write(`  ${move.label}${mark}  ${move.from}  ->  ${path.basename(move.to)} ... `);
    try {
      await copyThenDelete(client, move.from, move.to);
      console.log('ok');
      moved++;
    } catch (error) {
      console.log(`FAILED: ${error.message || error}`);
      failed++;
    }
  }

  if (!apply) {
    console.log(`\nPREVIEW - nothing changed. ${planned.length} object(s) would move.`);
    console.log('Re-run with --apply to perform the rename.');
    return;
  }

  console.log(`\nmoved ${moved}  failed ${failed}`);
  if (alreadyRenamed) console.log(`${alreadyRenamed} object(s) were already renamed.`);
  if (withoutMaster) console.log(`${withoutMaster} row(s) had no originals/ master (expected for video).`);
  console.log('\nNext:\n  npm run manifest   rebuild the manifest against the new keys');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Rename failed:', error.message || error);
  process.exit(1);
});
