/**
 * Codemod: opt login-gated app pages out of Google's index.
 *
 * Only the marketing/legal pages should be indexable:
 *   frontend/index.html, pages/login.html, pages/register.html, pages/legal/**
 * Everything else is app UI behind auth - searchers who land on those results
 * would only ever see a login screen.
 *
 * Run: node scripts/add-noindex-codemod.js
 * Idempotent: pages that already carry a robots meta tag are skipped.
 */
const fs = require('fs');
const path = require('path');

const frontendDir = path.join(__dirname, '..', 'frontend');
const pagesDir = path.join(frontendDir, 'pages');

// Public, indexable pages (relative to frontend/). Never touched.
const ALLOWLIST = new Set(['login.html', 'register.html', 'legal/privacy.html']);

const NOINDEX_TAG = '<meta name="robots" content="noindex, nofollow">';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function applyNoindex(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  if (/name=["']robots["']/i.test(html)) return 'already-has-robots';

  const titleMatch = html.match(/^[ \t]*<title[^>]*>[\s\S]*?<\/title>[ \t]*\r?\n?/im);
  if (!titleMatch) return 'no-title-tag';

  const index = titleMatch.index + titleMatch[0].length;
  const indent = (titleMatch[0].match(/^[ \t]*/) || [''])[0];
  const updated = html.slice(0, index) + indent + NOINDEX_TAG + '\n' + html.slice(index);
  fs.writeFileSync(filePath, updated, 'utf8');
  return 'added';
}

const results = { added: 0, 'already-has-robots': 0, skipped: 0, 'no-title-tag': 0 };
const details = { added: [], skipped: [], 'no-title-tag': [] };

for (const file of walk(pagesDir)) {
  const rel = path.relative(pagesDir, file).replace(/\\/g, '/');
  if (ALLOWLIST.has(rel)) {
    results.skipped += 1;
    details.skipped.push(rel);
    continue;
  }
  const outcome = applyNoindex(file);
  results[outcome] += 1;
  if (details[outcome]) details[outcome].push(rel);
}

console.log('noindex results:', JSON.stringify(results));
if (details.skipped.length) console.log('allowlisted (indexable):', details.skipped.join(', '));
if (details.added.length) console.log('noindex added to:\n  ' + details.added.join('\n  '));
if (details['no-title-tag'].length) console.log('WARNING - no <title> to anchor on:', details['no-title-tag'].join(', '));
