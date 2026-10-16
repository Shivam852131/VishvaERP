const fs = require('fs');
const path = require('path');

function updateDir(dir, prefix) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
  files.forEach(file => {
    const fp = path.join(dir, file);
    let content = fs.readFileSync(fp, 'utf8');
    let changed = false;

    if (content.includes('<div class="sidebar-logo-icon">V</div>')) {
      content = content.replace(
        /<div class="sidebar-logo-icon">V<\/div>/g,
        `<div class="sidebar-logo-icon"><img src="${prefix}icons/logo.png" alt="Vi"></div>`
      );
      changed = true;
    }

    if (content.includes('Vishva<span>ERP</span>')) {
      content = content.replace(/Vishva<span>ERP<\/span>/g, 'Vishva <span>ERP</span>');
      changed = true;
    }

    if (content.includes('Vishva<strong>ERP</strong>')) {
      content = content.replace(/Vishva<strong>ERP<\/strong>/g, 'Vishva <strong>ERP</strong>');
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(fp, content, 'utf8');
      console.log(`Updated logo & text gap in ${file}`);
    }
  });
}

updateDir(path.join(__dirname, '..', 'frontend', 'pages', 'super-admin'), '../../');
updateDir(path.join(__dirname, '..', 'frontend', 'pages', 'college-admin'), '../../');
updateDir(path.join(__dirname, '..', 'frontend', 'pages', 'faculty'), '../../');
updateDir(path.join(__dirname, '..', 'frontend', 'pages', 'student'), '../../');
updateDir(path.join(__dirname, '..', 'frontend', 'pages', 'parent'), '../../');
