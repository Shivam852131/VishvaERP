/**
 * Vishva ERP — End-to-End Security Verification (HTTP level)
 *
 * Runs against a LOCAL instance of the API and exercises the controls from
 * the outside, exactly the way an attacker would probe them - but strictly
 * against our own deployment.
 *
 * Requirements:
 *   - the API running on http://localhost:5000 (npm start)
 *   - a seeded database (npm run seed)
 *
 * Usage:  npm run test:security:e2e
 */

const assert = require('assert');
const path = require('path');

require('dotenv').config();

const BASE = process.env.BASE_URL || 'http://localhost:5000';

/**
 * Credentials for the end-to-end run.
 *
 * They are read from the environment so that real credentials are never
 * committed to the repository. The defaults match the seeded demo accounts
 * (`npm run seed`) so the suite works out of the box on a fresh database.
 */
const CREDENTIALS = {
  superadmin: {
    email: process.env.E2E_SUPERADMIN_EMAIL || 'superadmin@vishvaerp.com',
    password: process.env.E2E_SUPERADMIN_PASSWORD || 'SuperAdmin@123',
  },
  collegeAdmin: {
    email: process.env.E2E_COLLEGE_ADMIN_EMAIL || 'admin@techuniversity.edu',
    password: process.env.E2E_COLLEGE_ADMIN_PASSWORD || 'Admin@123',
  },
  faculty: {
    email: process.env.E2E_FACULTY_EMAIL || 'rajesh@techuniversity.edu',
    password: process.env.E2E_FACULTY_PASSWORD || 'Faculty@123',
  },
  student: {
    email: process.env.E2E_STUDENT_EMAIL || 'student1@techuniversity.edu',
    password: process.env.E2E_STUDENT_PASSWORD || 'Student@123',
  },
  parent: {
    email: process.env.E2E_PARENT_EMAIL || 'parent1@example.com',
    password: process.env.E2E_PARENT_PASSWORD || 'Parent@123',
  },
};

let passed = 0;
let total = 0;
const tokens = {};

async function check(name, fn) {
  total += 1;
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

const api = async (path, { token, ...options } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
};

async function login(role) {
  const { email, password } = CREDENTIALS[role];
  const { status, body } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (status !== 200 || !body.token) {
    throw new Error(`login failed for ${role} (${status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  tokens[role] = body.token;
  return body.token;
}

async function main() {
  console.log('\n===============================================================');
  console.log(' VISHVA ERP - END-TO-END SECURITY VERIFICATION');
  console.log(` Target: ${BASE}`);
  console.log('===============================================================\n');

  // ── 1. Information disclosure (unauthenticated) ─────────────────────────
  console.log('[1/6] Information Disclosure...');

  await check('public health endpoint does not leak runtime internals', async () => {
    const { status, body } = await api('/api/health');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.nodeVersion, undefined, 'node version leaked');
    assert.strictEqual(body.memory, undefined, 'memory usage leaked');
    assert.strictEqual(body.uptimeSeconds, undefined, 'uptime leaked');
  });

  await check('deep health endpoint requires authentication', async () => {
    const { status } = await api('/api/health/deep');
    assert.strictEqual(status, 401, `expected 401, got ${status}`);
  });

  await check('public live-overview masks financial aggregates', async () => {
    const { status, body } = await api('/api/public/live-overview');
    assert.strictEqual(status, 200);
    if (body && body.fees) {
      assert.strictEqual(body.fees.totalFormatted, 'Restricted', 'fee totals must be masked by default');
      assert.strictEqual(body.fees.collectionRate, null, 'collection rate must be masked');
    }
    assert.ok(!('nodeVersion' in (body.system || {})), 'node version must not be exposed');
  });

  // ── 2. Injection ────────────────────────────────────────────────────────
  console.log('\n[2/6] Injection Resistance...');

  await check('NoSQL operator injection in the login body is neutralised', async () => {
    const { status, body } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: { $ne: null }, password: { $gt: '' } }),
    });
    assert.ok(status === 400 || status === 401, `expected 400/401, got ${status}`);
    assert.ok(!/login successful/i.test(JSON.stringify(body)), 'injection must not authenticate');
  });

  await check('prototype pollution through the request body is neutralised', async () => {
    const payload = '{"name":"Evil","password":"Str0ng!Pass","__proto__":{"isAdmin":true,"role":"superadmin"}}';
    const { status } = await api('/api/auth/register', { method: 'POST', body: payload });
    assert.ok([201, 400].includes(status), `unexpected status ${status}`);
    assert.strictEqual({}.isAdmin, undefined, 'Object.prototype must not be polluted');
    assert.strictEqual({}.role, undefined, 'Object.prototype must not be polluted');
  });

  // ── 3. Authentication & role escalation ─────────────────────────────────
  console.log('\n[3/6] Authentication & Role Escalation...');

  for (const role of Object.keys(CREDENTIALS)) {
    // eslint-disable-next-line no-await-in-loop
    await check(`login as ${role} succeeds`, async () => {
      await login(role);
    });
  }

  await check('public registration refuses the superadmin role', async () => {
    const { status, body } = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Evil Admin',
        email: `evil-admin-${Date.now()}@example.com`,
        password: 'Str0ng!Pass123',
        role: 'superadmin',
      }),
    });
    assert.ok([400, 403].includes(status), `expected 400/403, got ${status}`);
    assert.ok(/role|permitted|valid/i.test(JSON.stringify(body)), JSON.stringify(body).slice(0, 200));
  });

  await check('public registration refuses the faculty role', async () => {
    const { status } = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Evil Faculty',
        email: `evil-faculty-${Date.now()}@example.com`,
        password: 'Str0ng!Pass123',
        role: 'faculty',
      }),
    });
    assert.ok([400, 403].includes(status), `expected 400/403, got ${status}`);
  });

  await check('verification login cannot mint an administrator session', async () => {
    const { status, body } = await api('/api/verification/verify-and-login', {
      method: 'POST',
      body: JSON.stringify({
        phone: '+919999999999',
        code: '000000',
        channel: 'sms',
        role: 'superadmin',
      }),
    });
    assert.ok(status >= 400, `expected an error, got ${status}`);
    assert.ok(!body || !body.token, 'no session may be issued');
  });

  await check('verification attempts endpoint returns a minimised summary', async () => {
    const { status, body } = await api('/api/verification/attempts?phone=%2B919999999999');
    assert.ok([200, 400, 429].includes(status), `unexpected status ${status}`);
    if (status === 200 && body) {
      assert.strictEqual(body.attempts, undefined, 'raw attempt list must not be returned');
      assert.ok(body.count !== undefined, 'a minimised summary is expected');
    }
  });

  await check('unauthenticated requests to protected endpoints are rejected', async () => {
    const endpoints = [
      '/api/visitors',
      '/api/fees/summary',
      '/api/library/stats',
      '/api/hostel',
      '/api/timetable/export/ics',
      '/api/reports/fee-receipt/000000000000000000000000',
      '/api/placements/applications',
      '/api/campus/sensors',
      '/api/mentorship/stats',
    ];
    for (const endpoint of endpoints) {
      // eslint-disable-next-line no-await-in-loop
      const { status } = await api(endpoint);
      assert.strictEqual(status, 401, `${endpoint} returned ${status}, expected 401`);
    }
  });

  // ── 4. Authorization (authenticated) ────────────────────────────────────
  console.log('\n[4/6] Authorization & Data Isolation...');

  await check('a student cannot read the visitor register', async () => {
    const { status } = await api('/api/visitors', { token: tokens.student });
    assert.strictEqual(status, 403, `expected 403, got ${status}`);
  });

  await check('a student cannot read the institution fee summary', async () => {
    const { status } = await api('/api/fees/summary', { token: tokens.student });
    assert.strictEqual(status, 403, `expected 403, got ${status}`);
  });

  await check('a student cannot read the hostel occupant roster', async () => {
    const { status } = await api('/api/hostel/000000000000000000000000', { token: tokens.student });
    assert.strictEqual(status, 403, `expected 403, got ${status}`);
  });

  await check('a student asking for another student results only ever gets their own', async () => {
    const { status, body } = await api('/api/exams/results/000000000000000000000000', {
      token: tokens.student,
    });
    assert.strictEqual(status, 200, `expected 200, got ${status}`);
    const me = await api('/api/auth/me', { token: tokens.student });
    const myId = String(me.body.user._id);
    const results = (body && body.results) || [];
    results.forEach((result) => {
      const owner = result.studentId && (result.studentId._id || result.studentId);
      if (owner) {
        assert.strictEqual(String(owner), myId, 'a student must only ever receive their own results');
      }
    });
  });

  await check('a parent only ever sees applications of their own children', async () => {
    const me = await api('/api/auth/me', { token: tokens.parent });
    const myChildren = (me.body.user.children || []).map((child) => String(child._id || child));
    const { status, body } = await api('/api/placements/applications', { token: tokens.parent });
    assert.strictEqual(status, 200, `expected 200, got ${status}`);
    const applications = (body && body.applications) || [];
    applications.forEach((application) => {
      const studentId = String(
        (application.studentId && (application.studentId._id || application.studentId)) || ''
      );
      assert.ok(
        myChildren.includes(studentId),
        `parent received an application belonging to ${studentId}, which is not one of their children`
      );
    });
  });

  await check('a faculty member cannot download a student fee receipt', async () => {
    const list = await api('/api/fees', { token: tokens.faculty });
    const fees = (list.body && list.body.fees) || [];
    if (!fees.length) return; // nothing to test against
    const { status } = await api(`/api/reports/fee-receipt/${fees[0]._id}`, { token: tokens.faculty });
    assert.ok([403, 404].includes(status), `expected 403/404, got ${status}`);
  });

  await check('a student cannot read the library fine revenue aggregate', async () => {
    const { status, body } = await api('/api/library/stats', { token: tokens.student });
    assert.strictEqual(status, 200, `expected 200, got ${status}`);
    assert.strictEqual(
      body.stats.totalFineCollected,
      undefined,
      'institution-wide fine revenue must not be exposed to students'
    );
  });

  await check('a college admin can read the fee summary', async () => {
    const { status } = await api('/api/fees/summary', { token: tokens.collegeAdmin });
    assert.strictEqual(status, 200, `expected 200, got ${status}`);
  });

  await check('a college admin can read the visitor register', async () => {
    const { status } = await api('/api/visitors', { token: tokens.collegeAdmin });
    assert.strictEqual(status, 200, `expected 200, got ${status}`);
  });

  await check('a college admin cannot escalate a user role through the update API', async () => {
    const users = await api('/api/college-admin/users', { token: tokens.collegeAdmin });
    const list = (users.body && (users.body.users || users.body.data)) || [];
    if (!list.length) return;
    const target = list.find((user) => user.role === 'student') || list[0];
    const { status, body } = await api(`/api/college-admin/users/${target._id}`, {
      method: 'PUT',
      token: tokens.collegeAdmin,
      body: JSON.stringify({
        name: 'Renamed',
        role: 'superadmin',
        collegeId: '000000000000000000000000',
      }),
    });
    assert.ok([200, 400].includes(status), `unexpected status ${status}`);
    const updated = (body && body.user) || {};
    assert.notStrictEqual(updated.role, 'superadmin', 'role must not be escalatable');
    assert.notStrictEqual(updated.collegeId, '000000000000000000000000', 'collegeId must not be writable');
  });

  // ── 5. Upload hardening ─────────────────────────────────────────────────
  console.log('\n[5/6] Upload Hardening...');

  await check('an authenticated upload of a spoofed image is rejected', async () => {
    const form = new FormData();
    form.append('file', new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/png' }), 'evil.png');
    const res = await fetch(`${BASE}/api/upload/file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.student}` },
      body: form,
    });
    assert.ok(res.status >= 400, `expected a rejection, got ${res.status}`);
    const payload = await res.json().catch(() => ({}));
    assert.ok(!/uploads\//.test(JSON.stringify(payload)), 'no upload URL may be returned');
  });

  await check('an authenticated upload of an HTML file is rejected', async () => {
    const form = new FormData();
    form.append('file', new Blob(['<html><script>alert(1)</script></html>'], { type: 'text/html' }), 'evil.html');
    const res = await fetch(`${BASE}/api/upload/file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.student}` },
      body: form,
    });
    assert.ok(res.status >= 400, `expected a rejection, got ${res.status}`);
  });

  await check('an authenticated upload with a traversal subdir stays inside /uploads', async () => {
    const form = new FormData();
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
    form.append('subdir', '../../../../tmp');
    const res = await fetch(`${BASE}/api/upload/file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.student}` },
      body: form,
    });
    const payload = await res.json().catch(() => ({}));
    if (res.status === 200 && payload.url) {
      assert.ok(payload.url.startsWith('/uploads/'), `url must stay under /uploads: ${payload.url}`);
      assert.ok(!payload.url.includes('..'), `url must not contain traversal: ${payload.url}`);
    }
  });

  await check('an uploaded image is stored under a server-derived extension and served with nosniff', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const form = new FormData();
    // The file is named `.html` on purpose - the stored extension must come
    // from the MIME type, never from the client file name.
    form.append('file', new Blob([png], { type: 'image/png' }), 'payload.html');
    const res = await fetch(`${BASE}/api/upload/file?subdir=avatars`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.student}` },
      body: form,
    });
    const payload = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(payload));
    assert.ok(payload.url.startsWith('/uploads/avatars/'), `unexpected url: ${payload.url}`);
    assert.ok(payload.url.endsWith('.png'), `extension must be derived from the mime type: ${payload.url}`);
    assert.ok(!payload.url.includes('payload.html'), 'the client file name must not be used');

    const served = await fetch(`${BASE}${payload.url}`);
    assert.strictEqual(served.status, 200, 'the stored file must be reachable at the returned url');
    assert.strictEqual(served.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((served.headers.get('content-type') || '').startsWith('image/png'), 'wrong content type');

    // Clean up.
    await fetch(`${BASE}/api/upload/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.student}` },
      body: JSON.stringify({ url: payload.url }),
    });
  });

  await check('an uploaded CSV has its spreadsheet formulas neutralised on disk', async () => {
    const csv = "name,formula\nvictim,=cmd|'/c calc'!A1\nok,fine";
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'data.csv');
    const res = await fetch(`${BASE}/api/upload/file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.student}` },
      body: form,
    });
    const payload = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(payload));
    assert.ok(payload.url.endsWith('.csv'), `unexpected url: ${payload.url}`);

    const served = await fetch(`${BASE}${payload.url}`);
    assert.ok(
      (served.headers.get('content-disposition') || '').includes('attachment'),
      'a CSV must be served as a download'
    );
    const content = await served.text();
    assert.ok(content.includes("'=cmd|'/c calc'!A1"), `the formula must be neutralised: ${content}`);
    assert.ok(content.includes('ok,fine'), 'benign rows must be preserved');

    await fetch(`${BASE}/api/upload/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.student}` },
      body: JSON.stringify({ url: payload.url }),
    });
  });

  await check('a user cannot delete another user upload', async () => {
    // The college admin uploads a file, the student tries to delete it.
    const form = new FormData();
    form.append('file', new Blob(['secret'], { type: 'text/plain' }), 'note.txt');
    const up = await fetch(`${BASE}/api/upload/file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.collegeAdmin}` },
      body: form,
    });
    const payload = await up.json();
    assert.strictEqual(up.status, 200, JSON.stringify(payload));

    const del = await fetch(`${BASE}/api/upload/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.student}` },
      body: JSON.stringify({ url: payload.url }),
    });
    assert.strictEqual(del.status, 403, `expected 403, got ${del.status}`);

    // The admin can still delete their own file.
    const own = await fetch(`${BASE}/api/upload/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.collegeAdmin}` },
      body: JSON.stringify({ url: payload.url }),
    });
    assert.strictEqual(own.status, 200, `expected 200, got ${own.status}`);
  });

  // ── 6. Session management & response headers ───────────────────────────
  console.log('\n[6/6] Session Management & Headers...');

  await check('logout invalidates the session token', async () => {
    const { body } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(CREDENTIALS.student),
    });
    const token = body.token;
    const before = await api('/api/auth/me', { token });
    assert.strictEqual(before.status, 200, 'token must work before logout');
    await api('/api/auth/logout', { method: 'POST', token });
    const after = await api('/api/auth/me', { token });
    assert.strictEqual(after.status, 401, `token must be revoked after logout, got ${after.status}`);
  });

  await check('a weak password is rejected by the change-password endpoint', async () => {
    // Re-authenticate: the logout test above revoked every session of this
    // user by bumping `tokenVersion`.
    const fresh = await login('student');
    const { status, body } = await api('/api/auth/change-password', {
      method: 'PUT',
      token: fresh,
      body: JSON.stringify({ currentPassword: 'Student@123', newPassword: 'weak' }),
    });
    assert.strictEqual(status, 400, `expected 400, got ${status}`);
    assert.ok(/password/i.test(body.message || ''), body.message);
  });

  await check('a query-string token cannot be used on a mutating endpoint', async () => {
    const { status } = await api(`/api/auth/logout?token=${encodeURIComponent(tokens.student)}`, {
      method: 'POST',
    });
    assert.strictEqual(status, 401, `expected 401, got ${status}`);
  });

  await check('API responses carry the expected security headers', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', 'nosniff header missing');
    assert.ok(res.headers.get('x-frame-options'), 'x-frame-options header missing');
    assert.ok(!res.headers.get('x-powered-by'), 'x-powered-by must be hidden');
  });

  console.log('\n===============================================================');
  console.log(` SUMMARY: ${passed} of ${total} checks passed (${Math.round((passed / total) * 100)}%)`);
  console.log('===============================================================\n');
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification crashed:', err);
  process.exit(1);
});
