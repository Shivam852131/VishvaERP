# Vishva ERP — Complete Security Audit & Vulnerability Assessment Report

**Assessment Date:** 2026-10-23  
**Classification:** Confirmed Findings & Architectural Assessment  
**Target Platform:** Vishva ERP (Multi-College AI-Powered SaaS ERP Platform)  
**Assessor:** Senior Application Security & Penetration Testing Specialist  

---

## 1. Executive Summary

A comprehensive security audit, architecture inspection, and vulnerability assessment of the **Vishva ERP** codebase was conducted across its frontend, backend services, database layer, authentication system, multi-tenant role-based access control (RBAC), and deployment infrastructure.

The assessment revealed that while Vishva ERP has an extensive enterprise feature set (multi-college SaaS, fee collection, attendance tracking, live classes, exams, AI generation, and Razorpay integration), several **Critical** and **High-severity** security vulnerabilities exist in its implementation. Most notably:
1. **Unauthenticated Super Admin Self-Registration**: Any external user can register directly with the `superadmin` role and gain complete root control over the platform.
2. **Arbitrary File Deletion via Path Traversal**: Authenticated file deletion endpoints do not sanitize input or verify boundaries, permitting arbitrary file deletion across the host filesystem.
3. **Unauthenticated Real-Time Data Interception in Socket.io**: Socket.io connections are unauthenticated and allow joining any user's private notification channel.
4. **Broken Function Level Authorization in Fees**: Students and parents are authorized on the manual offline cash payment endpoint, allowing self-marking fees as paid without paying.
5. **IDOR & Data Leakage in Academic, Attendance, and Grievance Records**: Students and parents can access transcripts, attendance records, and confidential grievances of any user across the institution.
6. **NoSQL Injection & Missing Content Security Policy**: MongoDB query operators are not stripped from input, and CSP is disabled in Helmet.

Remediation of these vulnerabilities was planned with strict preservation of existing legitimate workflows and backwards compatibility.

---

## 2. Detected Technology Stack & Application Architecture

| Layer | Detected Technologies | Details & Configuration |
| :--- | :--- | :--- |
| **Backend Runtime** | Node.js (>=18.0.0), Express 4.18.2 | RESTful API with route prefix `/api` and `/api/v1` |
| **Database** | MongoDB / MongoDB Atlas (Mongoose 8.3.4) | Multi-tenant single-database schema with `collegeId` isolation |
| **Real-Time Layer** | Socket.io 4.8.1 | WebSockets / Polling for live notifications and data sync |
| **Authentication** | JWT (`jsonwebtoken` 9.0.2), `bcryptjs` 2.4.3 | Bearer tokens in Authorization headers, OTP email/phone, Google OAuth |
| **File Processing** | `multer` 1.4.5, `sharp` 0.35.3, `pdfkit` 0.15.0 | Local disk storage under `backend/uploads/` (avatars, notes, receipts) |
| **Payment Gateway**| Razorpay Node SDK 2.9.6 | Order generation, HMAC-SHA256 signature check, Webhook handler |
| **Frontend Web** | Vanilla HTML5 / JavaScript / CSS & React Build | Multi-portal SPA/MPA served by Express static middleware |
| **External Integrations** | Google OAuth (`google-auth-library`), Nodemailer, Twilio, OpenAI | Background transactional communications and AI generation |
| **Deployment** | Docker, Vercel (`serverless-http`), Render, PM2 | Reverse proxy configs (nginx), containerized Node runtime |

### Architecture Flow
```
[ Browser / Mobile Client ]
         │ (HTTPS / WSS)
         ▼
[ Reverse Proxy / Cloud Load Balancer ]
         │
         ▼
[ Express API Gateway / Middleware ]
  ├── Compression, Correlation ID
  ├── CORS (Configured origins)
  ├── Rate Limiters (General, Auth, AI)
  ├── Sanitizer & Body Parsers
  └── Helmet Security Headers
         │
         ├──► [ Public Routes ] (Login, Register, Webhooks, Verification)
         └──► [ Protected Routes ]
                ├── Auth Middleware (JWT Validation)
                ├── RBAC Middleware (`authorize`, `sameCollege`)
                ├── Subscription Middleware (`requireSubscription`)
                └── Controllers
                      │
                      ├──► [ MongoDB Atlas ] (Collections scoped by collegeId)
                      ├──► [ Local Disk Storage ] (`backend/uploads/`)
                      ├──► [ Socket.io Engine ] (Real-time events)
                      └──► [ External APIs ] (Razorpay, Google OAuth, Twilio)
```

---

## 3. Vulnerability Summary & Severity Matrix

| ID | Title | Severity | CVSS v3.1 | Status |
| :--- | :--- | :--- | :--- | :--- |
| **VULN-01** | Unauthenticated Super Admin Account Creation via Public Registration | **Critical** | 9.8 | Confirmed |
| **VULN-02** | Arbitrary File Deletion / Path Traversal in File Upload Controller | **Critical** | 9.1 | Confirmed |
| **VULN-03** | Unauthenticated Real-Time Data Interception and Room Spoofing in Socket.io | **Critical** | 9.1 | Confirmed |
| **VULN-04** | Broken Function Level Authorization: Students/Parents Can Mark Fees Paid | **Critical** | 9.1 | Confirmed |
| **VULN-05** | Mass Assignment & Privilege Escalation in College Admin User Update | **High** | 8.5 | Confirmed |
| **VULN-06** | IDOR / BOLA in Student Academic Results and Attendance Endpoints | **High** | 7.5 | Confirmed |
| **VULN-07** | Confidential Grievance & Anonymous Whistleblower Data Exposure | **High** | 7.5 | Confirmed |
| **VULN-08** | Broken Object Authorization in Faculty Assignment Management | **High** | 7.1 | Confirmed |
| **VULN-09** | Tenant Isolation Bypass in `sameCollege` RBAC Middleware | **High** | 7.5 | Confirmed |
| **VULN-10** | Missing NoSQL MongoDB Operator Injection Sanitization | **Medium** | 6.5 | Confirmed |
| **VULN-11** | Sensitive Token Exposure in Query Parameters & Missing Server Logout | **Medium** | 5.8 | Confirmed |
| **VULN-12** | Plaintext Reset Token Storage & Missing Rate Limits on Auth Endpoints | **Medium** | 5.3 | Confirmed |
| **VULN-13** | Disabled Content Security Policy (CSP) in Helmet | **Medium** | 5.4 | Confirmed |
| **VULN-14** | Predictable Public Jitsi Meeting Room Names | **Medium** | 5.3 | Confirmed |
| **VULN-15** | Known Vulnerable Dependencies (`proxy-addr`, `xlsx`, `sharp`, `socket.io-parser`) | **High** | 8.2 | Confirmed |

---

## 4. In-Depth Vulnerability Evidence & Remediation Plan

### VULN-01: Unauthenticated Super Admin Account Creation
- **File:** `backend/routes/auth.js:13`, `backend/controllers/authController.js:98-137`, `564-570`, `967-975`
- **Evidence:**  
  `router.post('/register', [body('role').isIn(['superadmin', 'collegeAdmin', 'faculty', 'student', 'parent'])], register);`  
  In `authController.js`, `User.create({ name, email, password, role, ... })` persists the exact role submitted in the payload. Furthermore, OTP login auto-registration (`verifyOTPLogin` and `verifyPhoneOTP`) accepts arbitrary `role` from the request body.
- **Impact:** Complete system compromise. Any malicious actor can create a Super Admin account without authorization.
- **Remediation:**  
  1. Restrict public self-registration roles strictly to `collegeAdmin` (for onboarding new colleges).  
  2. Disallow `superadmin` in `/register`, `/verify-otp-login`, and `/verify-phone-otp`.  
  3. Prohibit direct public registration of `faculty`, `student`, and `parent` without administrator provisioning.

---

### VULN-02: Arbitrary File Deletion / Path Traversal
- **File:** `backend/controllers/uploadController.js:64-72`, `backend/services/fileService.js:67-75`
- **Evidence:**  
  `const relativePath = fileUrl.replace(/^\/uploads\//, '');`  
  `const filePath = path.join(UPLOAD_DIR, relativePath);`  
  `await fs.promises.unlink(filePath);`  
  If `fileUrl` contains `../`, `path.join` resolves to files outside the upload directory (e.g. `package.json`, database configurations, or source code files). Any authenticated user can trigger this.
- **Impact:** Permanent loss of critical application source code, configuration, or uploaded user records.
- **Remediation:**  
  1. Resolve paths with `path.resolve` and verify `safePath.startsWith(UPLOAD_DIR)`.  
  2. Disallow path traversal characters (`..`, `%2e%2e`).  
  3. Validate user permissions before deleting files.

---

### VULN-03: Unauthenticated Real-Time Data Interception in Socket.io
- **File:** `backend/server.js:86-92`, `245-264`
- **Evidence:**  
  Socket.io server initializes without an `io.use` authentication hook. Clients can connect without a JWT and execute:
  ```javascript
  socket.on('join_user', (userId) => { socket.join(`user:${userId}`); });
  ```
  allowing any unauthenticated user to subscribe to private events destined for any user ID.
- **Impact:** Sensitive notifications, live attendance alerts, and audit updates can be intercepted in real time.
- **Remediation:**  
  1. Implement `io.use()` middleware to verify JWT tokens on connection.  
  2. Bind socket connections strictly to the authenticated `socket.user`.  
  3. Restrict `join_user` to the authenticated user's own ID (`socket.join('user:' + socket.user._id)`).

---

### VULN-04: Broken Function Level Authorization in Fee Payments (BFLA)
- **File:** `backend/routes/fee.js:50`, `backend/controllers/feeController.js:393-446`
- **Evidence:**  
  Route definition:  
  `router.post('/:id/pay', authorize('collegeAdmin', 'student', 'parent'), payFee);`  
  In `feeController.js`:  
  `payFee` handles manual offline payment recording:
  ```javascript
  fee.paidAmount = Number(fee.paidAmount || 0) + paymentAmount;
  fee.paymentMethod = paymentMethod;
  fee.receiptNo = receiptNo || `RCPT-${Date.now()}`;
  fee.status = fee.paidAmount >= fee.amount ? 'paid' : 'partial';
  await fee.save();
  ```
- **Impact:** Students or parents can forge payments and mark college fees paid without transacting funds.
- **Remediation:**  
  Restrict `router.post('/:id/pay')` strictly to `collegeAdmin`. Ensure students and parents must use Razorpay order verification (`createFeeOrder` / `verifyFeePayment`).

---

### VULN-05: Mass Assignment & Privilege Escalation in College Admin User Update
- **File:** `backend/controllers/collegeAdminController.js:418-427`
- **Evidence:**  
  ```javascript
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true }
  ).select('-password');
  ```
  `req.body` is passed unchecked into `findOneAndUpdate`, allowing the College Admin to overwrite `role` to `superadmin` or change `collegeId`.
- **Impact:** Vertical privilege escalation from College Admin to Super Admin or cross-college transfer.
- **Remediation:**  
  Filter update fields to an explicit whitelist (`name`, `phone`, `address`, `department`, `rollNo`, `semester`, `designation`, `section`, `gender`, `bloodGroup`, `dateOfBirth`). Prohibit updating `role`, `collegeId`, or `password` via this endpoint.

---

### VULN-06: IDOR / BOLA in Academic Results and Attendance Endpoints
- **File:** `backend/controllers/attendanceController.js:273, 301, 438`, `backend/controllers/examController.js:200`
- **Evidence:**  
  In `getStudentAttendanceSummary`, `getStudentCalendar`, and `getAttendanceStreak`:
  `let studentId = req.params.studentId || req.user._id;`
  In `getStudentResults`:
  `let studentId = req.params.studentId || req.user._id;`
  If `req.user.role === 'student'`, the controller accepts any `req.params.studentId` without verifying it matches `req.user._id`. If `req.user.role === 'parent'`, it does not verify that the student belongs to the parent's `children`.
- **Impact:** Unauthorized disclosure of student attendance, streaks, exam scores, SGPA, CGPA, and academic records.
- **Remediation:**  
  Enforce on the server:
  - If `req.user.role === 'student'`, force `studentId = req.user._id`.
  - If `req.user.role === 'parent'`, verify `parent.children.includes(studentId)`.

---

### VULN-07: Confidential Grievance & Anonymous Whistleblower Data Exposure
- **File:** `backend/controllers/grievanceController.js:44-67`
- **Evidence:**  
  `getGrievanceById` allows any student in the college to read any grievance by `_id`. Furthermore, the query always populates `raisedBy: name role email`, exposing the identity of students who filed complaints with `isAnonymous: true`.
- **Impact:** Retaliation risk, breach of student privacy, leak of confidential disciplinary or harassment investigations.
- **Remediation:**  
  1. Restrict student access so students can only view grievances they raised (`String(grievance.raisedBy) === String(req.user._id)`).  
  2. If `grievance.isAnonymous === true` and the viewer is not a Super Admin, redact `raisedBy` details entirely.

---

### VULN-08: Broken Object Authorization in Faculty Assignment Management
- **File:** `backend/controllers/assignmentController.js:461, 523, 561`
- **Evidence:**  
  In `updateAssignment`, `deleteAssignment`, and `gradeSubmission`, the queries only check `{ collegeId: req.user.collegeId }`. Any faculty member can alter, delete, or grade another faculty member's assignments.
- **Impact:** Unauthorized tampering with coursework, deadlines, grades, and academic records.
- **Remediation:**  
  Verify that `req.user.role === 'collegeAdmin'` OR `String(assignment.facultyId) === String(req.user._id)`.

---

### VULN-09: Tenant Isolation Bypass in `sameCollege` RBAC Middleware
- **File:** `backend/middleware/rbac.js:17-29`
- **Evidence:**  
  `sameCollege` only verifies `collegeIdParam` if it is present. When absent, it calls `next()` unconditionally, relying on controllers to manually filter by `collegeId`.
- **Impact:** Potential cross-tenant data leakage if a controller forgets to enforce `collegeId` in queries.
- **Remediation:**  
  Strengthen `sameCollege` and attach `req.collegeFilter = { collegeId: req.user.collegeId }` for non-superadmin users.

---

### VULN-10: Missing NoSQL MongoDB Operator Injection Sanitization
- **File:** `backend/middleware/sanitize.js:1-32`
- **Evidence:**  
  Input sanitization strips HTML tags via regex, but permits MongoDB query operators such as `$gt`, `$ne`, `$where`, and `$regex` inside JSON keys.
- **Impact:** Potential authentication bypass or unexpected data extraction via NoSQL operator injection in unvalidated query objects.
- **Remediation:**  
  Implement recursive key sanitization that strips or rejects any keys starting with `$` or containing `.`.

---

### VULN-11: Sensitive Token Exposure in Query Parameters & Missing Server Logout
- **File:** `backend/middleware/auth.js:12-14`, `backend/routes/auth.js`
- **Evidence:**  
  `auth.js` checks `req.query.token`, encouraging token transmission in URLs. Tokens lack invalidation hooks, and there is no server-side `logout` route.
- **Impact:** Token leakage in server access logs and browser history; inability to revoke tokens.
- **Remediation:**  
  1. Remove query parameter authentication or strictly isolate it to authorized media downloads.  
  2. Implement `POST /api/auth/logout`.  
  3. Add `tokenVersion` to `User` model to invalidate all sessions on logout or password change.

---

### VULN-12: Plaintext Reset Token Storage & Missing Rate Limits on Auth Endpoints
- **File:** `backend/controllers/authController.js:305`, `backend/routes/auth.js:31-33`
- **Evidence:**  
  `user.resetPasswordToken` stores plaintext tokens. `/forgot-password`, `/reset-password/:token`, and `/refresh-token` lack rate limiting. `/forgot-password` returns 404 when an email is not found.
- **Impact:** Account enumeration and brute force password reset risks.
- **Remediation:**  
  1. Store SHA-256 hash of reset token in database (`crypto.createHash('sha256').update(token).digest('hex')`).  
  2. Apply `authLimiter` to password reset and token refresh routes.  
  3. Return a generic success response on `/forgot-password` regardless of email presence.

---

### VULN-13: Disabled Content Security Policy (CSP) in Helmet
- **File:** `backend/server.js:106-110`
- **Evidence:**  
  `app.use(helmet({ contentSecurityPolicy: false }))` disables browser CSP defenses.
- **Impact:** Increased risk of Cross-Site Scripting (XSS) exploiting user sessions.
- **Remediation:**  
  Configure a robust Content Security Policy supporting the frontend's legitimate CDN dependencies (Jitsi, Razorpay, Google Fonts, FontAwesome).

---

### VULN-14: Predictable Public Jitsi Meeting Room Names
- **File:** `backend/controllers/liveClassController.js:9-16`
- **Evidence:**  
  Meeting rooms are named deterministically (`VishvaErp-${code}-${date}-${time}`). External parties can guess room names on `meet.jit.si`.
- **Impact:** Unauthenticated third parties joining live online classes.
- **Remediation:**  
  Append a cryptographically secure random token (e.g. `crypto.randomBytes(12).toString('hex')`) to all generated room names.

---

### VULN-15: Known Vulnerable Dependencies
- **File:** `package.json`
- **Evidence:**  
  `npm audit` reported high/critical vulnerabilities in transitive dependencies: `proxy-addr` (IP spoofing), `xlsx` (Prototype Pollution & ReDoS), `sharp` (libheif/librsvg), `socket.io-parser`.
- **Impact:** Denial of Service and IP spoofing risks.
- **Remediation:**  
  Apply safe targeted updates to lockfiles and patch vulnerable dependency trees.

---

## 5. Remediation Roadmap

The implementation will proceed in a verified, non-destructive sequence:
1. **Authentication & Account Hardening**: Secure `/register`, add server-side `logout`, implement `tokenVersion` session invalidation, hash reset tokens, protect against account enumeration.
2. **Access Control & Multi-Tenant Isolation**: Fix fee payment BFLA, fix academic & attendance IDOR, fix grievance leaks, fix assignment BOLA, fix mass assignment in user update.
3. **API & Real-Time Security**: Authenticate Socket.io connections, sanitize NoSQL operator keys in `sanitize.js`, implement comprehensive Helmet CSP, secure file uploads against path traversal.
4. **Live Classes & Communications**: Generate cryptographically secure room identifiers.
5. **Testing & Verification**: Create automated test suite validating security controls and ensuring zero regressions in legitimate ERP workflows.
