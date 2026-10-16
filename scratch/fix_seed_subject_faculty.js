/** One-off: attach the seeded Subject to the seeded faculty (faculty-scoped subject list). */
const path = require('path');
const mongoose = require('mongoose');
const ROOT = path.resolve(__dirname, '..');
const Subject = require(path.join(ROOT, 'backend/models/Subject'));

const DB = process.env.SMOKE_MONGO_URI || 'mongodb://localhost:27017/vishvaerp_smoketest';
const FACULTY_ID = '6ad1abe91131f3c4dd860927';

(async () => {
  await mongoose.connect(DB);
  const r = await Subject.updateMany({ facultyId: { $exists: false } }, { $set: { facultyId: FACULTY_ID } });
  console.log('subjects patched:', r.modifiedCount);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
