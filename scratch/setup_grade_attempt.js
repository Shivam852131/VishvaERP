/* Creates a fresh attempt on the Smoke Quiz that answers the short_answer
   question with non-exact text → attempt.needsManualGrading = true, so the
   faculty quiz-builder manual grading UI has something to grade.
   Usage: node scratch/setup_grade_attempt.js  (server on 5099, smoketest DB) */
const BASE = 'http://localhost:5099/api/quizzes';

async function j(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const m = require('mongoose');

(async () => {
  // 0. ensure the smoke quiz allows another attempt (smoke-test data caps at 2)
  await m.connect('mongodb://localhost:27017/vishvaerp_smoketest');
  await m.connection.db.collection('quizzes').updateMany({}, { $set: { 'settings.maxAttempts': 5 } });
  console.log('maxAttempts raised to 5');

  // 1. login student
  let r = await j('POST', 'http://localhost:5099/api/v1/auth/login', null, {
    email: 'stu@smoke.test', password: 'testpass',
  });
  if (r.status !== 200) { console.error('login failed', r.status, r.data); process.exit(1); }
  const sT = r.data.token;
  console.log('student logged in');

  // 2. find the Smoke Quiz
  r = await j('GET', BASE, sT);
  const quiz = (r.data.quizzes || []).find(q => (q.title || '').includes('Smoke Quiz'));
  if (!quiz) { console.error('quiz not found', r.data); process.exit(1); }
  console.log('quiz:', quiz._id, quiz.title, '| availability:', quiz.availability);

  // 3. start attempt
  r = await j('POST', `${BASE}/${quiz._id}/start`, sT, {});
  if (r.status !== 201 && r.status !== 200) { console.error('start failed', r.status, r.data); process.exit(1); }
  const attemptId = r.data.attempt._id;
  console.log('attempt started:', attemptId);

  // 4. fetch sanitized questions and answer everything; short_answer gets
  //    deliberately non-exact text so it is flagged for manual grading
  r = await j('GET', `${BASE}/attempts/${attemptId}/questions`, sT);
  const qs = r.data.questions || [];
  const answers = qs.map(q => {
    if (q.questionType === 'short_answer' || q.questionType === 'long_answer') {
      return { questionId: String(q._id), textAnswer: 'Displacement divided by the time interval taken.' };
    }
    if (q.questionType === 'true_false') return { questionId: String(q._id), response: 'True' };
    if (q.questionType === 'mcq') return { questionId: String(q._id), response: (q.options && q.options[0] && q.options[0].text) || 'A' };
    return { questionId: String(q._id), response: '42' };
  });
  console.log('answering', answers.length, 'questions');

  // 5. submit
  r = await j('POST', `${BASE}/attempts/${attemptId}/submit`, sT, { answers });
  if (r.status !== 200) { console.error('submit failed', r.status, r.data); process.exit(1); }
  console.log('submitted | score:', r.data.result && r.data.result.score, '/', r.data.result && r.data.result.totalMarks);

  // 6. verify the flag
  const doc = await m.connection.db.collection('quizattempts').findOne({ _id: new m.Types.ObjectId(attemptId) });
  console.log('DB check → needsManualGrading:', doc && doc.needsManualGrading, '| status:', doc && doc.status, '| score:', doc && doc.score, '/', doc && doc.totalMarks);
  await m.disconnect();
  process.exit(doc && doc.needsManualGrading === true ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
