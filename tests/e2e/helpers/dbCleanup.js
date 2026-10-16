/**
 * Shared DB cleanup for the Playwright smoke suite.
 *
 * The QA suite creates its own tenant (college code `QAC<stamp>`, users with
 * `qa.*@example.com` emails). `cleanupQaData()` removes every record belonging
 * to those tenants so the suite can run repeatedly against the same database.
 *
 * The suite has no dedicated `.env`, so this uses the same MONGO_URI the
 * backend uses (falling back to the local dev database).
 */
const mongoose = require('mongoose');

const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://localhost:27017/vishvaerp';

// Emails created by erp-smoke.spec.js (see `state` in that file).
const QA_EMAIL_RE = /^qa\.(admin|student|faculty|parent)\.\d+@example\.com$/;
// Colleges created by the suite: code `QAC######`.
const QA_COLLEGE_CODE_RE = /^QAC\d+$/;

let connected = false;

async function connect() {
  if (mongoose.connection.readyState === 1) return mongoose.connection.db;
  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
    return mongoose.connection.db;
  }
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  connected = true;
  return mongoose.connection.db;
}

/**
 * Delete all QA-suite data. Safe to call multiple times (beforeAll/afterAll).
 * Never touches records that don't belong to a QA tenant.
 */
async function cleanupQaData() {
  try {
    const db = await connect();

    // 1. Locate the QA tenant(s).
    const colleges = await db
      .collection('colleges')
      .find({ code: QA_COLLEGE_CODE_RE })
      .project({ _id: 1 })
      .toArray();
    const collegeIds = colleges.map((c) => c._id);

    // 2. Locate QA users (they also carry the tenant id, but match by email
    //    first so orphaned users from an interrupted run are cleaned too).
    const qaUsers = await db
      .collection('users')
      .find({ email: QA_EMAIL_RE })
      .project({ _id: 1, collegeId: 1 })
      .toArray();
    qaUsers.forEach((u) => {
      if (u.collegeId && !collegeIds.some((id) => String(id) === String(u.collegeId))) {
        collegeIds.push(u.collegeId);
      }
    });

    // 3. Wipe every collection scoped to those tenants. A $in match on a
    //    collection without a collegeId field simply matches nothing, so this
    //    is safe to run across all collections.
    if (collegeIds.length) {
      const collections = await db.listCollections().toArray();
      for (const { name } of collections) {
        if (name.startsWith('system.')) continue;
        await db.collection(name).deleteMany({ collegeId: { $in: collegeIds } });
      }
    }

    // 4. Remove the QA users + tenant itself (and any orphaned QA users).
    await db.collection('users').deleteMany({ email: QA_EMAIL_RE });
    await db.collection('colleges').deleteMany({ code: QA_COLLEGE_CODE_RE });

    // 5. QA-only side data keyed by roll number / transaction id / titles.
    await db.collection('students').deleteMany({ rollNo: { $regex: /^QA\d+$/ } });
    await db.collection('attendance').deleteMany({ rollNo: { $regex: /^QA\d+$/ } });
    await db.collection('results').deleteMany({ rollNo: { $regex: /^QA\d+$/ } });
    await db.collection('fees').deleteMany({ rollNo: { $regex: /^QA\d+$/ } });
  } catch (error) {
    // Never fail the suite because of cleanup — surface it loudly instead.
    console.warn('[dbCleanup] cleanup failed:', error.message);
  }
}

/** Close the mongoose connection opened by this helper. */
async function closeDb() {
  try {
    if (connected && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      connected = false;
    }
  } catch (error) {
    console.warn('[dbCleanup] disconnect failed:', error.message);
  }
}

module.exports = { cleanupQaData, closeDb };
