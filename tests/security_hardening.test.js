/**
 * Vishva ERP — Security Hardening Regression Suite (Phase 2)
 *
 * Covers the controls added during the 2026-11 hardening pass:
 *   1. Prototype pollution prevention in the global sanitizer
 *   2. Server-controlled upload extensions (stored-XSS prevention)
 *   3. CSV formula-injection neutralisation
 *   4. Regex injection / ReDoS prevention in MongoDB queries
 *   5. Mass-assignment protection (schema-scoped writes)
 *   6. Public sign-up role allow-lists (privilege escalation)
 *   7. Password policy enforcement
 *   8. JWT secret strength validation
 *   9. Student-scoped access control helpers (IDOR)
 *  10. Upload directory / path containment
 *  11. Security headers on served uploads
 *  12. Health endpoint information disclosure
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const sanitize = require('../backend/middleware/sanitize');
const { regexFilter, anchoredRegexFilter, escapeRegex } = require('../backend/utils/parseHelpers');
const { pickWritable, buildUpdate, buildDocument } = require('../backend/utils/safeUpdate');
const { MIME_EXTENSIONS, neutralizeCsvFormulas, pickSubdir, verifyMagicBytes } = require('../backend/middleware/upload');
const { resolveSubdir, safeFileName, UPLOAD_DIR } = require('../backend/services/fileService');
const { resolveAuthorizedStudentId, filterAuthorizedStudentIds, getChildStudentIds } = require('../backend/utils/accessControl');
const { hashResetToken, generateResetToken } = require('../backend/config/jwt');
const User = require('../backend/models/User');
const College = require('../backend/models/College');

let passed = 0;
let total = 0;

function test(name, fn) {
  total += 1;
  try {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  total += 1;
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

async function runSuite() {
  console.log('\n===============================================================');
  console.log(' VISHVA ERP - SECURITY HARDENING REGRESSION SUITE (PHASE 2)');
  console.log('===============================================================\n');

  // ── 1. Prototype pollution ───────────────────────────────────────────────
  console.log('[1/12] Testing Prototype Pollution Prevention...');

  test('sanitize strips __proto__ / constructor / prototype keys', () => {
    const req = {
      body: JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"safe":"ok"}'),
      query: {},
      params: {},
    };
    sanitize(req, {}, () => {});
    assert.strictEqual(req.body.polluted, undefined, 'prototype must not be polluted');
    assert.strictEqual({}.polluted, undefined, 'Object.prototype must be untouched');
    assert.strictEqual(req.body.safe, 'ok', 'safe keys survive');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(req.body, '__proto__'), false);
  });

  test('sanitize strips prototype keys at every nesting depth', () => {
    const req = {
      body: JSON.parse('{"a":{"b":{"__proto__":{"deep":true}}}}'),
      query: {},
      params: {},
    };
    sanitize(req, {}, () => {});
    assert.strictEqual({}.deep, undefined, 'nested prototype pollution must be blocked');
    assert.strictEqual(req.body.a.b.deep, undefined);
  });

  test('sanitize still strips NoSQL operators at depth', () => {
    const req = { body: { user: { password: { $ne: null } } }, query: {}, params: {} };
    sanitize(req, {}, () => {});
    assert.strictEqual(req.body.user.password.$ne, undefined, '$ne must be removed');
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(req.body.user.password, '$ne'),
      false,
      'the operator key must not survive'
    );
  });

  // ── 2. Upload extension control ──────────────────────────────────────────
  console.log('\n[2/12] Testing Upload Extension & Content-Type Control...');

  test('server maps MIME types to canonical extensions', () => {
    assert.strictEqual(MIME_EXTENSIONS['image/jpeg'], '.jpg');
    assert.strictEqual(MIME_EXTENSIONS['application/pdf'], '.pdf');
    assert.strictEqual(MIME_EXTENSIONS['text/plain'], '.txt');
    // Dangerous types are not in the allow-list at all.
    ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/javascript', 'text/xml']
      .forEach((mime) => {
        assert.strictEqual(MIME_EXTENSIONS[mime], undefined, `${mime} must not be storable`);
      });
  });

  test('upload sub-directory is restricted to the allow-list', () => {
    assert.strictEqual(pickSubdir({ query: {}, body: {} }), 'temp');
    assert.strictEqual(pickSubdir({ query: { subdir: 'avatars' }, body: {} }), 'avatars');
    assert.strictEqual(pickSubdir({ query: {}, body: { subdir: 'resumes' } }), 'resumes');
    assert.strictEqual(pickSubdir({ query: { subdir: '../../etc' }, body: {} }), 'temp');
    assert.strictEqual(pickSubdir({ query: { subdir: '/etc/passwd' }, body: {} }), 'temp');
  });

  test('resolveSubdir never escapes the upload root', () => {
    const resolved = resolveSubdir('../../windows');
    assert.ok(resolved.startsWith(path.resolve(UPLOAD_DIR)), 'resolved dir must stay inside UPLOAD_DIR');
  });

  test('safeFileName rejects traversal and separators', () => {
    assert.strictEqual(safeFileName('report.pdf'), 'report.pdf');
    ['../evil.js', 'a/b.txt', 'a\\b.txt', 'x\0.js', ''].forEach((name) => {
      let threw = false;
      try {
        safeFileName(name);
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, true, `must reject: ${name}`);
    });
  });

  // ── 3. CSV formula injection ─────────────────────────────────────────────
  console.log('\n[3/12] Testing CSV Formula Injection Neutralisation...');

  test('CSV formula cells are escaped', () => {
    const csv = "name,value\nvictim,=cmd|'/c calc'!A1\nsafe,hello";
    const out = neutralizeCsvFormulas(Buffer.from(csv, 'utf8')).toString('utf8');
    assert.ok(out.includes("'=cmd|'/c calc'!A1"), `formula must be prefixed with a quote: ${out}`);
    assert.ok(out.includes('safe,hello'), 'benign rows must be untouched');
  });

  test('CSV with @ / + / - formulas is neutralised', () => {
    ['=1+1', '@SUM(A1)', '+1', '-1'].forEach((formula) => {
      const out = neutralizeCsvFormulas(Buffer.from(`a\n${formula}`, 'utf8')).toString('utf8');
      assert.ok(out.includes(`'${formula}`), `formula must be escaped: ${formula}`);
    });
  });

  test('CSV quoting structure is preserved', () => {
    const csv = 'name,note\n"Doe, John","a, b"';
    const out = neutralizeCsvFormulas(Buffer.from(csv, 'utf8')).toString('utf8');
    assert.ok(out.includes('"Doe, John"'), `quoted comma field preserved: ${out}`);
    assert.ok(out.includes('"a, b"'), `second quoted field preserved: ${out}`);
    // Column count must not change.
    const rows = out.trim().split(/\r?\n/);
    assert.strictEqual(rows.length, 2);
  });

  test('CSV with a quoted formula cell is neutralised and re-quoted', () => {
    const csv = 'name,formula\n"x","=SUM(A1,B2)"';
    const out = neutralizeCsvFormulas(Buffer.from(csv, 'utf8')).toString('utf8');
    assert.ok(out.includes('"\'=SUM(A1,B2)"'), `quoted formula must be escaped: ${out}`);
  });

  // ── 4. Regex injection / ReDoS ───────────────────────────────────────────
  console.log('\n[4/12] Testing Regex Injection & ReDoS Prevention...');

  test('regexFilter escapes metacharacters', () => {
    const filter = regexFilter('.*');
    assert.strictEqual(filter.$regex, '\\.\\*', 'wildcards must be escaped');
    assert.strictEqual(filter.$options, 'i');
  });

  test('regexFilter leaves no unescaped metacharacters', () => {
    const hostile = '(a+)+$';
    const filter = regexFilter(hostile);
    // Every metacharacter must be backslash-escaped.
    const unescaped = filter.$regex.replace(/\\./g, '');
    assert.ok(!/[.*+?^${}()|[\]\\]/.test(unescaped), `no raw metacharacter may remain: ${filter.$regex}`);
  });

  test('regexFilter caps the search length', () => {
    const filter = regexFilter('a'.repeat(5000));
    assert.ok(filter.$regex.length <= 120, `regex must be capped, got ${filter.$regex.length}`);
  });

  test('anchoredRegexFilter anchors the pattern', () => {
    const filter = anchoredRegexFilter('CS101');
    assert.strictEqual(filter.$regex, '^CS101$');
  });

  test('escapeRegex still escapes the classic metacharacters', () => {
    assert.strictEqual(escapeRegex('a.b*c'), 'a\\.b\\*c');
  });

  // ── 5. Mass assignment ───────────────────────────────────────────────────
  console.log('\n[5/12] Testing Mass Assignment Protection...');

  test('pickWritable only copies schema-known fields', () => {
    const writable = pickWritable(User, {
      name: 'Alice',
      role: 'superadmin',
      collegeId: 'other-college',
      tokenVersion: 99,
      isActive: true,
      notAField: 'x',
    });
    assert.strictEqual(writable.name, 'Alice');
    assert.strictEqual(writable.role, undefined, 'role must not be writable');
    assert.strictEqual(writable.collegeId, undefined, 'collegeId must not be writable');
    assert.strictEqual(writable.tokenVersion, undefined, 'tokenVersion must not be writable');
    assert.strictEqual(writable.notAField, undefined, 'unknown fields must be dropped');
  });

  test('buildUpdate produces a $set document', () => {
    const update = buildUpdate(User, { name: 'Bob', role: 'superadmin' });
    assert.deepStrictEqual(Object.keys(update), ['$set']);
    assert.strictEqual(update.$set.name, 'Bob');
    assert.strictEqual(update.$set.role, undefined);
  });

  test('buildDocument re-applies server fields last', () => {
    const doc = buildDocument(College, { name: 'X', code: 'C1', isActive: false }, {
      serverFields: { collegeId: 'server-college', isActive: true },
    });
    assert.strictEqual(doc.collegeId, 'server-college');
    assert.strictEqual(doc.isActive, true, 'server field must win over client payload');
    assert.strictEqual(doc.name, 'X');
  });

  test('extraProtected fields are locked down', () => {
    const writable = pickWritable(User, { name: 'C', isActive: false }, ['isActive']);
    assert.strictEqual(writable.isActive, undefined);
    assert.strictEqual(writable.name, 'C');
  });

  test('schema-driven filtering never silently drops a legitimate field', () => {
    // Guard against the schema-driven write helper quietly discarding data:
    // every writable schema path (including the root of a nested object such
    // as `currentLocation`) must survive the filter.
    const models = {
      Hostel: require('../backend/models/Hostel').Hostel,
      Room: require('../backend/models/Hostel').Room,
      TransportRoute: require('../backend/models/Transport'),
      Event: require('../backend/models/Event'),
      QuestionBank: require('../backend/models/QuestionBank'),
      InventoryItem: require('../backend/models/Inventory'),
      Book: require('../backend/models/Library').Book,
      PlacementCompany: require('../backend/models/Placement').PlacementCompany,
      PlacementJob: require('../backend/models/Placement').PlacementJob,
      PlacementDrive: require('../backend/models/PlacementDrive').PlacementDrive,
      CampusSensor: require('../backend/models/CampusSensor').CampusSensor,
      CampusResource: require('../backend/models/CampusResource'),
      EnergyLog: require('../backend/models/EnergyLog').EnergyLog,
      SustainabilityGoal: require('../backend/models/EnergyLog').SustainabilityGoal,
      College: require('../backend/models/College'),
      User: require('../backend/models/User'),
    };

    const alwaysProtected = new Set([
      '_id', 'id', '__v', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
      'collegeId', 'role', 'tokenVersion',
    ]);

    Object.entries(models).forEach(([name, model]) => {
      const paths = Object.keys(model.schema.paths);
      const payload = {};
      paths.filter((p) => !p.includes('.')).forEach((p) => {
        if (!alwaysProtected.has(p)) payload[p] = 'x';
      });
      paths.filter((p) => p.includes('.')).forEach((p) => {
        const root = p.split('.')[0];
        if (!alwaysProtected.has(root) && payload[root] === undefined) payload[root] = { a: 1 };
      });

      const writable = pickWritable(model, payload);
      const missing = Object.keys(payload).filter((key) => writable[key] === undefined);
      assert.deepStrictEqual(missing, [], `${name}: these fields would be silently dropped -> ${missing.join(', ')}`);
    });
  });

  // ── 6. Public sign-up role allow-lists ───────────────────────────────────
  console.log('\n[6/12] Testing Public Sign-up Role Allow-lists...');

  test('verification login cannot create an administrative account', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'backend', 'controllers', 'verificationController.js'),
      'utf8'
    );
    assert.ok(src.includes('PUBLIC_PROVISION_ROLES'), 'allow-list must exist');
    const match = src.match(/PUBLIC_PROVISION_ROLES\s*=\s*new Set\(\[(.*?)\]\)/s);
    assert.ok(match, 'allow-list must be a literal set');
    const roles = match[1].split(',').map((r) => r.trim().replace(/['"]/g, '')).filter(Boolean);
    assert.ok(!roles.includes('superadmin'), 'superadmin must never be self-provisionable');
    assert.ok(!roles.includes('faculty'), 'faculty must never be self-provisionable');
    assert.ok(!roles.includes('collegeAdmin'), 'collegeAdmin must never be self-provisionable');
    assert.ok(roles.includes('student') && roles.includes('parent'));
  });

  test('auth controller blocks privileged self-registration', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'backend', 'controllers', 'authController.js'),
      'utf8'
    );
    assert.ok(src.includes("role === 'superadmin' || role === 'faculty'"), 'register must block superadmin/faculty');
    const match = src.match(/GOOGLE_PROVISION_ROLES\s*=\s*new Set\(\[(.*?)\]\)/s);
    assert.ok(match, 'google provision roles must be an explicit allow-list');
    const roles = match[1].split(',').map((r) => r.trim().replace(/['"]/g, '')).filter(Boolean);
    assert.ok(!roles.includes('superadmin'));
    assert.ok(!roles.includes('faculty'));
  });

  // ── 7. Password policy ───────────────────────────────────────────────────
  console.log('\n[7/12] Testing Password Policy...');

  test('password policy requires 8+ chars and 4 character classes', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'backend', 'controllers', 'authController.js'),
      'utf8'
    );
    assert.ok(
      src.includes('PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$/'),
      'strong password regex must be defined'
    );
    // register, change-password and reset-password must all use it.
    const strongCalls = (src.match(/isStrongPassword\(/g) || []).length;
    assert.ok(strongCalls >= 3, `policy must be applied at register/change/reset (found ${strongCalls} calls)`);
    assert.ok(!/newPassword\.length < 6/.test(src), 'the weak 6-character rule must be gone');
    assert.ok(!/password\.length < 6/.test(src), 'the weak 6-character rule must be gone');
  });

  // ── 8. JWT secret strength ───────────────────────────────────────────────
  console.log('\n[8/12] Testing JWT Secret Strength Validation...');

  test('production refuses a short or placeholder JWT secret', async () => {    const jwtPath = path.join(__dirname, '..', 'backend', 'config', 'jwt.js');
    const backup = process.env.JWT_SECRET;
    const originalEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'production';
      delete require.cache[require.resolve(jwtPath)];

      process.env.JWT_SECRET = 'short';
      assert.throws(
        () => require(jwtPath).generateToken({ id: 'x' }),
        /at least 32 characters/,
        'short secrets must be rejected'
      );

      process.env.JWT_SECRET = 'change-this-to-a-real-secret-value-please';
      assert.throws(
        () => require(jwtPath).generateToken({ id: 'x' }),
        /placeholder/i,
        'placeholder secrets must be rejected'
      );

      process.env.JWT_SECRET = 'a'.repeat(48);
      assert.ok(require(jwtPath).generateToken({ id: 'x' }), 'strong secrets must work');
    } finally {
      if (backup === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = backup;
      process.env.NODE_ENV = originalEnv;
      delete require.cache[require.resolve(jwtPath)];
    }
  });

  test('reset tokens are hashed with SHA-256 before storage', () => {
    const token = generateResetToken();
    const hashed = hashResetToken(token);
    assert.notStrictEqual(hashed, token, 'raw token must never be stored');
    assert.strictEqual(hashed.length, 64, 'SHA-256 hex digest length');
    assert.strictEqual(hashResetToken(token), hashed, 'hashing must be deterministic');
  });

  // ── 9. Student-scoped access control ────────────────────────────────────
  console.log('\n[9/12] Testing Student-Scoped Access Control Helpers...');

  await asyncTest('student is always isolated to their own record', async () => {
    const req = { user: { _id: 'stu-1', role: 'student', collegeId: 'col-1' } };
    assert.strictEqual(String(await resolveAuthorizedStudentId(req, 'stu-1')), 'stu-1');
    assert.strictEqual(String(await resolveAuthorizedStudentId(req, 'victim-2')), 'stu-1');
  });

  await asyncTest('parent is restricted to linked children', async () => {
    const req = { user: { _id: 'par-1', role: 'parent', collegeId: 'col-1', children: ['kid-1'] } };
    assert.strictEqual(String(await resolveAuthorizedStudentId(req, 'kid-1')), 'kid-1');
    let status = null;
    try {
      await resolveAuthorizedStudentId(req, 'other-kid');
    } catch (err) {
      status = err.statusCode;
    }
    assert.strictEqual(status, 403, 'parent accessing an unlinked student must be 403');
  });

  await asyncTest('filterAuthorizedStudentIds removes foreign ids', async () => {
    const studentReq = { user: { _id: 'stu-1', role: 'student', collegeId: 'col-1' } };
    assert.deepStrictEqual(
      await filterAuthorizedStudentIds(studentReq, ['stu-1', 'stu-2']),
      ['stu-1']
    );
    const parentReq = { user: { _id: 'par-1', role: 'parent', collegeId: 'col-1', children: ['kid-1'] } };
    assert.deepStrictEqual(
      await filterAuthorizedStudentIds(parentReq, ['kid-1', 'kid-9']),
      ['kid-1']
    );
  });

  await asyncTest('getChildStudentIds returns an empty list for non-parents', async () => {
    const req = { user: { _id: 'fac-1', role: 'faculty', collegeId: 'col-1' } };
    assert.deepStrictEqual(await getChildStudentIds(req), []);
  });

  // ── 10. Magic byte verification ──────────────────────────────────────────
  console.log('\n[10/12] Testing Upload Content Verification...');

  await asyncTest('a file that lies about its content type is rejected', async () => {
    const os = require('os');
    const fakePng = path.join(os.tmpdir(), `vishva-fake-${Date.now()}.png`);
    fs.writeFileSync(fakePng, '<html><script>alert(1)</script></html>');
    try {
      const valid = await verifyMagicBytes(fakePng, 'image/png');
      assert.strictEqual(valid, false, 'HTML content must not pass as a PNG');
    } finally {
      fs.unlinkSync(fakePng);
    }
  });

  await asyncTest('a genuine PNG passes verification', async () => {
    const os = require('os');
    const realPng = path.join(os.tmpdir(), `vishva-real-${Date.now()}.png`);
    const buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(realPng, buffer);
    try {
      const valid = await verifyMagicBytes(realPng, 'image/png');
      assert.strictEqual(valid, true, 'a real PNG must pass');
    } finally {
      fs.unlinkSync(realPng);
    }
  });

  // ── 11. Served upload headers ────────────────────────────────────────────
  console.log('\n[11/12] Testing Static Upload Serving Headers...');

  test('uploads are served with nosniff and attachment for non-media', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');
    assert.ok(serverSrc.includes("'X-Content-Type-Options', 'nosniff'"), 'nosniff must be set');
    assert.ok(serverSrc.includes("'Content-Disposition', 'attachment'"), 'non-media must download');
    assert.ok(serverSrc.includes('INLINE_SAFE_UPLOAD_EXTENSIONS'), 'inline allow-list must exist');
  });

  test('CSP includes clickjacking and form-action protections', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');
    assert.ok(serverSrc.includes('frameAncestors'), 'frameAncestors must be set');
    assert.ok(serverSrc.includes('formAction'), 'formAction must be set');
    assert.ok(serverSrc.includes('objectSrc: ["\'none\'"]'), 'object-src must be none');
  });

  // ── 12. Information disclosure ───────────────────────────────────────────
  console.log('\n[12/12] Testing Information Disclosure Controls...');

  test('health endpoint does not expose runtime internals publicly', () => {
    const healthSrc = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'health.js'), 'utf8');
    // Only inspect the public "/" handler body.
    const start = healthSrc.indexOf("router.get('/'");
    const end = healthSrc.indexOf("router.get('/db'");
    assert.ok(start > -1 && end > start, 'public handler must be locatable');
    const publicBlock = healthSrc.slice(start, end);
    assert.ok(!publicBlock.includes('nodeVersion'), 'node version must not be public');
    assert.ok(!publicBlock.includes('memory'), 'memory usage must not be public');
    assert.ok(!publicBlock.includes('uptime'), 'uptime must not be public');
    assert.ok(healthSrc.includes("authorize('superadmin', 'collegeAdmin')"), '/deep must be admin-only');
  });

  test('public live-overview does not leak internal error messages', () => {
    const publicSrc = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'public.js'), 'utf8');
    assert.ok(!/error:\s*error\.message/.test(publicSrc), 'internal error text must not be returned');
    assert.ok(publicSrc.includes('PUBLIC_EXPOSE_FINANCIAL_METRICS'), 'financial metrics must be opt-in');
  });

  test('CORS rejects unknown origins in production', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');
    assert.ok(serverSrc.includes('configuredOrigins.length === 0'), 'production must fail closed without an allow-list');
    assert.ok(serverSrc.includes('CORS: FRONTEND_URL'), 'misconfiguration must be logged');
  });

  test('superadmin raw collection reads redact credentials', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'backend', 'controllers', 'superAdminController.js'),
      'utf8'
    );
    assert.ok(src.includes('SENSITIVE_FIELDS'), 'sensitive field map must exist');
    assert.ok(src.includes('redactSensitive'), 'redaction must be applied');
    assert.ok(src.includes("'password'"), 'password hash must be redacted');
    assert.ok(src.includes("'otp'"), 'live OTP codes must be redacted');
  });
}

runSuite()
  .then(() => {
    console.log('\n===============================================================');
    console.log(` SUMMARY: ${passed} of ${total} security tests passed (${Math.round((passed / total) * 100)}%)`);
    console.log('===============================================================\n');
    process.exit(passed === total ? 0 : 1);
  })
  .catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
  });
