/**
 * generate-manifest.js
 *
 * Scans assets/images/{brand}/ and injects IMAGES_DATA directly into index.html.
 * Run manually:  node generate-manifest.js
 * On Netlify:    runs automatically before every deploy (see netlify.toml)
 *
 * To add images: drop files into assets/images/{brand}/ and run this script.
 */

const fs   = require('fs');
const path = require('path');

const BRANDS      = ['overwolf', 'tebex', 'outplayed'];
const IMAGE_EXTS  = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const HTML_FILE   = path.join(__dirname, 'index.html');

// Support both 'assets' (lowercase, git/Netlify standard) and 'Assets' (Windows default)
var IMAGES_DIR  = path.join(__dirname, 'assets', 'images');
var ASSETS_PREFIX = 'assets';
if (!fs.existsSync(IMAGES_DIR)) {
  var alt = path.join(__dirname, 'Assets', 'images');
  if (fs.existsSync(alt)) { IMAGES_DIR = alt; ASSETS_PREFIX = 'Assets'; }
}
console.log('[manifest] using folder: ' + IMAGES_DIR);

function toLabel(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/_/g, ':')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toId(brand, index) {
  return brand.slice(0, 2) + '-' + String(index + 1).padStart(2, '0');
}

// Build manifest
var manifest = {};
BRANDS.forEach(function (brand) {
  var dir = path.join(IMAGES_DIR, brand);
  manifest[brand] = [];
  if (!fs.existsSync(dir)) return;

  var files = fs.readdirSync(dir)
    .filter(function (f) { return IMAGE_EXTS.includes(path.extname(f).toLowerCase()); })
    .sort();

  files.forEach(function (file, i) {
    manifest[brand].push({
      id:      toId(brand, i),
      file:    ASSETS_PREFIX + '/images/' + brand + '/' + file,
      label:   toLabel(file),
      layouts: ['left', 'right', 'center']
    });
  });

  console.log('[manifest] ' + brand + ': ' + files.length + ' image(s)');
});

// Inject into index.html between the marker comments
var html    = fs.readFileSync(HTML_FILE, 'utf8');
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
