#!/usr/bin/env node
// Apply a reviewed rename/description CSV to the local media library.
//
//   node scripts/apply-media-names.js aerial-rename-review.csv              preview
//   node scripts/apply-media-names.js aerial-rename-review.csv --apply      do it
//
// Columns: category,old_name,new_name,title,description,media_type
//
// This only touches disk. Carry the same rename into the bucket with
// `npm run media:rename -- <csv> --apply`, which copies objects server-side.
//
// Do NOT push a rename with `npm run media:sync`: the bucket's images are
// watermarked in place by watermark-media.js and local disk holds the clean
// originals, so a sync would replace the public gallery with unwatermarked
// files. See rename-r2-objects.js.
//
// Re-running is safe: a row whose old file is gone and whose new file is
// already in place counts as done, not as an error.

const fs = require('fs');
const path = require('path');
const { resolveMediaDir } = require('./media-dir');
const { DESCRIPTIONS_FILE } = require('./r2');
const { readReviewCsv } = require('./review-csv');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const csvPath = args.find((arg) => !arg.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node scripts/apply-media-names.js <review.csv> [--apply]');
  process.exit(1);
}

// Everything that would make the rename unsafe, collected before anything
// moves. A partial rename is far more painful to unpick than a refusal.
function findProblems(rows, mediaDir) {
  const problems = [];
  const seen = new Map();

  for (const row of rows) {
    const label = `${row.category}/${row.old_name}`;
    const from = path.join(mediaDir, row.category, row.old_name);
    const to = path.join(mediaDir, row.category, row.new_name);

    if (!row.new_name) problems.push(`${label}: no new_name`);
    if (path.extname(row.old_name).toLowerCase() !== path.extname(row.new_name).toLowerCase()) {
      problems.push(`${label}: extension changes to ${row.new_name} -- renaming must not reinterpret the file`);
    }

    const key = `${row.category}/${row.new_name}`.toLowerCase();
    if (seen.has(key)) problems.push(`${label}: new_name collides with ${seen.get(key)}`);
    else seen.set(key, label);

    // A file whose name is already right still deserves a description, so a row
    // that renames nothing is legitimate -- and must not be read as a file
    // colliding with itself.
    if (row.old_name === row.new_name) {
      if (!fs.existsSync(from)) problems.push(`${label}: no such file`);
      continue;
    }

    if (!fs.existsSync(from)) {
      // Already applied is fine; genuinely missing is not.
      if (!fs.existsSync(to)) problems.push(`${label}: no such file`);
    } else if (fs.existsSync(to)) {
      problems.push(`${label}: ${row.new_name} already exists and is a different file`);
    }
  }
  return problems;
}

// The manifest covers media the gallery discovers at runtime, but a handful of
// gallery paths are hard-coded in the app (hero video, service tiles, the about
// portrait). Those do not follow a rename, and the break is silent: the page
// still renders, the media just 404s. So look for them and say so.
function findHardcodedReferences(rows) {
  const srcDir = path.resolve(__dirname, '../src');
  if (!fs.existsSync(srcDir)) return [];

  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|html)$/.test(entry.name)) files.push(full);
    }
  })(srcDir);

  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const row of rows) {
      if (row.old_name === row.new_name) continue;
      if (!text.includes(row.old_name)) continue;
      const line = text.slice(0, text.indexOf(row.old_name)).split('\n').length;
      hits.push({
        file: path.relative(path.resolve(__dirname, '..'), file),
        line,
        from: `${row.category}/${row.old_name}`,
        to: row.new_name
      });
    }
  }
  return hits;
}

function mergeDescriptions(rows, mediaDir) {
  const file = path.join(mediaDir, DESCRIPTIONS_FILE);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const row of rows) {
    // Order matters: on a description-only row the two keys are the same one,
    // so deleting after writing would throw the description straight away.
    if (row.old_name !== row.new_name) {
      // The old key would otherwise linger and re-describe whatever later
      // takes that filename.
      delete existing[`${row.category}/${row.old_name}`];
    }
    existing[`${row.category}/${row.new_name}`] = { title: row.title, description: row.description };
  }
  const sorted = Object.fromEntries(Object.keys(existing).sort().map((key) => [key, existing[key]]));
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  return { file, total: Object.keys(sorted).length };
}

function main() {
  const mediaDir = resolveMediaDir();
  let rows;
  try {
    rows = readReviewCsv(csvPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`${rows.length} row(s) from ${csvPath}`);
  console.log(`Media dir: ${mediaDir}\n`);

  const problems = findProblems(rows, mediaDir);
  if (problems.length) {
    console.error(`Refusing to run -- ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  // Reported, not fatal: the rename is still correct, but these source
  // references have to move with it or the app will request a dead URL.
  const hardcoded = findHardcodedReferences(rows);
  if (hardcoded.length) {
    console.log(`${hardcoded.length} hard-coded reference(s) in src/ point at a file this CSV renames:`);
    for (const hit of hardcoded) console.log(`  ${hit.file}:${hit.line}  ${hit.from}  ->  ${hit.to}`);
    console.log('Update these by hand; nothing else tracks them.\n');
  }

  let renamed = 0, already = 0, describedOnly = 0;
  for (const row of rows) {
    const from = path.join(mediaDir, row.category, row.old_name);
    const to = path.join(mediaDir, row.category, row.new_name);
    if (row.old_name === row.new_name) { describedOnly++; continue; }
    if (!fs.existsSync(from)) { already++; continue; }
    if (!apply) {
      console.log(`  [preview] ${row.category}/${row.old_name}  ->  ${row.new_name}`);
      renamed++;
      continue;
    }
    fs.renameSync(from, to);
    console.log(`  renamed ${row.category}/${row.old_name}  ->  ${row.new_name}`);
    renamed++;
  }

  if (!apply) {
    console.log(`\nPREVIEW - nothing changed. ${renamed} to rename, ${already} already done, ${describedOnly} description-only.`);
    console.log('Re-run with --apply to rename and write descriptions.');
    return;
  }

  const { file, total } = mergeDescriptions(rows, mediaDir);
  console.log(`\nrenamed ${renamed}  already-done ${already}  description-only ${describedOnly}`);
  console.log(`${file} now describes ${total} file(s).`);
  console.log(`\nNext:\n  npm run media:rename -- ${csvPath} --apply   rename the bucket objects too\n  npm run manifest                            rebuild captions from descriptions.json`);
}

main();
