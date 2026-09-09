// Shared reader for the rename/description review CSVs.
//
// Columns: category,old_name,new_name,title,description,media_type
//
// Two scripts consume the same file -- apply-media-names.js renames on disk,
// rename-r2-objects.js renames in the bucket -- and they must agree exactly on
// what a row means, so the parsing lives in one place.

const fs = require('fs');

// Minimal RFC4180: quoted fields, commas inside them, "" as a literal quote.
// Descriptions are prose and always contain commas, so this cannot be a split.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

const REQUIRED = ['category', 'old_name', 'new_name', 'title', 'description'];

function readReviewCsv(file) {
  const parsed = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!parsed.length) throw new Error(`${file} is empty`);
  const [header, ...rest] = parsed;
  const columns = header.map((name) => name.trim());
  const missing = REQUIRED.filter((name) => !columns.includes(name));
  if (missing.length) throw new Error(`${file} is missing column(s): ${missing.join(', ')}`);
  return rest.map((cells) => Object.fromEntries(
    columns.map((name, i) => [name, (cells[i] || '').trim()])
  ));
}

module.exports = { parseCsv, readReviewCsv, REQUIRED };
