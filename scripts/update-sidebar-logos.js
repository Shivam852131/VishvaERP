const fs = require('fs');
const path = require('path');

// Replaces leftover letter-tile logos ("V") with the original logo image.
// Handles both plain tiles and tiles carrying inline style attributes.
function updateHtml(fp, prefix) {
  if (!fs.existsSync(fp)) return;
  let content = fs.readFileSync(fp, 'utf8');
  const before = content;

  // <div class="sidebar-logo-icon">V</div>
  // <div class="sidebar-logo-icon" style="background:linear-gradient(...)">V</div>
  content = content.replace(
    /<div class="sidebar-logo-icon"[^>]*>V<\/div>/g,
    `<div class="sidebar-logo-icon"><img src="${prefix}icons/logo.png" alt="Vi"></div>`
  );

  // Landing-page nav brand: <span class="lp-brand-icon">V</span>
  content = content.replace(
    /<span class="lp-brand-icon"[^>]*>V<\/span>/g,
    `<span class="lp-brand-icon"><img src="${prefix}icons/logo.png" alt="VishvaERP"></span>`
  );

  // Text gap normalization (VishvaERP -> Vishva ERP spacing)
  content = content.replace(/Vishva<span>ERP<\/span>/g, 'Vishva <span>ERP</span>');
  content = content.replace(/Vishva<strong>ERP<\/strong>/g, 'Vishva <strong>ERP</strong>');

  if (content !== before) {
    fs.writeFileSync(fp, content, 'utf8');
    console.log(`Updated ${path.relative(path.join(__dirname, '..'), fp)}`);
  }
}

function updateDir(dir, prefix) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .forEach((file) => updateHtml(path.join(dir, file), prefix));
}

const root = path.join(__dirname, '..');

// Top-level pages live one level below frontend/ -> '../icons/...'
updateDir(path.join(root, 'frontend', 'pages'), '../');
// Section pages live two levels below frontend/ -> '../../icons/...'
['super-admin', 'college-admin', 'faculty', 'student', 'parent'].forEach((section) => {
  updateDir(path.join(root, 'frontend', 'pages', section), '../../');
});
// Landing page sits at frontend/ -> 'icons/...'
updateHtml(path.join(root, 'frontend', 'index.html'), '');

console.log('Done.');
