/**
 * generate-manifest.js
 *
 * Scans assets/images/{brand}/ and writes images.json automatically.
 * Run manually:  node generate-manifest.js
 * On Netlify:    runs automatically before every deploy (see netlify.toml)
 *
 * To add images: drop files into assets/images/{brand}/ and push.
 * No manual editing of images.json ever needed.
 */

const fs   = require('fs');
const path = require('path');

const BRANDS      = ['overwolf', 'tebex', 'outplayed'];
const IMAGE_EXTS  = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const IMAGES_DIR  = path.join(__dirname, 'assets', 'images');
const OUTPUT_FILE = path.join(__dirname, 'images.json');

function toLabel(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/_/g, ':')     // 1_1 → 1:1,  9_16 → 9:16
    .replace(/-/g, ' ')     // hyphens → spaces
    .replace(/\s+/g, ' ')
    .trim();
}

function toId(brand, filename, index) {
  var short = brand.slice(0, 2);
  return short + '-' + String(index + 1).padStart(2, '0');
}

var manifest = {};

BRANDS.forEach(function (brand) {
  var dir = path.join(IMAGES_DIR, brand);
  manifest[brand] = [];

  if (!fs.existsSync(dir)) return;

  var files = fs.readdirSync(dir)
    .filter(function (f) {
      return IMAGE_EXTS.includes(path.extname(f).toLowerCase());
    })
    .sort();

  files.forEach(function (file, i) {
    manifest[brand].push({
      id:      toId(brand, file, i),
      file:    'assets/images/' + brand + '/' + file,
      label:   toLabel(file),
      layouts: ['left', 'right', 'center']
    });
  });

  console.log('[manifest] ' + brand + ': ' + files.length + ' image(s)');
});

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2) + '\n');
console.log('[manifest] Written to images.json');
