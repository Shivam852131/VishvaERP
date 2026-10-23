# Vishva ERP — Security Testing & Verification Report

**Date of Execution:** 2026-10-23  
**Test Suite:** `tests/security_verification.js` (`npm run test:security`)  
**Environment:** Node.js Runtime (Local Automated Verification)  
**Assessor:** Senior Application Security & Penetration Testing Specialist  

---

## 1. Test Execution Summary

An automated security test suite was developed to systematically verify the defensive controls implemented in Vishva ERP. All tests were executed against the actual modified application components without external mocking of security boundaries.

```
===============================================================
 VISHVA ERP - AUTOMATED SECURITY HARDENING TEST SUITE
===============================================================

[1/8] Testing Password Hashing & Bcrypt Security...
  [PASS] Password hash must be salted bcrypt (cost >= 10)

[2/8] Testing JWT Token Generation & Revocation Handling...
  [PASS] Token generation embeds tokenVersion and verifies signature
  [PASS] Tampered token is rejected by verifyToken
  [PASS] Session revocation check detects mismatched tokenVersion

[3/8] Testing Password Reset Token Hashing...
  [PASS] Reset token must be high-entropy and stored only as SHA-256 hash

[4/8] Testing NoSQL Operator Injection Sanitization Middleware...
  [PASS] Sanitize middleware strips $ operators and dot notation recursively

[5/8] Testing Path Traversal Protection in File Deletion...
  [PASS] deleteFile rejects directory traversal patterns and outside files

[6/8] Testing IDOR/BOLA Protection for Student & Parent Access...
  [PASS] resolveAuthorizedStudentId strictly isolates student to their own data
  [PASS] resolveAuthorizedStudentId rejects parent accessing unauthorized child with 403

[7/8] Testing Live Class Jitsi Room Name Randomization...
  [PASS] Live class room names are unique and unguessable

[8/8] Testing Registration Validation & RBAC Controls...
  [PASS] Registration route validator rejects superadmin role

===============================================================
 SUMMARY: 11 of 11 security tests passed (100%)
===============================================================
```

---

## 2. Detailed Test Cases & Results

### Test Group 1: Cryptographic Password Storage
- **Test Name:** `Password hash must be salted bcrypt (cost >= 10)`
- **Objective:** Verify passwords are not stored in plaintext or weak hashes (MD5/SHA1), and bcrypt verification functions correctly.
- **Payload:** High-entropy string `StrongPass123!@#` processed via `bcrypt.genSalt(10)` and `bcrypt.hash()`.
- **Result:** **PASSED**. Generated hash conforms to `$2a$` / `$2b$` format. Correct password returns `true`; incorrect password returns `false`.

### Test Group 2: Token Security & Session Invalidation
- **Test Name:** `Token generation embeds tokenVersion and verifies signature`
  - **Objective:** Ensure issued JWTs carry the user's `tokenVersion` claim for stateful invalidation.
  - **Result:** **PASSED**. Decoded token contains valid `id`, `role`, and `tokenVersion: 2`.
- **Test Name:** `Tampered token is rejected by verifyToken`
  - **Objective:** Verify signature validation rejects modified claims (privilege escalation attempt changing `role: 'student'` to `role: 'superadmin'`).
  - **Result:** **PASSED**. `verifyToken` throws `JsonWebTokenError: invalid signature`.
- **Test Name:** `Session revocation check detects mismatched tokenVersion`
  - **Objective:** Ensure tokens issued before password reset, password change, or logout are rejected.
  - **Result:** **PASSED**. Token with version 1 is rejected when database user version is 2.

### Test Group 3: Password Reset Token Security
- **Test Name:** `Reset token must be high-entropy and stored only as SHA-256 hash`
- **Objective:** Ensure reset tokens are 32-byte cryptographic random strings and stored exclusively as SHA-256 digests in MongoDB.
- **Result:** **PASSED**. Database stores a 64-character SHA-256 hex digest; raw tokens are never persisted.

### Test Group 4: NoSQL Operator Injection Sanitization
- **Test Name:** `Sanitize middleware strips $ operators and dot notation recursively`
- **Objective:** Verify malicious MongoDB query operators (`$ne`, `$gt`, `$where`, `$regex`) are stripped from `req.body`, `req.query`, and `req.params`.
- **Attack Payload:**
  ```json
  {
    "username": "admin",
    "password": { "$ne": null },
    "filter": {
      "$gt": 0,
      "nested": {
        "$where": "sleep(5000)",
        "validKey": "safeValue"
      }
    },
    "malicious.key": "attack"
  }
  ```
- **Result:** **PASSED**. All `$` keys and dot-containing keys were stripped; valid nested keys remained untouched.

### Test Group 5: Path Traversal Protection
- **Test Name:** `deleteFile rejects directory traversal patterns and outside files`
- **Objective:** Prevent arbitrary file deletion across the operating system.
- **Attack Vectors Tested:**
  - `../../etc/passwd`
  - `..\\..\\Windows\\System32\\cmd.exe`
  - `uploads/../../server.js`
  - `foo/bar/../../../.env`
  - `safe/path/\0/evil.txt`
- **Result:** **PASSED**. All traversal vectors threw errors with `Invalid file path` or `Access denied: Path outside uploads directory`.

### Test Group 6: IDOR / Broken Object Level Authorization
- **Test Name:** `resolveAuthorizedStudentId strictly isolates student to their own data`
  - **Scenario:** A student attempts to access their own attendance summary, and subsequently attempts an IDOR attack requesting `victim_222`.
  - **Result:** **PASSED**. When requesting `victim_222`, the system overrides the parameter and returns the student's own ID (`student_111`).
- **Test Name:** `resolveAuthorizedStudentId rejects parent accessing unauthorized child with 403`
  - **Scenario:** A parent linked to `child_333` attempts to access attendance for unlinked student `foreign_888`.
  - **Result:** **PASSED**. Access denied; controller throws `403 Forbidden`.

### Test Group 7: Live Class URL Unguessability
- **Test Name:** `Live class room names are unique and unguessable`
- **Objective:** Prevent unauthorized eavesdropping on Jitsi video lectures.
- **Result:** **PASSED**. Room names generated for identical subjects at identical timestamps contain distinct 16-hex-character cryptographic suffixes.

### Test Group 8: Role-Based Registration Restriction
- **Test Name:** `Registration route validator rejects superadmin role`
- **Objective:** Confirm public registration endpoints do not allow privilege escalation to `superadmin`, `collegeAdmin`, or `faculty`.
- **Result:** **PASSED**. Allowed registration roles are strictly restricted to `['student', 'parent']`.

---

## 3. Residual Risks & Recommended Future Actions

While the application code and server middleware have been hardened, the following infrastructure and operational items remain recommended:

1. **Production Reverse Proxy & TLS**:
   - Ensure an Nginx or Cloudflare reverse proxy handles SSL/TLS termination with HTTP/2 and modern ciphers (TLS 1.2+).
2. **MongoDB Atlas IP Access List**:
   - In production, restrict Atlas IP access strictly to the static IP addresses of the application backend servers rather than `0.0.0.0/0`.
3. **Secret Rotation Policy**:
   - Production secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `RAZORPAY_KEY_SECRET`, `SUPER_ADMIN_PASSWORD`) should be generated using `openssl rand -hex 64` and rotated on a scheduled basis (every 90-180 days).
4. **Third-Party Dependency Upgrades**:
   - Transitive advisory in `xlsx` (sheet parsing) and `proxy-addr` should be monitored for upstream patches in major framework releases.
