/**
 * Generates PWA / store PNG icons from the SVG source.
 * Run: node scripts/generate-icons.js
 */
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'frontend', 'icons');
const svgPath = path.join(iconsDir, 'icon.svg');

async function generate() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (_) {
    console.warn('sharp is not installed. Skipping PNG generation.');
    process.exit(0);
  }

  const svg = fs.readFileSync(svgPath);
  const outputs = [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
    ['screenshot-wide.png', 1280, 720],
    ['screenshot-mobile.png', 720, 1280],
  ];

  for (const entry of outputs) {
    const [name, width, height = width] = entry;
    const outPath = path.join(iconsDir, name);
    const pipeline = sharp(svg).resize(width, height, { fit: 'contain', background: '#0F172A' });
    await pipeline.png().toFile(outPath);
    console.log(`Created ${name}`);
  }
}

generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
