const path = require('path');

// Canonical on-disk home for gallery media. One folder per category; the folder
// name IS the category key (see generate-gallery-manifest.js and the
// /api/admin/gallery/category endpoint, which moves files between these folders).
//
// Local dev:  <repo>/storage/media
// Production: MEDIA_DIR=/var/www/fairview/data/storage/media (nginx serves it directly)
//
// This deliberately sits outside src/, so the Angular build never copies it and
// git never tracks it.
const CATEGORIES = ['community-center', 'church', 'church-services'];

function resolveMediaDir() {
  const configured = String(process.env.MEDIA_DIR || '').trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '../storage/media');
}

module.exports = { resolveMediaDir, CATEGORIES };
