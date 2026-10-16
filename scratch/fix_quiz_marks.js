/** One-off repair: restore the seeded quiz's section marksEach (corrupted to 1 by an add-question call that forced marksEach:1). */
const path = require('path');
const mongoose = require('mongoose');
const ROOT = path.resolve(__dirname, '..');
const Quiz = require(path.join(ROOT, 'backend/models/Quiz'));

const DB = process.env.SMOKE_MONGO_URI || 'mongodb://localhost:27017/vishvaerp_smoketest';
const QUIZ_ID = '6ad1abec1131f3c4dd860944';

(async () => {
  await mongoose.connect(DB);
  const quiz = await Quiz.findById(QUIZ_ID);
  if (!quiz) throw new Error('quiz not found');
  (quiz.sections || []).forEach((s) => { s.marksEach = 2; });
  quiz.recomputeTotals();
  await quiz.save();
  console.log('restored:', { totalMarks: quiz.totalMarks, questionCount: quiz.questionCount, marksEach: quiz.sections.map(s => s.marksEach) });
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
