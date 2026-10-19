/**
 * Tag dashboard pages with UI text keys (data-cms), inject the ui-text.js
 * runtime, and regenerate frontend/js/ui-text-catalog.js (the Website
 * Builder's "Dashboard Text" catalog).
 *
 * Rules
 *  - Headings h1-h3 (outside <script> blocks) get key "<dir>.<file>.<tag>.<n>"
 *    where n is the 1-based occurrence in document order.
 *  - Sidebar links (class nav-link) get global key "nav.<slug-of-label>" —
 *    one edit renames that menu entry on every page that shows it.
 *  - Keys are positional; re-run this script after markup changes. Already
 *    tagged elements are skipped but still consume their position number,
 *    so re-runs are idempotent for unchanged markup.
 *  - Catalog defaults capture the FIRST text node (that is exactly what the
 *    runtime replaces), so icons and badge spans inside links stay intact.
 *
 * Usage: node scripts/tag-dashboard-text.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'frontend', 'pages');
const DIRS = ['super-admin', 'college-admin', 'faculty', 'student', 'parent']; // legal/ skipped
const RUNTIME_TAG = '<script src="../../js/ui-text.js"></script>';

const H_RE = /<(h[1-3])(\s[^<>]*?)?>([\s\S]*?)<\/\1>/gi;
const A_RE = /<a([^<>]*\bnav-link\b[^<>]*)>([\s\S]*?)<\/a>/gi;

// First text node = text before the first tag, else text after skipping tags.
function firstText(inner) {
  const chunks = inner.split(/<[^>]*>/);
  for (const c of chunks) {
    const t = c.replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return '';
}
function slug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const catalog = new Map(); // key -> entry
let taggedHeadings = 0;
let taggedNav = 0;
let filesTouched = 0;

for (const dir of DIRS) {
  const full = path.join(PAGES, dir);
  if (!fs.existsSync(full)) continue;

  for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.html'))) {
    const filePath = path.join(full, file);
    const original = fs.readFileSync(filePath, 'utf8');
    let text = original;

    // Protect <script> blocks from being tagged (JS template strings).
    const scripts = [];
    text = text.replace(/<script[\s\S]*?<\/script>/gi, (m) => {
      scripts.push(m);
      return `\u0000SCRIPT${scripts.length - 1}\u0000`;
    });

    const counters = {};
    const base = file.replace(/\.html$/, '');
    const pagePath = `${dir}/${file}`;

    // ── Headings ────────────────────────────────────────────────────────
    text = text.replace(H_RE, (m, tag, attrs, inner) => {
      attrs = attrs || '';
      counters[tag] = (counters[tag] || 0) + 1; // consume position even when tagged
      const def = firstText(inner);
      if (!def) return m;
      const existing = (attrs.match(/\bdata-cms="([^"]+)"/) || [])[1];
      // Honor an existing key (stable overrides); otherwise assign positionally.
      const key = existing || `${dir}.${base}.${tag}.${counters[tag]}`;
      if (!catalog.has(key)) {
        catalog.set(key, { key, page: pagePath, default: def });
      }
      if (existing) return m;
      taggedHeadings++;
      return `<${tag} data-cms="${key}"${attrs}>${inner}</${tag}>`;
    });

    // ── Sidebar nav links (global keys) ─────────────────────────────────
    text = text.replace(A_RE, (m, attrs, inner) => {
      const def = firstText(inner);
      if (!def) return m;
      const existing = (attrs.match(/\bdata-cms="([^"]+)"/) || [])[1];
      const key = existing || `nav.${slug(def)}`;
      const entry = catalog.get(key);
      if (entry) {
        entry.pages = (entry.pages || 1) + 1;
      } else {
        catalog.set(key, { key, page: 'menu labels (all pages)', default: def, pages: 1 });
      }
      if (existing) return m;
      taggedNav++;
      return `<a data-cms="${key}"${attrs}>${inner}</a>`;
    });

    // Restore script blocks.
    text = text.replace(/\u0000SCRIPT(\d+)\u0000/g, (m, i) => scripts[Number(i)]);

    // ── Runtime include (before </body>) ────────────────────────────────
    if (!text.includes('ui-text.js')) {
      const idx = text.lastIndexOf('</body>');
      if (idx !== -1) {
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        text = text.slice(0, idx) + `  ${RUNTIME_TAG}${eol}` + text.slice(idx);
      }
    }

    if (text !== original) {
      fs.writeFileSync(filePath, text);
      filesTouched++;
    }
  }
}

// ── Regenerate catalog (nav entries first, then by key) ───────────────────
const entries = Array.from(catalog.values());
const navEntries = entries.filter((e) => e.key.startsWith('nav.')).sort((a, b) => a.key.localeCompare(b.key));
const pageEntries = entries.filter((e) => !e.key.startsWith('nav.')).sort((a, b) => a.key.localeCompare(b.key));
const ordered = navEntries.concat(pageEntries);

const rows = ordered
  .map((e) => {
    const parts = [`"key": ${JSON.stringify(e.key)}`, `"page": ${JSON.stringify(e.page)}`, `"default": ${JSON.stringify(e.default)}`];
    if (e.pages) parts.push(`"pages": ${e.pages}`);
    return '  { ' + parts.join(', ') + ' }';
  })
  .join(',\n');
const catalogFile = `// AUTO-GENERATED by scripts/tag-dashboard-text.js — do not edit by hand.
// Regenerate after changing page markup:  node scripts/tag-dashboard-text.js
window.__UI_TEXT_CATALOG = [
${rows}
];
`;
fs.writeFileSync(path.join(ROOT, 'frontend', 'js', 'ui-text-catalog.js'), catalogFile);

console.log(`files changed: ${filesTouched}`);
console.log(`heading keys:  ${taggedHeadings}`);
console.log(`nav keys:      ${taggedNav}`);
console.log(`catalog total: ${ordered.length}`);
