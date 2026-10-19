/**
 * Insert a "My Profile" link at the end of the sidebar nav on every role
 * dashboard page (student, faculty, parent, college-admin, super-admin).
 * profile.html files are skipped — the page generator ships the link with
 * the active class. Re-runnable: pages already linked are skipped.
 *
 * Usage: node scripts/add-profile-nav.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'frontend', 'pages');
const DIRS = ['super-admin', 'college-admin', 'faculty', 'student', 'parent'];
const LINK =
  '<a data-cms="nav.profile" href="profile.html" class="nav-link"><i class="nav-link-icon fas fa-user-circle"></i> My Profile</a>';

let applied = 0;
let skipped = 0;
let failed = 0;

for (const dir of DIRS) {
  const full = path.join(PAGES, dir);
  if (!fs.existsSync(full)) continue;

  for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.html'))) {
    if (file === 'profile.html') continue;
    const filePath = path.join(full, file);
    const text = fs.readFileSync(filePath, 'utf8');

    if (text.includes('href="profile.html"')) {
      skipped++;
      continue;
    }

    const navRe = /^([ \t]*)<\/nav>.*$/m;
    const m = text.match(navRe);
    if (!m) {
      console.error(`FAIL ${dir}/${file}: no </nav>`);
      failed++;
      continue;
    }
    const indent = m[1];
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const next = text.replace(navRe, indent + LINK + eol + indent + '</nav>');
    fs.writeFileSync(filePath, next);
    applied++;
  }
}

console.log(`${applied} applied, ${skipped} already present, ${failed} failed`);
process.exit(failed ? 1 : 0);
