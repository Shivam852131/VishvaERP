/**
 * Insert a "Website Builder" link into every super-admin sidebar, directly
 * above the Settings link. Re-runnable: pages already linked are skipped.
 *
 * Usage: node scripts/add-website-builder-nav.js
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'frontend', 'pages', 'super-admin');
const SKIP = new Set(['website-editor.html']); // ships with the link (active)
const LINK =
  '<a href="website-editor.html" class="nav-link"><i class="nav-link-icon fas fa-pen-ruler"></i> Website Builder</a>';

let applied = 0;
let skipped = 0;
let failed = 0;

for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith('.html'))) {
  if (SKIP.has(name)) continue;
  const file = path.join(DIR, name);
  let text = fs.readFileSync(file, 'utf8');

  if (text.includes('href="website-editor.html"')) {
    skipped++;
    continue;
  }

  // Anchor: the settings.html nav link (with or without the active class).
  const re = /^([ \t]*)<a href="settings\.html" class="nav-link(?: active)?">.*$/m;
  const m = text.match(re);
  if (!m) {
    console.error(`FAIL ${name}: settings.html nav link not found`);
    failed++;
    continue;
  }
  const indent = m[1];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const insert = indent + LINK + eol;
  text = text.replace(re, (match) => insert + match);
  fs.writeFileSync(file, text);
  applied++;
  console.log(`APPLIED ${name}`);
}

console.log(`\n${applied} applied, ${skipped} already present, ${failed} failed`);
process.exit(failed ? 1 : 0);
