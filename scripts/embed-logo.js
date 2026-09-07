const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '..', 'frontend', 'icons', 'logo.png');
const b64 = fs.readFileSync(logoPath).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="VishvaERP Icon">
  <image width="512" height="512" href="data:image/png;base64,${b64}"/>
</svg>
`;

fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'icons', 'icon.svg'), svg);
fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'icons', 'icon-maskable.svg'), svg);

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 48" width="240" height="48" role="img" aria-label="VishvaERP Logo">
  <image x="4" y="4" width="40" height="40" href="data:image/png;base64,${b64}"/>
  <text x="52" y="32" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="700" fill="#FFFFFF" letter-spacing="-0.01em">Vishva<tspan font-weight="900" fill="#FFFFFF" letter-spacing="-0.02em">ERP</tspan></text>
</svg>
`;
fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'icons', 'logo.svg'), logoSvg);

const logoDarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 48" width="240" height="48" role="img" aria-label="VishvaERP Logo Dark">
  <image x="4" y="4" width="40" height="40" href="data:image/png;base64,${b64}"/>
  <text x="52" y="32" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="700" fill="#0F172A" letter-spacing="-0.01em">Vishva<tspan font-weight="900" fill="#4F46E5" letter-spacing="-0.02em">ERP</tspan></text>
</svg>
`;
fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'icons', 'logo-dark.svg'), logoDarkSvg);

console.log('Successfully generated icon.svg, icon-maskable.svg, logo.svg, and logo-dark.svg with the new logo!');
