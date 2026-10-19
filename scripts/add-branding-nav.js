/**
 * Insert a "Portal Branding" link into every college-admin sidebar, directly
 * below the Subscription link (its sibling under Finance & HR). Re-runnable:
 * pages already linked are skipped.
 *
 * Usage: node scripts/add-branding-nav.js
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'frontend', 'pages', 'college-admin');
const SKIP = new Set(['branding.html']); // ships with the link (active)
const LINK =
  '<a data-cms="nav.branding" href="branding.html" class="nav-link"><i class="nav-link-icon fas fa-palette"></i> Portal Branding</a>';

let applied = 0;
let skipped = 0;
let failed = 0;

for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith('.html'))) {
  if (SKIP.has(name)) continue;
  const file = path.join(DIR, name);
  let text = fs.readFileSync(file, 'utf8');

  if (text.includes('href="branding.html"')) {
    skipped++;
    continue;
  }

  // Anchor 1: the subscription.html nav link (with or without active class).
  const re = /^([ \t]*)<a data-cms="[^"]*" href="subscription\.html" class="nav-link(?: active)?">.*$/m;
  const m = text.match(re);
  let insert;
  if (m) {
    const indent = m[1];
    const eol0 = text.includes('\r\n') ? '\r\n' : '\n';
    insert = m[0] + eol0 + indent + LINK;
    text = text.replace(re, insert);
  } else {
    // Anchor 2 (short sidebars without a Subscription link): before </nav>.
    const navRe = /^([ \t]*)<\/nav>.*$/m;
    const nm = text.match(navRe);
    if (!nm) {
      console.error(`FAIL ${name}: no subscription link and no </nav>`);
      failed++;
      continue;
    }
    const indent = nm[1];
    const eol0 = text.includes('\r\n') ? '\r\n' : '\n';
    insert = indent + LINK + eol0 + nm[0];
    text = text.replace(navRe, insert);
  }
  fs.writeFileSync(file, text);
  applied++;
  console.log(`APPLIED ${name}`);
}

console.log(`\n${applied} applied, ${skipped} already present, ${failed} failed`);
process.exit(failed ? 1 : 0);
