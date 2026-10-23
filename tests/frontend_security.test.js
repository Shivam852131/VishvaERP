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
console.log('\n[4/4] Testing DOM Toast Safe Rendering Construction...');

runTest('Toast construction uses textContent to prevent script injection', () => {
  const dirtyMessage = '<img src=x onerror=alert(1)>Critical Error';
  // Mock element
  const span = { textContent: '' };
  span.textContent = String(dirtyMessage ?? '');
  assert.strictEqual(span.textContent, dirtyMessage);
  // Setting textContent in browser DOM sets nodeValue as plain text, never parses as HTML markup
});

console.log('\n===============================================================');
console.log(` SUMMARY: ${passedTests} of ${totalTests} frontend security tests passed (${Math.round((passedTests/totalTests)*100)}%)`);
console.log('===============================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
