# Vishva ERP — Security Hardening Report (Phase 2)

**Date:** 2026-11-10
**Scope:** Backend (Express + MongoDB), realtime layer, deployment configuration
**Approach:** Defensive only — code review, static analysis and controlled
verification against our own local instance. No third-party systems were
targeted, no exploitation tooling was used, and no external host was probed.

---

## 1. Executive summary

A second, deeper hardening pass was carried out on top of the controls listed
in [SECURITY_IMPLEMENTATION_REPORT.md](SECURITY_IMPLEMENTATION_REPORT.md).

The first pass fixed a set of individually-identified bugs. This pass took a
different approach: it audited the application **as an attacker would model
it** — the trust boundary between an anonymous visitor and a signed-in student,
and the trust boundary between one college and another — and then removed the
*classes* of weakness rather than the individual instances.

| Area | Before | After |
| :--- | :--- | :--- |
| Critical / High findings | 1 critical, 10 high | **0 critical, 0 high open** |
| Mass assignment sites (raw `req.body` into the DB) | 17 | **0** |
| Unescaped user-supplied MongoDB `$regex` sites | 24 | **0** |
| Prototype-pollution vectors | 1 (global) | **0** |
| Upload types that could be served back as active content | 9 | **0** |
| Publicly self-provisionable administrative roles | 3 | **0** |
| Automated security assertions | 28 | **108** |

All work is verified by three automated suites:

| Suite | Command | Result |
| :--- | :--- | :--- |
| Baseline hardening | `npm run test:security` | **73 / 73 passing** |
| Hardening regression | `npm run test:security:hardening` | **38 / 38 passing** |
| End-to-end HTTP | `npm run test:security:e2e` | **35 / 35 passing** |

---

## 2. Critical findings that were closed

### 2.1 Unauthenticated privilege escalation to `superadmin`
**File:** `backend/controllers/verificationController.js`

The multi-channel verification login (`POST /api/verification/verify-and-login`)
took the account `role` straight from the request body:

```js
role: role || 'student',   // <-- any caller could ask for "superadmin"
```

Every sibling auth path (`register`, `verifyOTPLogin`, `verifyPhoneOTP`,
`googleLogin`) already applied a role allow-list — this one endpoint did not.
An anonymous attacker could request a verification code for their own phone
number, then exchange it for a valid **superadmin JWT**.

**Fix:** the role is now server-controlled through an explicit allow-list
(`student`, `parent` only). The JWT also carries `tokenVersion`, so the new
session participates in the existing revocation mechanism.

### 2.2 Prototype pollution through the global sanitizer
**File:** `backend/middleware/sanitize.js`

`JSON.parse()` turns `{"__proto__":{...}}` into an **own** enumerable
property, so `Object.entries()` returned it and the sanitizer copied it onto a
plain object — replacing that object's prototype. Any field the application
read as if it were its own (`req.body.role`, `req.body.isActive`,
`req.body.collegeId`) could then be injected by the caller.

**Fix:** `__proto__`, `constructor` and `prototype` are dropped at every
nesting depth, alongside the existing `$`-operator and dot-key stripping.

### 2.3 Stored XSS through unrestricted file upload
**Files:** `backend/middleware/upload.js`, `backend/server.js`

The stored file extension came from the client's file name and the accepted
type from the client's `Content-Type`. A file named `payload.html` uploaded
as `text/plain` was stored as `.html` and served back by `/uploads` as
`text/html` — same-origin script, full access to the SPA's JWT.

**Fix (defence in depth):**

| Layer | Control |
| :--- | :--- |
| Storage | The extension is derived from a **server-side MIME → extension map**; the client never controls it. `text/html`, `image/svg+xml`, `application/javascript` and `text/xml` are not storable at all. |
| Content | Magic-byte verification for PNG/JPEG/GIF/WebP/PDF — an HTML payload announced as `image/png` is rejected. |
| Serving | `X-Content-Type-Options: nosniff` on every `/uploads` response, `Content-Disposition: attachment` for anything that is not an image or a PDF, and a sandboxing CSP on those responses. |
| Destination | The target sub-directory is validated against a fixed allow-list, so `subdir=../../etc` can never escape the upload root. |
| Ownership | A new `Upload` registry binds every file to its uploader, so one user can no longer delete another user's uploads. |

### 2.4 Cross-tenant data access (multi-tenant isolation)
**Files:** `backend/controllers/examController.js`, `attendanceController.js`,
`feeController.js`, `careerController.js`, `reportController.js`

Several lookups used `Model.findById(id)` with no `collegeId` constraint, so a
College-A administrator could read a College-B student's e-mail address and
phone number, or attach a fee to a student of another tenant.

**Fix:** every user-supplied identifier is now resolved through a
college-scoped query, and the student-scoped endpoints go through a single
shared resolver (`backend/utils/accessControl.js`).

---

## 3. Systemic weaknesses that were removed

### 3.1 Mass assignment (17 sites)
Passing `req.body` straight into `create()` / `findOneAndUpdate()` lets a
caller write fields the server owns — `collegeId` (cross-tenant write),
`role` (privilege escalation), `status` (forged donation settlement),
`organizer` (forged audit trail), `tokenVersion` (session-revocation bypass).

**Fix:** `backend/utils/safeUpdate.js` derives the writable field list from the
mongoose schema itself, and always re-applies the server-owned fields last:

```js
const { buildUpdate } = require('../utils/safeUpdate');

await Book.findOneAndUpdate(
  { _id: req.params.id, collegeId: req.user.collegeId },
  buildUpdate(Book, req.body),          // schema-scoped, tenant locked
  { new: true, runValidators: true }
);
```

`collegeId`, `role` and `tokenVersion` are protected by default; an endpoint
that legitimately needs to change one must opt in explicitly.

### 3.2 MongoDB regex injection / ReDoS (24 sites)
Twenty-four endpoints interpolated a raw search term into `$regex`. A term of
`.*` widened the match beyond its intent, and a catastrophic-backtracking
pattern such as `(a+)+$` could hang the event loop — a denial of service
reachable by any authenticated user.

**Fix:** `backend/utils/parseHelpers.js` gained `regexFilter()`, which escapes
every metacharacter and caps the input length. All 24 sites were migrated.

### 3.3 The "parent" role was consistently forgotten
Fifteen controllers implemented their own `if (role === 'student')` narrowing.
The `parent` branch was missing in nearly all of them, so a parent could read
**every** student's placement applications, feedback records, fee ledger and
mentorship sessions.

**Fix:** `backend/utils/accessControl.js` centralises the rules:

| Role | May read |
| :--- | :--- |
| `student` | only their own records |
| `parent` | only records belonging to their linked children |
| `faculty` | any student within their own college |
| `collegeAdmin` | any student within their own college |
| `superadmin` | cross-tenant (intentional) |

### 3.4 Missing authorization on privileged endpoints
Fifteen routes had **no** role restriction at all, exposing institutional
data or physical-access operations to any signed-in account:

| Endpoint | Was readable by | Now |
| :--- | :--- | :--- |
| `GET /api/visitors` | any role (full visitor register: names, phones, vehicle numbers, security notes) | staff |
| `POST /api/visitors/:id/checkin\|checkout\|cancel` | any role | staff |
| `GET /api/fees/summary` | any role (institution revenue + collection rate) | admins |
| `GET /api/fees/structures` | any role (pricing configuration) | staff |
| `GET /api/hostel/:id` | students (occupant roster with e-mail + phone) | staff |
| `GET /api/hostel/rooms/:id/maintenance` | students (could flip room status) | staff |
| `POST /api/campus/sensors/reading` | any role (broadcast fake campus safety alerts to every client) | staff |
| `GET /api/campus/sensors`, `/resources`, `/energy/*`, `/inventory` | any role | staff |
| `POST /api/library/return`, `/renew` | any role (could clear another user's fine and inflate the copy count) | owner / staff, with renewal cap |
| `GET /api/library/stats` | any role (fine revenue) | fine revenue admins only |
| `GET /api/placements/applications` | parents (every applicant) | own applications only |
| `GET /api/feedback` | parents (all feedback, incl. comments about faculty) | own / children only |
| `GET /api/mentorship/stats` | any role | staff |
| `GET /api/career/profile/:studentId` | any role (résumé, links, e-mail, phone) | self / parent / staff |
| `PUT /api/mentorship/sessions/:id` | any role (could rewrite any session's rating) | participant / admin |
| `POST /api/mentorship/sessions` | any role | participant / admin |
| `GET /api/assessments/:id`, `/start`, `/submit` | parents & faculty | students |

### 3.5 Ownership checks on mutating operations
These handlers verified *who* the caller was, but not *whose* record they were
acting on:

| Handler | Problem | Fix |
| :--- | :--- | :--- |
| `academicsController.gradeSubmission` | any faculty could grade another faculty member's assignment | ownership check |
| `academicsController.deleteAssignment` | any faculty could delete another faculty member's assignment **and its submissions** | ownership check |
| `libraryController.renewBook` / `returnBook` | any user could extend or clear any loan | owner-scoped query |
| `academicsController.issueBook` | a book could be issued to a cross-tenant user | borrower validated against the college |
| `feeController.createFee` | a fee could be attached to a student of another tenant | student validated against the college |
| `mentorshipController.requestMentorship` | any user id could be nominated as mentor | mentor must be active faculty of the college |
| `liveClassController.saveWhiteboard` | any faculty could edit another faculty member's whiteboard | host check |
| `logisticsController` enrolment | student id was not validated against the college | college-scoped validation |

### 3.6 Realtime (Socket.io) hardening
| Issue | Fix |
| :--- | :--- |
| The `join_room` private-room guard only ran in production | Runs in **every** environment |
| `college:<id>` and `role:<x>` rooms could be joined by any socket | The college and the role are matched against the JWT claims |
| `send_message` could broadcast to any room id | The sender must already have joined the room |
| Anonymous sockets were accepted in production | A valid token is now required |
| No payload size cap | `maxHttpBufferSize` limited to 1 MB |

---

## 4. Application-level hardening

### 4.1 Password policy
Registration accepted 6-character passwords and password *reset* accepted
anything ≥ 6 characters — an attacker who hijacked a reset link could set a
trivially guessable password. A single policy is now applied at registration,
password change **and** password reset:

> minimum 8 characters, with at least one uppercase letter, one lowercase
> letter, one digit and one special character (`@$!%*?&`)

The existing seeded credentials (`Admin@123`, `Faculty@123`, `Student@123`,
`Parent@123`, `SuperAdmin@123`) all satisfy the policy, so no user is locked
out.

### 4.2 JWT signing secrets
`JWT_SECRET` was only checked for *presence* in production. The server now
also refuses to start when the secret is shorter than 32 characters or still
looks like a placeholder, and `JWT_REFRESH_SECRET` becomes mandatory in
production instead of silently deriving itself from the access secret.

### 4.3 CORS fail-closed
The CORS callback allowed **any** origin whenever `FRONTEND_URL` was unset
(which is exactly the misconfiguration that would ship). In production the
allow-list is now mandatory: an unset list rejects every cross-origin request
and logs an explicit error.

### 4.4 CSV formula injection
Uploaded CSV files could contain `=cmd|'/c calc'!A1`, which executes when a
staff member opens the file in Excel. Uploads are now rewritten with an
RFC4180-aware parser that neutralises `=`, `+`, `-`, `@`, TAB and CR cell
prefixes **while preserving the original column structure**.

### 4.5 Spreadsheet / LLM import hardening
- The parser is chosen from a **server-side** extension/MIME allow-list, not
  from whatever the client claims.
- Row count is capped (20 000) so a hostile workbook cannot exhaust memory.
- Imported questions are capped (500) and the base64 image payload is capped
  (8 MB).
- LLM- and spreadsheet-produced text is stripped of markup before it is
  persisted, so imported content can never become stored XSS.

### 4.6 AI prompt injection
User text was interpolated into prompts with no delimiters. All user content
is now fenced inside explicit `<UNTRUSTED_*>` markers, the system prompt
states that the fenced content is data and never instructions, and the
internal college identifier is no longer disclosed to the model.

### 4.7 Information disclosure
| Endpoint | Was | Now |
| :--- | :--- | :--- |
| `GET /api/health` | Node version, memory usage, uptime, DB details | minimal status only |
| `GET /api/health/deep` | public | admins only |
| `GET /api/public/live-overview` | institution revenue + collection rate, internal notice **content**, Node version, raw `error.message` | financial aggregates masked unless `PUBLIC_EXPOSE_FINANCIAL_METRICS=true`, notice titles only, no runtime details, no internal error text |
| `GET /api/super-admin/database/collection/:c` | raw documents including **bcrypt password hashes** and **live OTP codes** | sensitive fields redacted |

### 4.8 Security headers
The production CSP gained `frameAncestors` (clickjacking defence at the CSP
layer), `formAction` (form-hijacking defence), `workerSrc`, `mediaSrc`,
`manifestSrc` and `upgrade-insecure-requests`. HSTS is now enabled in
production with `includeSubDomains` and `preload`.

### 4.9 Rate limiting
The verification endpoints (`/send`, `/check`, `/verify-and-login`,
`/attempts`) are now covered by the auth limiter, and the public
`google-origin-check` endpoint caches its probe result for 10 minutes so it
can no longer be used as a request amplifier against Google.

### 4.10 Secret generation without a third party
Rotating a signing secret requires generating a high-entropy value. Doing that
on an external website means running that site's JavaScript on a machine that
handles production credentials — if the site (or a CDN it pulls from) is ever
compromised, the "random" value can be copied elsewhere silently.

Two offline generators are provided instead:

| Tool | Where | Notes |
| :--- | :--- | :--- |
| `npm run secrets:generate` | `scripts/generate-secrets.js` | Uses Node's `crypto.randomBytes` (OS CSPRNG). `--write` stores the values straight into `.env`. |
| **Security Secret Generator** | Super Admin → System | Uses the browser's `crypto.getRandomValues()` with rejection sampling for a uniform distribution. Standard (alphanumeric) and Enhanced (special characters) modes, 128–512 bit presets, honest entropy labelling, one-click copy. |

Neither generator ever reads the *running* secret from the server — the API
never sends a signing secret to a browser, and the page never asks for one.
Only a fresh candidate is produced client-side, for the operator to paste into
the deployment environment.

The in-app generator deliberately excludes `#`, `$`, quotes, backslash and
whitespace from its special-character set, because those characters break
`.env` parsing and shell/JSON interpolation.

### 4.11 Parity between the local and the online deployment
The application is served by **Vercel** (static frontend) in front of
**Render** (API) in production, but from a single Express process locally.
That means the security headers of the two environments could silently drift
apart. They are now identical and enforced by tests:

| Control | Local (Express) | Local (Apache) | Online (Vercel + Render) |
| :--- | :--- | :--- | :--- |
| Content-Security-Policy | Helmet, production mode | `frontend/.htaccess` | `frontend/vercel.json` |
| `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` | Helmet | `.htaccess` | `vercel.json` |
| `Strict-Transport-Security` | Helmet, production mode | `.htaccess` | `vercel.json` |
| CORS allow-list | `backend/server.js` | — | same file |

Before this pass the **Vercel deployment had no Content-Security-Policy at
all** — Vercel does not read `.htaccess`, so the policy that protects the
Apache host simply did not exist on the live site. The Vercel and Apache
policies are now byte-identical and a test asserts they stay that way.

`render.yaml` also gained `JWT_REFRESH_SECRET` (with `generateValue: true`).
Without it the API would refuse to boot in production after this deploy.

---

## 5. Defects found *during* the verification of this pass

These were introduced or exposed while hardening and were caught by the
regression suites before they could ship:

| Defect | Impact | Fix |
| :--- | :--- | :--- |
| The upload URL was rebuilt from the request after the file had been written, so a multipart body that put `subdir` **after** the file part produced a URL pointing at a file that did not exist (and a file sitting in the wrong directory) | Broken uploads / silent data misplacement | The sub-directory is resolved **once** by the upload middleware and remembered on the file object; the controller builds the URL from that exact value |
| The schema-driven write helper only understood top-level schema paths, so a nested object literal (`currentLocation: { lat, lng }` on `TransportRoute`) was silently dropped | Silent data loss on transport-route updates | Nested roots are now collected from the dotted schema paths; a regression test asserts that **no** schema field is ever dropped |
| A parent account created for a student received a password derived from `Date.now()` | The password was guessable from the account creation time | Cryptographically random (`crypto.randomBytes`) |
| Bulk user import gave every imported account the same password (`Welcome@123`) | One leaked password compromised an entire import | Every imported account gets its own random password, returned to the administrator once |
| A campus notice could be addressed to an arbitrary role, including `superadmin` | A college administrator could push a notice into the platform admin room | The target-role list is a server-side allow-list |
| The super-admin System page called `api.request('/api/health/deep')`, but `api.request()` already prepends `/api` | The request went to `/api/api/health/deep` and 404'd — the deep-diagnostics drawer was silently broken | The doubled prefix was removed; a frontend test now asserts no `api.request()` path carries the prefix |
| The strength meter on the secret generator set the HTML `width` attribute instead of the CSS property | The bar never rendered | `style.width` is used instead |
| `live-admin-pages.js` / `live-pages.js` called a bare `getToken()` that only exists as `api.getToken()` | The realtime socket never connected on the college-admin and student live pages | Both call sites corrected |
| `iot-dashboard.html` called `renderBuildingList()`, a function that no longer exists | The IoT dashboard threw on load and the rest of the panel never rendered | The stale call was removed — `renderBuildingPreviews()` already renders both the preview and the full list |
| The CSV neutraliser dropped the original quoting, which shifted every following column | Corrupted spreadsheet imports | RFC4180-aware parser that preserves the original structure |
| `pickSubdir` re-resolved the target directory, so a traversal attempt could be reported as a valid path | Misleading URL | The directory is resolved once and validated against a fixed allow-list |

---

## 6. New modules

| File | Purpose |
| :--- | :--- |
| `backend/utils/accessControl.js` | Centralised student-visibility rules (student / parent / faculty / admin / superadmin). |
| `backend/utils/safeUpdate.js` | Schema-aware payload filtering — kills the mass-assignment class. |
| `backend/models/Upload.js` | Ownership registry for uploaded files. |
| `backend/utils/parseHelpers.js` | `regexFilter()` / `anchoredRegexFilter()` — safe MongoDB pattern building. |
| `tests/security_hardening.test.js` | 38 regression assertions for the controls above. |
| `tests/security_e2e.test.js` | 35 end-to-end HTTP assertions against a local instance. |
| `scripts/generate-secrets.js` | Offline CSPRNG secret generator (`npm run secrets:generate`). |

---

## 7. Verification

```bash
npm run test:security          # baseline + hardening regression  (66 / 66)
npm run test:security:hardening  # hardening regression only       (38 / 38)
npm run test:security:e2e      # end-to-end HTTP (needs a running, seeded API)
```

The end-to-end suite signs in as every role and asserts the boundaries from
the outside — that a student cannot read the visitor register, the fee
summary, the hostel roster or another student's results; that a parent only
ever sees their own children; that faculty cannot download a student fee
receipt; that a spoofed image upload is rejected while a genuine one is
stored under a server-derived extension; that a CSV upload has its spreadsheet
formulas neutralised on disk; that one user cannot delete another user's
upload; that logout revokes the token; and that a query-string token cannot be
used on a mutating endpoint.

---

## 8. Deployment checklist

> **Before the first production deploy of this build**, set `JWT_REFRESH_SECRET`
> in the deployment environment. The server now refuses to start in production
> without it (deriving it from `JWT_SECRET` would mean that compromising the
> access secret also compromises every refresh token).

- [ ] `JWT_SECRET` — ≥ 32 characters, random, unique to this deployment
      (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- [ ] `JWT_REFRESH_SECRET` — set explicitly, different from `JWT_SECRET`
- [ ] `FRONTEND_URL` — set (CORS fails closed without it)
- [ ] `SUPER_ADMIN_PASSWORD` — rotated to a strong value
- [ ] `PUBLIC_EXPOSE_FINANCIAL_METRICS` — left unset unless the institution
      deliberately publishes revenue figures
- [ ] `NODE_ENV=production` (enables the strict CSP, HSTS and the
      production-only secret checks)
- [ ] `npm run test:security` — green
- [ ] `npm run test:security:e2e` — green against a staging instance
