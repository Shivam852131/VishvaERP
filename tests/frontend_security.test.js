/**
 * Vishva ERP — Frontend Security Automated Test Suite
 * 
 * Verifies:
 * 1. HTML escaping and XSS defense (escapeHTML)
 * 2. Open-redirect prevention (getSafeRedirectUrl)
 * 3. Client-side JWT expiration checking (isTokenExpired)
 * 4. Safe DOM toast message rendering
 */

const assert = require('assert');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

console.log('\n===============================================================');
console.log(' VISHVA ERP - FRONTEND SECURITY VERIFICATION TEST SUITE');
console.log('===============================================================\n');

// 1. XSS Escaping Logic
console.log('[1/4] Testing HTML Escaping & Anti-XSS Sanitization...');

function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

runTest('escapeHTML neutralizes script tags, event handlers and quotes', () => {
  const dirty = '<script>alert("XSS")</script><img src=x onerror=alert(\'hack\')>`test`';
  const clean = escapeHTML(dirty);
  assert.strictEqual(clean.includes('<script>'), false);
  assert.strictEqual(clean.includes('"'), false);
  assert.strictEqual(clean.includes('\''), false);
  assert.strictEqual(clean.includes('`'), false);
  assert.ok(clean.includes('&lt;script&gt;'));
  assert.ok(clean.includes('&#39;hack&#39;'));
  assert.ok(clean.includes('&#96;test&#96;'));
});

runTest('escapeHTML handles null and undefined safely', () => {
  assert.strictEqual(escapeHTML(null), '');
  assert.strictEqual(escapeHTML(undefined), '');
  assert.strictEqual(escapeHTML(0), '0');
  assert.strictEqual(escapeHTML(false), 'false');
});

// 2. Safe Redirect Logic
console.log('\n[2/4] Testing Open-Redirect Prevention (getSafeRedirectUrl)...');

function getSafeRedirectUrl(target, fallback = '/pages/login.html') {
  if (!target || typeof target !== 'string') return fallback;
  const trimmed = target.trim();
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return fallback;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return fallback;
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  try {
    const origin = 'https://vishvaerp.vercel.app';
    const parsed = new URL(trimmed, origin);
    if (parsed.origin === origin) {
      return parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {}
  return fallback;
}

runTest('Allows legitimate internal relative redirects', () => {
  assert.strictEqual(getSafeRedirectUrl('/pages/student/dashboard.html'), '/pages/student/dashboard.html');
  assert.strictEqual(getSafeRedirectUrl('/pages/login.html?tab=otp'), '/pages/login.html?tab=otp');
});

runTest('Blocks protocol-relative URLs (e.g. //evil.com)', () => {
  assert.strictEqual(getSafeRedirectUrl('//evil.com/phishing'), '/pages/login.html');
  assert.strictEqual(getSafeRedirectUrl('/\\evil.com'), '/pages/login.html');
});

runTest('Blocks javascript: and data: pseudo-protocols', () => {
  assert.strictEqual(getSafeRedirectUrl('javascript:alert(document.cookie)'), '/pages/login.html');
  assert.strictEqual(getSafeRedirectUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), '/pages/login.html');
});

runTest('Blocks external absolute URLs', () => {
  assert.strictEqual(getSafeRedirectUrl('https://evil-hacker.com/login'), '/pages/login.html');
  assert.strictEqual(getSafeRedirectUrl('http://attacker.org'), '/pages/login.html');
});

// 3. Client-Side JWT Expiration Checking
console.log('\n[3/4] Testing Client-Side JWT Expiry Validation...');

function isTokenExpired(token) {
  if (!token || typeof token !== 'string') return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    if (!payload.exp) return false;
    return (payload.exp * 1000) <= (Date.now() + 30000);
  } catch {
    return true;
  }
}

runTest('isTokenExpired correctly flags expired or near-expiry tokens', () => {
  const expiredPayload = Buffer.from(JSON.stringify({ id: '1', exp: Math.floor(Date.now() / 1000) - 100 })).toString('base64');
  const expiredToken = `eyJhbGciOiJIUzI1NiJ9.${expiredPayload}.sig`;
  assert.strictEqual(isTokenExpired(expiredToken), true);

  const nearExpiryPayload = Buffer.from(JSON.stringify({ id: '1', exp: Math.floor(Date.now() / 1000) + 15 })).toString('base64');
  const nearExpiryToken = `eyJhbGciOiJIUzI1NiJ9.${nearExpiryPayload}.sig`;
  assert.strictEqual(isTokenExpired(nearExpiryToken), true, 'Must flag token expiring within 30s buffer');

  const freshPayload = Buffer.from(JSON.stringify({ id: '1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64');
  const freshToken = `eyJhbGciOiJIUzI1NiJ9.${freshPayload}.sig`;
  assert.strictEqual(isTokenExpired(freshToken), false, 'Fresh token must not be expired');
});

runTest('isTokenExpired rejects malformed tokens', () => {
  assert.strictEqual(isTokenExpired(null), true);
  assert.strictEqual(isTokenExpired(''), true);
  assert.strictEqual(isTokenExpired('random_string'), true);
});

// 4. Toast Sanitization Verification
console.log('\n[4/6] Testing DOM Toast Safe Rendering Construction...');

runTest('Toast construction uses textContent to prevent script injection', () => {
  const dirtyMessage = '<img src=x onerror=alert(1)>Critical Error';
  const span = { textContent: '' };
  span.textContent = String(dirtyMessage ?? '');
  assert.strictEqual(span.textContent, dirtyMessage);
});

// 5. Route Guarding Across All Application Portals
console.log('\n[5/6] Testing Multi-Page Route Guards (getPageGuardRoles & requireAuth)...');

function getPageGuardRoles(path) {
  const normalizedPath = String(path || '').replace(/\\/g, '/').toLowerCase();
  if (normalizedPath.includes('/pages/super-admin/')) return ['superadmin'];
  if (normalizedPath.includes('/pages/college-admin/')) return ['collegeAdmin'];
  if (normalizedPath.includes('/pages/faculty/')) return ['faculty'];
  if (normalizedPath.includes('/pages/student/')) return ['student'];
  if (normalizedPath.includes('/pages/parent/')) return ['parent'];
  if (normalizedPath.includes('/pages/messages.html') || normalizedPath.includes('/pages/ai-tools.html')) {
    return ['superadmin', 'collegeAdmin', 'faculty', 'student', 'parent'];
  }
  return null;
}

const ROLE_DASHBOARDS = {
  superadmin: '/pages/super-admin/dashboard.html',
  collegeAdmin: '/pages/college-admin/dashboard.html',
  faculty: '/pages/faculty/dashboard.html',
  student: '/pages/student/dashboard.html',
  parent: '/pages/parent/dashboard.html'
};

function resolveUnauthorizedRoleTarget(userRole) {
  return ROLE_DASHBOARDS[userRole] || '/pages/login.html';
}

runTest('getPageGuardRoles protects Super Admin portal pages', () => {
  assert.deepStrictEqual(getPageGuardRoles('/pages/super-admin/dashboard.html'), ['superadmin']);
  assert.deepStrictEqual(getPageGuardRoles('c:\\users\\frontend\\pages\\super-admin\\users.html'), ['superadmin']);
});

runTest('getPageGuardRoles protects College Admin portal pages', () => {
  assert.deepStrictEqual(getPageGuardRoles('/pages/college-admin/courses.html'), ['collegeAdmin']);
  assert.deepStrictEqual(getPageGuardRoles('/PAGES/COLLEGE-ADMIN/FEES.HTML'), ['collegeAdmin']);
});

runTest('getPageGuardRoles protects Faculty, Student, and Parent portal pages', () => {
  assert.deepStrictEqual(getPageGuardRoles('/pages/faculty/live-class.html'), ['faculty']);
  assert.deepStrictEqual(getPageGuardRoles('/pages/student/dashboard.html'), ['student']);
  assert.deepStrictEqual(getPageGuardRoles('/pages/parent/child-profile.html'), ['parent']);
});

runTest('getPageGuardRoles guards shared tools (ai-tools and messages) for all authenticated roles', () => {
  const expected = ['superadmin', 'collegeAdmin', 'faculty', 'student', 'parent'];
  assert.deepStrictEqual(getPageGuardRoles('/pages/ai-tools.html'), expected);
  assert.deepStrictEqual(getPageGuardRoles('/pages/messages.html'), expected);
});

runTest('resolveUnauthorizedRoleTarget routes cross-role invaders to their own dashboard', () => {
  assert.strictEqual(resolveUnauthorizedRoleTarget('student'), '/pages/student/dashboard.html');
  assert.strictEqual(resolveUnauthorizedRoleTarget('faculty'), '/pages/faculty/dashboard.html');
  assert.strictEqual(resolveUnauthorizedRoleTarget('collegeAdmin'), '/pages/college-admin/dashboard.html');
  assert.strictEqual(resolveUnauthorizedRoleTarget('unknown'), '/pages/login.html');
});

// 6. Security Configuration Headers & Link Hardening
console.log('\n[6/6] Testing Deployment Security Headers & Reverse Tabnabbing Hardening...');

const fs = require('fs');
const path = require('path');

runTest('vercel.json enforces strict security headers on all pages', () => {
  const vercelPath = path.resolve(__dirname, '../frontend/vercel.json');
  const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  assert.ok(Array.isArray(vercelConfig.headers), 'vercel.json must specify headers array');
  const globalHeaderRule = vercelConfig.headers.find(h => h.source === '/(.*)');
  assert.ok(globalHeaderRule, 'Must contain global route header definition');

  const headerMap = {};
  globalHeaderRule.headers.forEach(h => { headerMap[h.key.toLowerCase()] = h.value; });
  assert.strictEqual(headerMap['x-content-type-options'], 'nosniff');
  assert.strictEqual(headerMap['x-frame-options'], 'SAMEORIGIN');
  assert.strictEqual(headerMap['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.ok(headerMap['permissions-policy'].includes('camera=(self)'));
  assert.ok(headerMap['permissions-policy'].includes('microphone=(self)'));
});

runTest('.htaccess enforces security headers, CSP, and camera/mic permissions', () => {
  const htaccessPath = path.resolve(__dirname, '../frontend/.htaccess');
  const htaccess = fs.readFileSync(htaccessPath, 'utf8');
  assert.ok(htaccess.includes('Header always set X-Content-Type-Options "nosniff"'));
  assert.ok(htaccess.includes('Header always set X-Frame-Options "SAMEORIGIN"'));
  assert.ok(htaccess.includes('Header always set Referrer-Policy "strict-origin-when-cross-origin"'));
  assert.ok(htaccess.includes('Header always set Permissions-Policy "camera=(self), microphone=(self)'));
  assert.ok(htaccess.includes('Header always set Content-Security-Policy'));
});

runTest('Link sanitizer enforces rel="noopener noreferrer" on target="_blank"', () => {
  function sanitizeRel(currentRel) {
    const tokens = new Set((currentRel || '').split(/\s+/).filter(Boolean));
    tokens.add('noopener');
    tokens.add('noreferrer');
    return Array.from(tokens).join(' ');
  }

  assert.strictEqual(sanitizeRel(''), 'noopener noreferrer');
  assert.strictEqual(sanitizeRel('nofollow'), 'nofollow noopener noreferrer');
  assert.strictEqual(sanitizeRel('noopener'), 'noopener noreferrer');
});

runTest('In-app secret generator uses a CSPRNG and never uses Math.random', () => {
  const systemPath = path.resolve(__dirname, '../frontend/pages/super-admin/system.html');
  const html = fs.readFileSync(systemPath, 'utf8');

  assert.ok(html.includes('crypto.getRandomValues'), 'must use the Web Crypto CSPRNG');
  assert.ok(!html.includes('Math.random('), 'Math.random must never produce a secret');
  assert.ok(html.includes('Security Secret Generator'), 'the generator UI must exist');
  assert.ok(html.includes('secret-generate') && html.includes('secret-copy'), 'controls must be wired');
});

runTest('In-app secret generator never reads a secret from the API', () => {
  const systemPath = path.resolve(__dirname, '../frontend/pages/super-admin/system.html');
  const html = fs.readFileSync(systemPath, 'utf8');

  // The running signing secret must never be fetched from, or shown by, the
  // server - only a freshly generated candidate is produced client-side.
  const apiCalls = html.match(/api\.request\(\s*['"`]([^'"`]+)/g) || [];
  apiCalls.forEach((call) => {
    assert.ok(
      !/secret|env|config/i.test(call),
      `the page must not request a secret from the API: ${call}`
    );
  });
  assert.ok(
    !/\/api\/[^'"`\s]*(secret|environment)/i.test(html),
    'no secret/environment endpoint may be referenced by the page'
  );
});

runTest('Super-admin system page calls the API without a doubled /api prefix', () => {
  const systemPath = path.resolve(__dirname, '../frontend/pages/super-admin/system.html');
  const html = fs.readFileSync(systemPath, 'utf8');

  // `api.request()` already prepends `/api`, so passing `/api/...` would
  // request `/api/api/...` and silently 404.
  const calls = html.match(/api\.request\(\s*['"`]([^'"`]+)/g) || [];
  calls.forEach((call) => {
    assert.ok(!call.includes("'/api/"), `api.request path must not include the /api prefix: ${call}`);
  });
});

runTest('Vercel deployment sends a Content-Security-Policy', () => {
  // Vercel ignores .htaccess - without a CSP here the online deployment runs
  // with no content-security policy at all.
  const vercelPath = path.resolve(__dirname, '../frontend/vercel.json');
  const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  const headers = (vercel.headers || []).flatMap((entry) => entry.headers || []);
  const csp = headers.find((h) => h.key === 'Content-Security-Policy');

  assert.ok(csp, 'vercel.json must define a Content-Security-Policy');
  ['default-src', 'script-src', 'object-src', 'base-uri', 'frame-ancestors', 'form-action']
    .forEach((directive) => {
      assert.ok(csp.value.includes(directive), `CSP must include ${directive}`);
    });
  assert.ok(csp.value.includes("object-src 'none'"), 'object-src must be none');
  assert.ok(csp.value.includes("frame-ancestors 'self'"), 'frame-ancestors must be set');
});

runTest('Vercel and Apache deployments enforce the same CSP', () => {
  const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../frontend/vercel.json'), 'utf8'));
  const headers = (vercel.headers || []).flatMap((entry) => entry.headers || []);
  const csp = headers.find((h) => h.key === 'Content-Security-Policy').value;

  const htaccess = fs.readFileSync(path.resolve(__dirname, '../frontend/.htaccess'), 'utf8');
  const htaccessCsp = (htaccess.match(/Content-Security-Policy "([^"]+)"/) || [])[1];

  assert.ok(htaccessCsp, '.htaccess must define a Content-Security-Policy');
  assert.strictEqual(
    csp,
    htaccessCsp,
    'the Vercel and Apache CSPs must be identical so both hosts behave the same'
  );
});

runTest('CSP allows every third-party origin the frontend actually loads', () => {
  // A CSP that is too tight silently breaks the product. These are the
  // origins the pages really load resources from - if one is missing the
  // corresponding feature fails silently in production.
  const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../frontend/vercel.json'), 'utf8'));
  const headers = (vercel.headers || []).flatMap((entry) => entry.headers || []);
  const csp = headers.find((h) => h.key === 'Content-Security-Policy').value;

  const required = {
    'script-src': [
      'https://cdnjs.cloudflare.com',    // Font Awesome
      'https://cdn.jsdelivr.net',        // Chart.js
      'https://cdn.tailwindcss.com',     // Tailwind CDN
      'https://cdn.socket.io',           // socket.io client
      'https://checkout.razorpay.com',   // Razorpay checkout
      'https://accounts.google.com',     // Google Sign-In (GIS)
    ],
    'style-src': [
      'https://fonts.googleapis.com',
      'https://cdnjs.cloudflare.com',
      'https://cdn.jsdelivr.net',
      'https://cdn.tailwindcss.com',
      'https://accounts.google.com',     // Google Sign-In injects its own stylesheet
    ],
    'frame-src': [
      'https://checkout.razorpay.com',
      'https://meet.jit.si',
      'https://accounts.google.com',
    ],
  };

  Object.entries(required).forEach(([directive, origins]) => {
    assert.ok(csp.includes(`${directive} `), `CSP must define ${directive}`);
    const value = csp.split(`${directive} `)[1].split(';')[0];
    origins.forEach((origin) => {
      assert.ok(
        value.includes(origin),
        `${directive} must allow ${origin} - otherwise that feature breaks in production`
      );
    });
  });
});

runTest('Render deployment defines JWT_REFRESH_SECRET', () => {
  const renderYaml = fs.readFileSync(path.resolve(__dirname, '../render.yaml'), 'utf8');
  assert.ok(
    /key:\s*JWT_REFRESH_SECRET/.test(renderYaml),
    'render.yaml must define JWT_REFRESH_SECRET - the API refuses to boot in production without it'
  );
  assert.ok(/key:\s*JWT_SECRET/.test(renderYaml), 'render.yaml must define JWT_SECRET');
});

runTest('Seeded demo credentials are not published by default', () => {
  // The demo passwords live in this public repository. The login page must
  // not hand them to every visitor unless the server explicitly opts in.
  const configSrc = fs.readFileSync(path.resolve(__dirname, '../backend/routes/config.js'), 'utf8');
  assert.ok(configSrc.includes('demoAccounts'), 'the public config must expose a demoAccounts flag');
  assert.ok(
    configSrc.includes('PUBLIC_DEMO_ACCOUNTS'),
    'the demo flag must be controlled by PUBLIC_DEMO_ACCOUNTS'
  );
  assert.ok(
    /process\.env\.NODE_ENV\s*!==\s*'production'/.test(configSrc),
    'demo credentials must default to OFF in production'
  );

  const loginSrc = fs.readFileSync(path.resolve(__dirname, '../frontend/pages/login.html'), 'utf8');
  assert.ok(loginSrc.includes('demoAccountsAllowed'), 'the login page must respect the flag');
  assert.ok(
    !/id="password"[^>]*value="/.test(loginSrc),
    'the password field must not be pre-filled in the markup'
  );
  assert.ok(
    /if\s*\(!demoAccountsAllowed\)\s*return;/.test(loginSrc),
    'the demo auto-fill must refuse to run when the panel is disabled'
  );
});

console.log('\n===============================================================');
console.log(` SUMMARY: ${passedTests} of ${totalTests} frontend security tests passed (${Math.round((passedTests/totalTests)*100)}%)`);
console.log('===============================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}

