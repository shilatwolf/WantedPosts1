/**
 * generate-manifest.js
 *
 * Scans Assets/images/{brand}/ and writes a generated image manifest to images-data.js.
 * Also writes a base64 data URL script per image to Assets/data/{brand}/{id}-{ratio}.js,
 * so the export canvas can load images without tainting on file:// (where fetch() and
 * XMLHttpRequest are both blocked by Chrome for local files).
 *
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

const BRANDS      = ['overwolf', 'tebex', 'outplayed', 'overwolfads', 'curseforge'];
const IMAGE_EXTS  = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const OUTPUT_FILE = path.join(__dirname, 'images-data.js');
const INDEX_HTML  = path.join(__dirname, 'index.html');

// Support both 'assets' (lowercase, git/Netlify standard) and 'Assets' (Windows default)
var entries = fs.readdirSync(__dirname);
var assetFolder = entries.find(function (name) { return name.toLowerCase() === 'assets'; });
var ASSETS_PREFIX = assetFolder || 'assets';
var IMAGES_DIR    = path.join(__dirname, ASSETS_PREFIX, 'images');
var DATA_DIR      = path.join(__dirname, ASSETS_PREFIX, 'data');
console.log('[manifest] using folder: ' + IMAGES_DIR);

var MIME = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif'
};

/* ── Helpers ───────────────────────────────────────────────── */

function detectRatio(basename) {
  var sfx11  = basename.match(/^(.+?)[\s_-]+1_1$/i);
  var sfx916 = basename.match(/^(.+?)[\s_-]+9_16$/i);
  var pfx11  = basename.match(/^1_1[\s_-]+(.+)$/i);
  var pfx916 = basename.match(/^9_16[\s_-]+(.+)$/i);

  if (sfx11)  return { ratio: '1_1',  key: sfx11[1].replace(/\s+/g, ' ').trim() };
  if (sfx916) return { ratio: '9_16', key: sfx916[1].replace(/\s+/g, ' ').trim() };
  if (pfx11)  return { ratio: '1_1',  key: pfx11[1].replace(/\s+/g, ' ').trim() };
  if (pfx916) return { ratio: '9_16', key: pfx916[1].replace(/\s+/g, ' ').trim() };

  return { ratio: null, key: basename.replace(/\s+/g, ' ').trim() };
}

function toLabel(groupKey) {
  return groupKey.replace(/_/g, ':').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function toId(brand, index) {
  return brand.slice(0, 2) + '-' + String(index + 1).padStart(2, '0');
}

/**
 * Writes a tiny JS shim that registers the image's base64 data URL under its
 * file path.  The export pipeline loads this shim on demand and reads
 * window._imgData[path] to get an origin-clean image source that works on
 * file:// (where fetch/XHR are blocked) and on https://.
 */
function writeDataUrlScript(brand, id, ratio, originalPath, absFilePath) {
  var ext  = path.extname(absFilePath).toLowerCase();
  var type = MIME[ext] || 'image/png';
  var b64  = fs.readFileSync(absFilePath).toString('base64');
  var dataUrl = 'data:' + type + ';base64,' + b64;

  var outDir = path.join(DATA_DIR, brand);
  fs.mkdirSync(outDir, { recursive: true });

  var outPath = path.join(outDir, id + '-' + ratio + '.js');
  var body = '(window._imgData = window._imgData || {})['
           + JSON.stringify(originalPath)
           + ']=' + JSON.stringify(dataUrl) + ';\n';
  fs.writeFileSync(outPath, body, 'utf8');

  // Return the path we should load in the browser (relative to index.html)
  return ASSETS_PREFIX + '/data/' + brand + '/' + id + '-' + ratio + '.js';
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

  var groups = {};
  files.forEach(function (file) {
    var ext   = path.extname(file);
    var base  = path.basename(file, ext);
    var info  = detectRatio(base);
    var key   = info.key;

    if (!groups[key]) groups[key] = { file11: null, file916: null, fileAny: null };

    if      (info.ratio === '1_1')  groups[key].file11  = file;
    else if (info.ratio === '9_16') groups[key].file916 = file;
    else                            groups[key].fileAny = file;
  });

  var sortedKeys = Object.keys(groups).sort();
  sortedKeys.forEach(function (key, i) {
    var g     = groups[key];
    var f11   = g.file11  || g.fileAny;
    var f916  = g.file916 || g.fileAny;
    var id    = toId(brand, i);

    var entry = {
      id:      id,
      label:   toLabel(key),
      file11:  f11  ? (ASSETS_PREFIX + '/images/' + brand + '/' + f11)  : null,
      file916: f916 ? (ASSETS_PREFIX + '/images/' + brand + '/' + f916) : null
    };

    // Generate per-image data URL shims (used by export to avoid canvas taint)
    if (f11) {
      entry.dataScript11 = writeDataUrlScript(
        brand, id, '1_1', entry.file11,
        path.join(IMAGES_DIR, brand, f11)
      );
    }
    if (f916) {
      entry.dataScript916 = writeDataUrlScript(
        brand, id, '9_16', entry.file916,
        path.join(IMAGES_DIR, brand, f916)
      );
    }

    manifest[brand].push(entry);
  });

  console.log('[manifest] ' + brand + ': ' + sortedKeys.length + ' visual(s) (' + files.length + ' file(s))');
});

/* ── Write images-data.js ───────────────────────────────────── */
var output = '// Auto-generated by generate-manifest.js — do not edit by hand.\n'
           + 'var IMAGES_DATA = ' + JSON.stringify(manifest, null, 2) + ';\n';

fs.writeFileSync(OUTPUT_FILE, output, 'utf8');
console.log('[manifest] Wrote ' + OUTPUT_FILE);

/* ── Auto-inject manifest into index.html's inline block ───── */
// The inline block is the runtime source of truth for the image picker.
// Keeping file paths only (not data URLs) keeps index.html small.
try {
  var html = fs.readFileSync(INDEX_HTML, 'utf8');
  var marker = '<div id="images-data-block"';
  var startIdx = html.indexOf(marker);
  if (startIdx !== -1) {
    var endTag = '</div>';
    var afterOpen = html.indexOf('>', startIdx) + 1;
    var endIdx = html.indexOf(endTag, afterOpen);
    if (endIdx !== -1) {
      var newBlock = JSON.stringify(manifest);
      var updated = html.slice(0, afterOpen) + newBlock + html.slice(endIdx);
      fs.writeFileSync(INDEX_HTML, updated, 'utf8');
      console.log('[manifest] Updated inline block in index.html');
    }
  }
} catch (e) {
  console.warn('[manifest] could not update index.html inline block:', e.message);
}
