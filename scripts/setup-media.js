#!/usr/bin/env node
// Idempotent setup for the gallery media directory.
//
// Creates <MEDIA_DIR>/<category> for every known category, and migrates media
// from the old in-source location (src/assets/gallery) if it is still there.
// Safe to run repeatedly; it never overwrites an existing file.
//
// Runs automatically via `npm start` / `npm run build` (prestart / prebuild).

const fs = require('fs');
const path = require('path');
const { resolveMediaDir, CATEGORIES } = require('./media-dir');

const mediaDir = resolveMediaDir();
const legacyDir = path.resolve(__dirname, '../src/assets/gallery');

function migrateLegacyDir() {
  // A symlink/junction at the old path points at the media dir already.
  if (!fs.existsSync(legacyDir) || fs.lstatSync(legacyDir).isSymbolicLink()) return 0;

  let moved = 0;
  for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const from = path.join(legacyDir, entry.name);
    const to = path.join(mediaDir, entry.name);
    fs.mkdirSync(to, { recursive: true });
    for (const file of fs.readdirSync(from)) {
      const target = path.join(to, file);
      if (fs.existsSync(target)) continue;
      fs.renameSync(path.join(from, file), target);
      moved += 1;
    }
  }

  if (moved > 0) {
    console.log(`Migrated ${moved} file(s) from src/assets/gallery into ${mediaDir}`);
    console.log('Old location can be deleted once you have verified the gallery.');
  }
  return moved;
}

fs.mkdirSync(mediaDir, { recursive: true });
for (const category of CATEGORIES) {
  fs.mkdirSync(path.join(mediaDir, category), { recursive: true });
}
migrateLegacyDir();

console.log(`Media directory ready: ${mediaDir}`);
console.log(`Categories: ${CATEGORIES.join(', ')}`);
