/**
 * generate-manifest.js
 *
 * Scans assets/images/{brand}/ and injects IMAGES_DATA directly into index.html.
 * Run manually:  node generate-manifest.js
 *
 * Naming convention for image files:
 *   1_1 Visual Name.png   → 1:1 (LinkedIn square) version
 *   9_16 Visual Name.png  → 9:16 (Stories) version
 *
 * Files with matching names after stripping the ratio prefix are automatically
 * paired into a single picker entry. A visual only appears once in the UI even
 * though you supply two separate image files for the two output formats.
 *
 * If you only supply one format, the tool uses that file for both outputs.
 */

const fs   = require('fs');
const path = require('path');

const BRANDS      = ['overwolf', 'tebex', 'outplayed'];
const IMAGE_EXTS  = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const HTML_FILE   = path.join(__dirname, 'index.html');

// Support both 'assets' (lowercase, git/Netlify standard) and 'Assets' (Windows default)
var IMAGES_DIR    = path.join(__dirname, 'assets', 'images');
var ASSETS_PREFIX = 'assets';
if (!fs.existsSync(IMAGES_DIR)) {
  var alt = path.join(__dirname, 'Assets', 'images');
  if (fs.existsSync(alt)) { IMAGES_DIR = alt; ASSETS_PREFIX = 'Assets'; }
}
console.log('[manifest] using folder: ' + IMAGES_DIR);

/* ── Helpers ───────────────────────────────────────────────── */

/**
 * Detect whether a filename contains a 1_1 or 9_16 ratio marker
 * and return the ratio + the "visual name" with the marker stripped.
 *
 * Supported naming styles (ratio can be at start OR end):
 *   Castle 1_1.png  /  Castle_1_1.png  /  Castle-1_1.png
 *   1_1 Castle.png  /  1_1_Castle.png  /  1_1-Castle.png
 *   (same for 9_16)
 *
 * Returns: { ratio: '1_1'|'9_16'|null, key: 'visual name stripped of ratio' }
 */
function detectRatio(basename) {
  // Suffix patterns:  "Name 1_1"  "Name_1_1"  "Name-1_1"
  var sfx11  = basename.match(/^(.+?)[\s_-]+1_1$/i);
  var sfx916 = basename.match(/^(.+?)[\s_-]+9_16$/i);
  // Prefix patterns: "1_1 Name"  "1_1_Name"  "1_1-Name"
  var pfx11  = basename.match(/^1_1[\s_-]+(.+)$/i);
  var pfx916 = basename.match(/^9_16[\s_-]+(.+)$/i);

  if (sfx11)  return { ratio: '1_1',  key: sfx11[1].replace(/\s+/g, ' ').trim() };
  if (sfx916) return { ratio: '9_16', key: sfx916[1].replace(/\s+/g, ' ').trim() };
  if (pfx11)  return { ratio: '1_1',  key: pfx11[1].replace(/\s+/g, ' ').trim() };
  if (pfx916) return { ratio: '9_16', key: pfx916[1].replace(/\s+/g, ' ').trim() };

  // No ratio marker — treat the whole name as the key (used for both sizes)
  return { ratio: null, key: basename.replace(/\s+/g, ' ').trim() };
}

/** Converts a groupKey like "Overwolf-1" into a human label "Overwolf 1". */
function toLabel(groupKey) {
  return groupKey
    .replace(/_/g, ':')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toId(brand, index) {
  return brand.slice(0, 2) + '-' + String(index + 1).padStart(2, '0');
}

/* ── Build manifest ────────────────────────────────────────── */
var manifest = {};

BRANDS.forEach(function (brand) {
  var dir = path.join(IMAGES_DIR, brand);
  manifest[brand] = [];
  if (!fs.existsSync(dir)) return;

  var files = fs.readdirSync(dir)
    .filter(function (f) { return IMAGE_EXTS.includes(path.extname(f).toLowerCase()); })
    .sort();

  // Group files by their visual name (ratio marker stripped)
  var groups = {}; // groupKey → { file11, file916, fileAny }
  files.forEach(function (file) {
    var ext    = path.extname(file);
    var base   = path.basename(file, ext);
    var info   = detectRatio(base);
    var key    = info.key;

    if (!groups[key]) groups[key] = { file11: null, file916: null, fileAny: null };

    if      (info.ratio === '1_1')  groups[key].file11  = file;
    else if (info.ratio === '9_16') groups[key].file916 = file;
    else                            groups[key].fileAny  = file;
  });

  var sortedKeys = Object.keys(groups).sort();
  sortedKeys.forEach(function (key, i) {
    var g    = groups[key];
    var f11  = g.file11  || g.fileAny;
    var f916 = g.file916 || g.fileAny;
    manifest[brand].push({
      id:      toId(brand, i),
      label:   toLabel(key),
      file11:  f11  ? (ASSETS_PREFIX + '/images/' + brand + '/' + f11)  : null,
      file916: f916 ? (ASSETS_PREFIX + '/images/' + brand + '/' + f916) : null,
      layouts: ['left', 'center']
    });
  });

  console.log('[manifest] ' + brand + ': ' + sortedKeys.length + ' visual(s) (' + files.length + ' file(s))');
});

/* ── Inject into index.html ────────────────────────────────── */
var html     = fs.readFileSync(HTML_FILE, 'utf8');
var newBlock =
  '<div id="images-data-block" style="display:none" aria-hidden="true">' +
  JSON.stringify(manifest) +
  '</div>';

var updated = html.replace(
  /<!-- IMAGES_DATA:.*?-->\s*<div[^>]*id="images-data-block"[^>]*>[\s\S]*?<\/div>\s*<!-- END IMAGES_DATA -->/,
  '<!-- IMAGES_DATA: auto-injected by generate-manifest.js - do not edit this block by hand -->\n' +
  newBlock + '\n' +
  '<!-- END IMAGES_DATA -->'
);

if (updated === html) {
  console.error('[manifest] ERROR: Could not find injection markers in index.html');
  process.exit(1);
}

fs.writeFileSync(HTML_FILE, updated, 'utf8');
console.log('[manifest] Injected into index.html');
