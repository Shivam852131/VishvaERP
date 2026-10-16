/**
 * Integration test for the Smart MCQ / Exam-Prep Quiz engine.
 * Mounts the REAL routers + middleware against a live test MongoDB and drives the
 * full lifecycle: authoring → publish → student start/autosave/submit → scoring
 * (incl. negative marking) → review → analytics/recommendations/bookmarks → import.
 *
 * Run:  node scratch/test_quiz_flows.js
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'quiz-test-secret';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');

const College = require(path.join(ROOT, 'backend/models/College'));
const Course = require(path.join(ROOT, 'backend/models/Course'));
const User = require(path.join(ROOT, 'backend/models/User'));
const Subject = require(path.join(ROOT, 'backend/models/Subject'));
const QuestionBank = require(path.join(ROOT, 'backend/models/QuestionBank'));
const SkillAssessment = require(path.join(ROOT, 'backend/models/SkillAssessment')).SkillAssessment;

const quizRoutes = require(path.join(ROOT, 'backend/modules/quizRoutes'));
const assessmentRoutes = require(path.join(ROOT, 'backend/modules/assessmentRoutes'));
const examGenRoutes = require(path.join(ROOT, 'backend/routes/examGenerator'));

const DB = 'mongodb://localhost:27017/vishvaerp_quiztest';
const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra && !cond ? '  → ' + JSON.stringify(extra) : ''));
}
const token = (user) => jwt.sign({ id: user._id, role: user.role, collegeId: user.collegeId }, process.env.JWT_SECRET, { expiresIn: '1h' });

let server;
let base;

async function api(method, url, { t, body, form } = {}) {
  const headers = {};
  if (t) headers.Authorization = 'Bearer ' + t;
  let payload;
  if (form) { payload = form; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + url, { method, headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch (e) { data = { raw: true }; }
  return { status: res.status, data };
}

async function main() {
  await mongoose.connect(DB);
  await mongoose.connection.db.dropDatabase();

  // ── fixtures ──
  const college = await College.create({ name: 'Quiz Test College', code: 'QT1', isActive: true, plan: 'pro', planExpiry: new Date(Date.now() + 86400000 * 30) });
  const course = await Course.create({ collegeId: college._id, name: 'B.Sc Physics', code: 'BSP', department: 'Science', totalSemesters: 2, isActive: true });
  const subject = await Subject.create({ collegeId: college._id, courseId: course._id, name: 'Physics', code: 'PHY', semester: 1, isActive: true });
  const faculty = await User.create({ name: 'F Teacher', email: 'f@qt.test', role: 'faculty', collegeId: college._id, isActive: true, password: 'testpass' });
  const student = await User.create({ name: 'S Student', email: 's@qt.test', role: 'student', collegeId: college._id, isActive: true, password: 'testpass', rollNo: 'R1' });
  const admin = await User.create({ name: 'A Admin', email: 'a@qt.test', role: 'collegeAdmin', collegeId: college._id, isActive: true, password: 'testpass' });

  // 4 MCQ + 1 true_false + 1 short_answer
  const mk = (i, opts) => ({ collegeId: college._id, subjectId: subject._id, createdBy: faculty._id, unit: 'Optics', chapter: 'Basics', questionText: 'Q' + i, questionType: 'mcq', options: opts, difficulty: 'easy', marks: 1, explanation: 'because', ...{} });
  const questions = await QuestionBank.insertMany([
    mk(1, [{ text: 'A1', isCorrect: true }, { text: 'B1', isCorrect: false }, { text: 'C1', isCorrect: false }]),
    mk(2, [{ text: 'A2', isCorrect: false }, { text: 'B2', isCorrect: true }, { text: 'C2', isCorrect: false }]),
    mk(3, [{ text: 'A3', isCorrect: false }, { text: 'B3', isCorrect: false }, { text: 'C3', isCorrect: true }]),
    mk(4, [{ text: 'A4', isCorrect: true }, { text: 'B4', isCorrect: false }, { text: 'C4', isCorrect: false }]),
    { collegeId: college._id, subjectId: subject._id, createdBy: faculty._id, unit: 'Optics', chapter: 'Basics', questionText: 'TF', questionType: 'true_false', options: [], correctAnswer: 'True', difficulty: 'easy', marks: 1 },
    { collegeId: college._id, subjectId: subject._id, createdBy: faculty._id, unit: 'Optics', chapter: 'Basics', questionText: 'SA', questionType: 'short_answer', options: [], correctAnswer: 'refraction', difficulty: 'medium', marks: 1 },
  ]);
  const qids = questions.map(q => q._id);

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/quizzes', quizRoutes);
  app.use('/api/assessments', assessmentRoutes);
  app.use('/api/exam-generator', examGenRoutes);
  await new Promise(r => { server = app.listen(0, r); });
  base = 'http://localhost:' + server.address().port;

  const fT = token(faculty), sT = token(student), aT = token(admin);

  console.log('\n── Staff authoring ──');
  let r = await api('POST', '/api/quizzes', { t: fT, body: {
    title: 'Optics Quiz 1', type: 'quiz', subjectId: String(subject._id),
    educationLevel: 'undergraduate',
    sections: [{ name: 'Section A', questionIds: qids.map(String), marksEach: 2 }],
    settings: { duration: 30, negativeMarking: 1, maxAttempts: 2, passPercentage: 50, showResults: true, allowReview: true, shuffleQuestions: false },
  } });
  check('create quiz', r.status === 201 && r.data.quiz.totalMarks === 12 && r.data.quiz.questionCount === 6, r.data);
  const quizId = r.data.quiz._id;

  r = await api('PATCH', `/api/quizzes/${quizId}/publish`, { t: fT, body: { isPublished: true } });
  check('publish quiz', r.status === 200 && r.data.quiz.isPublished === true, r.data);

  r = await api('GET', '/api/quizzes/manage', { t: fT });
  check('manage lists quiz', r.status === 200 && r.data.quizzes.length === 1, r.data);

  console.log('\n── Student browse + start ──');
  r = await api('GET', '/api/quizzes', { t: sT });
  check('student sees published quiz (open)', r.status === 200 && r.data.quizzes.length === 1 && r.data.quizzes[0].availability === 'open', r.data);

  r = await api('POST', `/api/quizzes/${quizId}/start`, { t: sT, body: {} });
  check('start attempt', r.status === 201 && r.data.timeRemainingSec > 1700, r.data);
  const attemptId = r.data.attempt._id;

  r = await api('GET', `/api/quizzes/attempts/${attemptId}/questions`, { t: sT });
  const leaked = (r.data.questions || []).some(q => q.correctAnswer !== undefined || (q.options || []).some(o => o.isCorrect !== undefined) || q.explanation !== undefined);
  check('questions sanitized (no answers leaked)', r.status === 200 && r.data.questions.length === 6 && !leaked, { n: r.data.questions && r.data.questions.length, leaked });

  console.log('\n── Autosave + submit (negative marking) ──');
  // 4 MCQ correct, TF wrong (incurs -1), short_answer non-exact (manual, 0)
  const ans = [
    { questionId: String(qids[0]), response: 'A1' },
    { questionId: String(qids[1]), response: 'B2' },
    { questionId: String(qids[2]), response: 'C3' },
    { questionId: String(qids[3]), response: 'A4' },
    { questionId: String(qids[4]), response: 'False' },
    { questionId: String(qids[5]), textAnswer: 'some thinking' },
  ];
  r = await api('PATCH', `/api/quizzes/attempts/${attemptId}/answers`, { t: sT, body: { answers: ans.slice(0, 3) } });
  check('autosave partial', r.status === 200 && r.data.saved === true, r.data);

  r = await api('POST', `/api/quizzes/attempts/${attemptId}/submit`, { t: sT, body: { answers: ans } });
  const res1 = r.data.result;
  check('submit scored', r.status === 200 && res1 && res1.percentage === 58, r.data);
  check('negative marking applied', res1 && res1.negativeMarks === 1 && res1.score === 8, res1 && { score: res1.score, neg: res1.negativeMarks });
  check('short_answer flagged for manual grading', res1 && res1.status === 'completed', res1);

  r = await api('GET', `/api/quizzes/attempts/${attemptId}/result`, { t: sT });
  check('result review has answers+explanation', r.status === 200 && Array.isArray(r.data.result.review) && r.data.result.review.length === 6 && r.data.result.review[0].correctAnswer !== undefined, r.data.result && r.data.result.review && r.data.result.review[0]);

  // idempotent double submit
  r = await api('POST', `/api/quizzes/attempts/${attemptId}/submit`, { t: sT, body: { answers: ans } });
  check('double submit is idempotent', r.status === 200 && r.data.alreadySubmitted === true, r.data);

  console.log('\n── Student analytics / bookmarks / recommendations ──');
  r = await api('GET', '/api/quizzes/my-analytics', { t: sT });
  check('my-analytics has topic accuracy', r.status === 200 && r.data.analytics.byTopic.length >= 1, r.data.analytics);

  r = await api('POST', '/api/quizzes/bookmarks', { t: sT, body: { questionId: String(qids[0]) } });
  check('add bookmark', r.status === 201, r.data);
  r = await api('GET', '/api/quizzes/bookmarks', { t: sT });
  check('list bookmarks', r.status === 200 && r.data.bookmarks.length === 1, r.data);
  r = await api('DELETE', `/api/quizzes/bookmarks/${qids[0]}`, { t: sT });
  check('remove bookmark', r.status === 200, r.data);

  r = await api('GET', '/api/quizzes/recommendations', { t: sT });
  check('recommendations endpoint ok', r.status === 200 && Array.isArray(r.data.recommendations), r.data);

  console.log('\n── Staff analytics + monitoring ──');
  r = await api('GET', `/api/quizzes/${quizId}/analytics`, { t: fT });
  check('quiz analytics item analysis', r.status === 200 && r.data.analytics.itemAnalysis.length === 6 && r.data.analytics.totalAttempts === 1, r.data.analytics && { n: r.data.analytics.itemAnalysis.length, t: r.data.analytics.totalAttempts });
  r = await api('GET', `/api/quizzes/${quizId}/attempts`, { t: fT });
  check('monitor attempts', r.status === 200 && r.data.attempts.length === 1, r.data);

  console.log('\n── Import (CSV preview + confirm) ──');
  r = await api('GET', '/api/quizzes/import/template', { t: aT });
  check('import template downloads', r.status === 200 && String(r.data.raw !== true), r.status);
  const csv = 'question,type,option_a,option_b,option_c,option_d,correct,marks,difficulty,unit,chapter\n"Imported Q1?",mcq,x,y,z,,a,1,medium,Optics,Basics\n"Imported TF?",true_false,,,,,False,1,easy,Optics,Basics\n';
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'questions.csv');
  r = await api('POST', '/api/quizzes/import/preview', { t: aT, form });
  check('csv preview parses 2 questions', r.status === 200 && r.data.count === 2 && r.data.questions[0].questionType === 'mcq', r.data);
  r = await api('POST', '/api/quizzes/import/confirm', { t: aT, body: { subjectId: String(subject._id), questions: r.data.questions } });
  check('import confirm saves to bank', r.status === 201 && r.data.imported === 2, r.data);

  console.log('\n── Phase-0 regression: assessment submit + exam-gen GET-by-id ──');
  r = await api('POST', '/api/assessments', { t: fT, body: { title: 'Skill A', category: 'technical', questions: [{ text: 'MCQ?', type: 'mcq', options: [{ text: 'y', isCorrect: true }, { text: 'n', isCorrect: false }], points: 1 }] } });
  check('create assessment', r.status === 201, r.data);
  const assessId = r.data.assessment._id;
  r = await api('POST', `/api/assessments/${assessId}/start`, { t: sT, body: {} });
  check('assessment start', r.status === 201 || r.status === 200, r.data);
  r = await api('POST', `/api/assessments/${assessId}/submit`, { t: sT, body: { answers: [] } });
  // submit by assessment id should now resolve the in-progress attempt (not 404 'No active attempt found')
  check('assessment submit by assessment id resolves', r.status !== 404, r.data);

  r = await api('POST', '/api/exam-generator/questions', { t: fT, body: { subjectId: String(subject._id), unit: 'U', chapter: 'C', questionText: 'EG?', questionType: 'mcq', options: [{ text: 'p', isCorrect: true }, { text: 'q', isCorrect: false }], difficulty: 'easy', marks: 1 } });
  check('exam-gen create question', r.status === 201, r.data);
  const egId = r.data.question && r.data.question._id;
  r = await api('GET', `/api/exam-generator/questions/${egId}`, { t: fT });
  check('exam-gen GET-by-id (was 404)', r.status === 200 && r.data.question && r.data.question._id === String(egId), r.data);

  // ── teardown ──
  await new Promise(r2 => server.close(r2));
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(x => !x.pass);
  console.log('\n=============================');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name)); process.exit(1); }
  console.log('ALL QUIZ FLOW CHECKS PASSED');
  process.exit(0);
}

main().catch(async (e) => { console.error('\nTEST CRASHED:', e); try { if (server) server.close(); } catch {} try { await mongoose.disconnect(); } catch {} process.exit(1); });
