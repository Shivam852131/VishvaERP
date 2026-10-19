/**
 * Inject the per-college portal branding runtime (portal-branding.js) into
 * every college-scoped dashboard page (student, faculty, parent,
 * college-admin). Super Admin pages are intentionally skipped — the platform
 * console is never rebranded by a college. Re-runnable: pages already
 * including the script are skipped.
 *
 * Usage: node scripts/add-portal-branding-runtime.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'frontend', 'pages');
const DIRS = ['college-admin', 'faculty', 'student', 'parent'];
const TAG = '<script src="../../js/portal-branding.js"></script>';

let applied = 0;
let skipped = 0;

for (const dir of DIRS) {
  const full = path.join(PAGES, dir);
  if (!fs.existsSync(full)) continue;

  for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.html'))) {
    const filePath = path.join(full, file);
    const text = fs.readFileSync(filePath, 'utf8');

    if (text.includes('portal-branding.js')) {
      skipped++;
      continue;
    }
    const idx = text.lastIndexOf('</body>');
    if (idx === -1) {
      console.error(`FAIL ${dir}/${file}: no </body>`);
      continue;
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    fs.writeFileSync(
      filePath,
      text.slice(0, idx) + `  ${TAG}${eol}` + text.slice(idx)
    );
    applied++;
    console.log(`APPLIED ${dir}/${file}`);
  }
}

console.log(`\n${applied} applied, ${skipped} already present`);
