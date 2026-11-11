#!/usr/bin/env node
/**
 * Vishva ERP — Deployment Verification
 *
 * Checks a running deployment (local or online) and reports whether the
 * security-hardened build is live and whether the expected controls are
 * active. Safe to run against your own deployment - it only performs
 * unauthenticated reads.
 *
 * Usage:
 *   node scripts/check-deploy.js                          # https://vishvaerp.vercel.app
 *   node scripts/check-deploy.js http://localhost:5000     # local
 *   node scripts/check-deploy.js https://your-host.com
 */

const TARGET = (process.argv[2] || 'https://vishvaerp.vercel.app').replace(/\/+$/, '');

let pass = 0;
let fail = 0;
const warn = [];

function ok(label, detail = '') {
  pass += 1;
  console.log(`  \x1b[32m[PASS]\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
}
function bad(label, detail = '') {
  fail += 1;
  console.log(`  \x1b[31m[FAIL]\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
}
function note(label, detail = '') {
  warn.push(label);
  console.log(`  \x1b[33m[WARN]\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
}

const get = async (path, options = {}) => {
  const res = await fetch(`${TARGET}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    redirect: 'manual',
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
};

async function main() {
  console.log('\n===============================================================');
  console.log(' Vishva ERP - Deployment Verification');
  console.log(` Target: ${TARGET}`);
  console.log('===============================================================\n');

  // ── 1. Reachability ─────────────────────────────────────────────────────
  console.log('[1/4] Reachability');
  let home;
  try {
    home = await get('/');
    if (home.status === 200) ok('site is reachable', 'HTTP 200');
    else bad('site did not return 200', `HTTP ${home.status}`);
  } catch (err) {
    bad('site is unreachable', err.message);
    console.log('\nAborting - cannot reach the deployment.\n');
    process.exit(1);
  }

  // ── 2. Security headers on the HTML page ────────────────────────────────
  console.log('\n[2/4] Security headers (HTML page)');
  const csp = home.headers.get('content-security-policy');
  if (csp) ok('Content-Security-Policy is present');
  else bad('Content-Security-Policy is MISSING', 'the deployment is running the pre-hardening frontend');

  if (home.headers.get('x-content-type-options') === 'nosniff') ok('X-Content-Type-Options: nosniff');
  else bad('X-Content-Type-Options is missing or wrong');

  if (home.headers.get('x-frame-options')) ok(`X-Frame-Options: ${home.headers.get('x-frame-options')}`);
  else note('X-Frame-Options missing', 'the CSP frame-ancestors still applies');

  if (home.headers.get('strict-transport-security')) ok(`Strict-Transport-Security: ${home.headers.get('strict-transport-security')}`);
  else note('Strict-Transport-Security missing');

  if (!home.headers.get('x-powered-by')) ok('X-Powered-By is hidden');
  else note('X-Powered-By is exposed', home.headers.get('x-powered-by'));

  // ── 3. API hardening ────────────────────────────────────────────────────
  console.log('\n[3/4] API hardening');
  const health = await get('/api/health');
  if (health.status === 200) {
    ok('/api/health responds', 'HTTP 200');
    const body = health.body || {};

    const leaks = ['nodeVersion', 'memory', 'uptimeSeconds', 'environment', 'db']
      .filter((key) => key in body);
    if (leaks.length === 0) ok('/api/health does not leak runtime internals');
    else bad('/api/health leaks runtime internals', `exposes: ${leaks.join(', ')}`);

    if (body.service) ok('/api/health identifies the service', body.service);
  } else {
    bad('/api/health failed', `HTTP ${health.status}`);
  }

  const deepAnon = await get('/api/health/deep');
  if (deepAnon.status === 401) ok('/api/health/deep requires authentication', 'HTTP 401');
  else if (deepAnon.status === 200) bad('/api/health/deep is PUBLIC', 'runtime details are exposed to anyone');
  else note('/api/health/deep returned', `HTTP ${deepAnon.status}`);

  const protectedEndpoints = [
    '/api/visitors', '/api/fees/summary', '/api/library/stats', '/api/hostel',
    '/api/placements/applications', '/api/campus/sensors', '/api/mentorship/stats',
  ];
  let unauthOk = true;
  for (const endpoint of protectedEndpoints) {
    // eslint-disable-next-line no-await-in-loop
    const res = await get(endpoint);
    if (res.status !== 401) {
      unauthOk = false;
      note(`${endpoint} returned ${res.status} unauthenticated`, 'expected 401');
    }
  }
  if (unauthOk) ok(`all ${protectedEndpoints.length} protected endpoints reject anonymous requests`);

  // ── 4. Public telemetry ──────────────────────────────────────────────────
  console.log('\n[4/4] Public telemetry');
  const overview = await get('/api/public/live-overview');
  if (overview.status === 200) {
    const fees = (overview.body && overview.body.fees) || {};
    if (fees.totalFormatted === 'Restricted' || fees.collectionRate === null) {
      ok('financial aggregates are masked', 'collection rate is not published');
    } else {
      note('financial aggregates are published', 'set PUBLIC_EXPOSE_FINANCIAL_METRICS to enable');
    }
    const bodyText = JSON.stringify(overview.body);
    if (/nodeVersion|uptimeSeconds/.test(bodyText)) bad('live-overview leaks runtime internals');
    else ok('live-overview does not leak runtime internals');
  } else {
    note('/api/public/live-overview returned', `HTTP ${overview.status}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n===============================================================');
  const verdict = fail === 0
    ? '\x1b[32mHARDENED BUILD DETECTED - all controls active\x1b[0m'
    : `\x1b[31m${fail} control(s) not active - the deployment is running an older build\x1b[0m`;
  console.log(` RESULT: ${pass} passed, ${fail} failed, ${warn.length} warning(s)`);
  console.log(` ${verdict}`);
  console.log('===============================================================\n');

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification crashed:', err.message);
  process.exit(1);
});
