const asyncHandler = require('../middleware/asyncHandler');
const mongoose = require('mongoose');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const QuestionBank = require('../models/QuestionBank');
const QuestionBookmark = require('../models/QuestionBookmark');
const PlatformSetting = require('../models/PlatformSetting');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

const DEFAULT_TAXONOMY = {
  educationLevels: ['school', 'undergraduate', 'postgraduate', 'competitive'],
  boards: ['CBSE', 'ICSE', 'State Board', 'IB', 'Other'],
  competitiveExams: ['JEE', 'NEET', 'UPSC', 'GATE', 'CAT', 'SSC', 'Other'],
};

const ROLES_STAFF = ['collegeAdmin', 'faculty', 'superadmin'];

/* ───────────────────────── helpers ───────────────────────── */

// Build questionId → section marks map.
function marksMap(quiz) {
  const map = {};
  (quiz.sections || []).forEach(s => {
    (s.questionIds || []).forEach(qid => { map[String(qid)] = s.marksEach || 1; });
  });
  return map;
}

// Merge incoming autosaved answers into existing (by questionId); incoming wins.
function upsertAnswers(existingArr, incomingArr) {
  const map = new Map();
  (existingArr || []).forEach(a => {
    const o = a && a.toObject ? a.toObject() : { ...a };
    if (o && o.questionId != null) map.set(String(o.questionId), o);
  });
  (incomingArr || []).forEach(a => {
    if (!a || a.questionId == null) return;
    const key = String(a.questionId);
    const prev = map.get(key) || { questionId: a.questionId };
    map.set(key, {
      ...prev,
      response: a.response !== undefined ? a.response : prev.response,
      textAnswer: a.textAnswer !== undefined ? a.textAnswer : prev.textAnswer,
      flagged: a.flagged !== undefined ? !!a.flagged : prev.flagged,
      timeSpent: a.timeSpent !== undefined ? Number(a.timeSpent) || 0 : (prev.timeSpent || 0),
      answeredAt: new Date(),
    });
  });
  return Array.from(map.values());
}

// Strip correct answers / explanations for a student-facing question payload.
function sanitizeQuestion(q, marks) {
  return {
    _id: q._id,
    questionText: q.questionText,
    questionType: q.questionType,
    questionImage: q.questionImage || null,
    unit: q.unit,
    chapter: q.chapter,
    difficulty: q.difficulty,
    marks: marks != null ? marks : q.marks,
    options: (q.options || []).map(o => ({ _id: o._id, text: o.text })),
  };
}

// Strict server-side scoring for a graded set of answers.
function gradeAnswers(answers, quiz, questionsById, marksByQ) {
  const neg = (quiz.settings && quiz.settings.negativeMarking) || 0;
  let posScore = 0;
  let negTotal = 0;
  let unanswered = 0;
  let needsManual = false;

  const graded = (answers || []).map(a => {
    const q = questionsById[String(a.questionId)];
    const each = marksByQ[String(a.questionId)] != null ? marksByQ[String(a.questionId)] : 1;
    if (!q) return { ...a, isCorrect: false, marksAwarded: 0, negativeApplied: 0 };

    const raw = a.response != null && a.response !== '' ? a.response : a.textAnswer;
    const resp = raw == null ? '' : String(raw).trim();
    let correct = false;
    let manual = false;

    if (q.questionType === 'mcq') {
      const correctOpt = (q.options || []).find(o => o.isCorrect);
      correct = !!correctOpt && resp === String(correctOpt.text).trim();
    } else if (q.questionType === 'true_false') {
      correct = resp.toLowerCase() === String(q.correctAnswer || '').trim().toLowerCase();
    } else if (q.questionType === 'fill_blank') {
      correct = resp.toLowerCase() === String(q.correctAnswer || '').trim().toLowerCase();
    } else if (q.questionType === 'numerical') {
      const num = parseFloat(resp);
      const exp = parseFloat(q.correctAnswer);
      correct = !isNaN(num) && !isNaN(exp) && Math.abs(num - exp) < 1e-6;
    } else { // short_answer / long_answer — auto-grade exact match, else flag for review
      const exp = String(q.correctAnswer || '').trim().toLowerCase();
      if (exp && resp.toLowerCase() === exp) correct = true;
      else manual = true;
    }

    let awarded = 0;
    let negApplied = 0;
    if (correct) { awarded = each; posScore += each; }
    else if (manual) { needsManual = true; }
    else if (resp) { if (neg > 0) { negApplied = neg; negTotal += neg; } }
    else { unanswered += 1; }

    return { ...a, isCorrect: correct, marksAwarded: awarded, negativeApplied: negApplied };
  });

  return { graded, posScore, negTotal, unanswered, needsManual };
}

async function bumpQuestionCounters(gradedAnswers) {
  const inc = {};
  (gradedAnswers || []).forEach(a => {
    const qid = String(a.questionId);
    if (!inc[qid]) inc[qid] = { asked: 1, correct: 0 };
    else inc[qid].asked += 1;
    if (a.isCorrect) inc[qid].correct += 1;
  });
  const ops = Object.entries(inc).map(([qid, v]) => ({
    updateOne: { filter: { _id: qid }, update: { $inc: { timesAsked: v.asked, timesCorrect: v.correct } } },
  }));
  if (ops.length) { try { await QuestionBank.bulkWrite(ops); } catch (e) { /* non-fatal */ } }
}

// Finalize (grade + persist) an in_progress attempt — used by submit and by timer paths.
async function finalizeAttempt(attempt, quiz, { autoSubmitted = false } = {}) {
  const marksByQ = marksMap(quiz);
  const allIds = Object.keys(marksByQ);
  const docs = await QuestionBank.find({ _id: { $in: allIds } }).lean();
  const questionsById = {};
  docs.forEach(d => { questionsById[String(d._id)] = d; });

  const { graded, posScore, negTotal, needsManual } = gradeAnswers(attempt.answers, quiz, questionsById, marksByQ);
  const totalMarks = quiz.totalMarks || allIds.reduce((s, id) => s + (marksByQ[id] || 1), 0);
  const net = Math.max(0, posScore - negTotal);
  const percentage = totalMarks > 0 ? Math.round((net / totalMarks) * 100) : 0;
  const passPct = (quiz.settings && quiz.settings.passPercentage) || 40;
  const deadlineExceeded = attempt.deadlineAt && Date.now() > new Date(attempt.deadlineAt).getTime();

  attempt.answers = graded;
  attempt.score = posScore;
  attempt.negativeMarks = negTotal;
  attempt.totalMarks = totalMarks;
  attempt.percentage = percentage;
  attempt.passed = percentage >= passPct;
  attempt.timeTaken = Math.max(0, Math.round((Date.now() - new Date(attempt.startedAt).getTime()) / 1000));
  attempt.submittedAt = new Date();
  attempt.autoSubmitted = autoSubmitted;
  attempt.needsManualGrading = needsManual;
  attempt.status = deadlineExceeded ? 'timed_out' : 'completed';
  await attempt.save();

  await bumpQuestionCounters(graded);

  // Refresh quiz aggregate stats
  const stats = await QuizAttempt.aggregate([
    { $match: { quizId: quiz._id, status: { $in: ['completed', 'timed_out'] } } },
    { $group: { _id: null, avg: { $avg: '$percentage' }, n: { $sum: 1 } } },
  ]);
  await Quiz.findByIdAndUpdate(quiz._id, { avgScore: Math.round(stats[0]?.avg || 0), attemptCount: stats[0]?.n || 0 });

  return attempt;
}

/* ───────────────────────── STUDENT: browse ───────────────────────── */

// GET /api/quizzes — student-facing list of published quizzes with availability + my attempts
const listQuizzes = asyncHandler(async (req, res) => {
  const { subjectId, type, educationLevel, board, search, status } = req.query;
  const now = new Date();
  const query = { collegeId: req.user.collegeId, isPublished: true, isActive: true };
  if (subjectId) query.subjectId = subjectId;
  if (type) query.type = type;
  if (educationLevel) query.educationLevel = educationLevel;
  if (board) query.board = board;
  if (search) query.title = { $regex: search, $options: 'i' };

  let quizzes = await Quiz.find(query)
    .populate('subjectId', 'name code')
    .populate('createdBy', 'name')
    .sort({ 'settings.endDate': 1, createdAt: -1 })
    .lean();

  // Availability status filter
  const withStatus = quizzes.map(q => {
    const s = q.settings || {};
    let avail = 'open';
    if (s.startDate && now < new Date(s.startDate)) avail = 'upcoming';
    else if (s.endDate && now > new Date(s.endDate)) avail = 'closed';
    return { ...q, availability: avail };
  }).filter(q => !status || q.availability === status);

  const quizIds = withStatus.map(q => q._id);
  const attempts = quizIds.length
    ? await QuizAttempt.find({ collegeId: req.user.collegeId, studentId: req.user._id, quizId: { $in: quizIds } })
      .select('quizId percentage passed status attemptNo submittedAt').sort({ submittedAt: -1 }).lean()
    : [];

  const byQuiz = {};
  attempts.forEach(a => {
    const k = String(a.quizId);
    if (!byQuiz[k]) byQuiz[k] = { attempts: 0, best: 0, passed: false, last: null };
    byQuiz[k].attempts += 1;
    byQuiz[k].best = Math.max(byQuiz[k].best, a.percentage || 0);
    if (a.passed) byQuiz[k].passed = true;
    if (!byQuiz[k].last) byQuiz[k].last = a.submittedAt;
  });

  const enriched = withStatus.map(q => ({ ...q, myStats: byQuiz[String(q._id)] || { attempts: 0, best: 0, passed: false, last: null } }));
  res.json({ success: true, quizzes: enriched, data: enriched });
});

/* ───────────────────────── STUDENT: attempt lifecycle ───────────────────────── */

// POST /api/quizzes/:id/start — begin or resume an attempt
const startAttempt = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.id, collegeId: req.user.collegeId, isPublished: true, isActive: true });
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

  const now = new Date();
  const s = quiz.settings || {};
  if (s.startDate && now < new Date(s.startDate)) {
    return res.status(400).json({ success: false, message: 'This quiz has not opened yet.' });
  }
  if (s.endDate && now > new Date(s.endDate)) {
    return res.status(400).json({ success: false, message: 'This quiz window has closed.' });
  }

  // Resume an existing in-progress attempt if still within its deadline.
  const inProgress = await QuizAttempt.findOne({ quizId: quiz._id, studentId: req.user._id, status: 'in_progress' });
  if (inProgress) {
    if (inProgress.deadlineAt && now <= new Date(inProgress.deadlineAt)) {
      const remainingSec = Math.max(0, Math.round((new Date(inProgress.deadlineAt) - now) / 1000));
      return res.json({ success: true, attempt: { _id: inProgress._id, quizId: quiz._id, questionOrder: inProgress.questionOrder, answers: inProgress.answers, startedAt: inProgress.startedAt, deadlineAt: inProgress.deadlineAt }, resumed: true, timeRemainingSec: remainingSec, durationSec: (s.duration || 30) * 60 });
    }
    // Past deadline — finalize as timed out, then fall through to see if a retry is allowed.
    await finalizeAttempt(inProgress, quiz, { autoSubmitted: true });
  }

  const usedAttempts = await QuizAttempt.countDocuments({ quizId: quiz._id, studentId: req.user._id, status: { $in: ['completed', 'timed_out'] } });
  const maxAttempts = s.maxAttempts || 1;
  if (usedAttempts >= maxAttempts) {
    return res.status(400).json({ success: false, message: `Maximum attempts (${maxAttempts}) reached.` });
  }

  // Snapshot the question order (shuffled per student if enabled).
  let order = [];
  (quiz.sections || []).forEach(sec => (sec.questionIds || []).forEach(qid => order.push(qid)));
  if (s.shuffleQuestions) order = order.sort(() => Math.random() - 0.5);

  const durationSec = (s.duration || 30) * 60;
  const deadline = new Date(now.getTime() + durationSec * 1000);

  const attempt = await QuizAttempt.create({
    collegeId: req.user.collegeId,
    quizId: quiz._id,
    studentId: req.user._id,
    attemptNo: usedAttempts + 1,
    questionOrder: order,
    answers: [],
    startedAt: now,
    deadlineAt: deadline,
    totalMarks: quiz.totalMarks,
  });

  logAudit(req, 'create', 'quiz-attempt', { resourceId: attempt._id, description: `Started quiz: ${quiz.title}` });
  res.status(201).json({ success: true, attempt: { _id: attempt._id, quizId: quiz._id, questionOrder: attempt.questionOrder, startedAt: attempt.startedAt, deadlineAt: attempt.deadlineAt }, resumed: false, timeRemainingSec: durationSec, durationSec });
});

// GET /api/quizzes/attempts/:attemptId/questions — sanitized questions in this attempt's order
const getAttemptQuestions = asyncHandler(async (req, res) => {
  const attempt = await QuizAttempt.findOne({ _id: req.params.attemptId, studentId: req.user._id });
  if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
  const quiz = await Quiz.findById(attempt.quizId).lean();
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

  const marksByQ = marksMap(quiz);
  const order = (attempt.questionOrder && attempt.questionOrder.length)
    ? attempt.questionOrder
    : [].concat(...(quiz.sections || []).map(s => s.questionIds || []));

  const docs = await QuestionBank.find({ _id: { $in: order }, isActive: true }).lean();
  const byId = {}; docs.forEach(d => { byId[String(d._id)] = d; });

  const questions = order.filter(id => byId[String(id)]).map(id => sanitizeQuestion(byId[String(id)], marksByQ[String(id)]));

  // Restore any autosaved responses so a refresh resumes seamlessly.
  const saved = {};
  (attempt.answers || []).forEach(a => { saved[String(a.questionId)] = { response: a.response, textAnswer: a.textAnswer, flagged: a.flagged }; });

  const remainingSec = attempt.deadlineAt ? Math.max(0, Math.round((new Date(attempt.deadlineAt) - Date.now()) / 1000)) : (quiz.settings?.duration || 30) * 60;

  res.json({ success: true, questions, saved, status: attempt.status, timeRemainingSec: remainingSec, allowReview: quiz.settings?.allowReview !== false });
});

// PATCH /api/quizzes/attempts/:attemptId/answers — throttled autosave
const saveProgress = asyncHandler(async (req, res) => {
  const attempt = await QuizAttempt.findOne({ _id: req.params.attemptId, studentId: req.user._id, status: 'in_progress' });
  if (!attempt) return res.status(404).json({ success: false, message: 'No active attempt found' });

  if (attempt.deadlineAt && Date.now() > new Date(attempt.deadlineAt).getTime()) {
    const quiz = await Quiz.findById(attempt.quizId);
    await finalizeAttempt(attempt, quiz, { autoSubmitted: true });
    return res.json({ success: true, saved: false, timedOut: true });
  }

  attempt.answers = upsertAnswers(attempt.answers, Array.isArray(req.body.answers) ? req.body.answers : []);
  await attempt.save();
  const remainingSec = Math.max(0, Math.round((new Date(attempt.deadlineAt) - Date.now()) / 1000));
  res.json({ success: true, saved: true, savedAt: new Date(), timeRemainingSec: remainingSec });
});

// POST /api/quizzes/attempts/:attemptId/submit — strict server-side scoring
const submitAttempt = asyncHandler(async (req, res) => {
  const attempt = await QuizAttempt.findOne({ _id: req.params.attemptId, studentId: req.user._id });
  if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });

  // Idempotent: already finalized → return existing result.
  if (attempt.status !== 'in_progress') {
    const quiz = await Quiz.findById(attempt.quizId).lean();
    return res.json({ success: true, alreadySubmitted: true, result: buildResultPayload(attempt, quiz) });
  }

  const quiz = await Quiz.findById(attempt.quizId);
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

  attempt.answers = upsertAnswers(attempt.answers, Array.isArray(req.body.answers) ? req.body.answers : []);
  await finalizeAttempt(attempt, quiz, { autoSubmitted: false });

  logAudit(req, 'submit', 'quiz-attempt', { resourceId: attempt._id, description: `Score ${attempt.percentage}%` });
  emitDataChange(req, { collegeId: req.user.collegeId, resource: 'quiz-attempts', action: 'update', quizId: quiz._id });

  res.json({ success: true, result: buildResultPayload(attempt, quiz) });
});

// Build the student-facing result (respecting showResults / allowReview).
function buildResultPayload(attempt, quiz) {
  const allowReview = quiz?.settings?.allowReview !== false;
  const showResults = quiz?.settings?.showResults !== false;
  const base = {
    attemptId: attempt._id,
    quizId: attempt.quizId,
    status: attempt.status,
    autoSubmitted: attempt.autoSubmitted,
    totalMarks: attempt.totalMarks,
    passed: attempt.passed,
    timeTaken: attempt.timeTaken,
    attemptNo: attempt.attemptNo,
  };
  if (!showResults && !ROLES_STAFF.length) { /* placeholder — students get score only if enabled */ }
  if (showResults) {
    base.score = attempt.score;
    base.negativeMarks = attempt.negativeMarks;
    base.percentage = attempt.percentage;
  }
  if (allowReview) {
    base.answers = (attempt.answers || []).map(a => ({
      questionId: a.questionId, response: a.response, textAnswer: a.textAnswer,
      isCorrect: a.isCorrect, marksAwarded: a.marksAwarded, negativeApplied: a.negativeApplied,
    }));
  }
  return base;
}

// GET /api/quizzes/attempts/:attemptId/result — with review details (correct answers) when allowed
const getAttemptResult = asyncHandler(async (req, res) => {
  const attempt = await QuizAttempt.findOne({ _id: req.params.attemptId, studentId: req.user._id });
  if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
  const quiz = await Quiz.findById(attempt.quizId).lean();
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

  const payload = buildResultPayload(attempt, quiz);

  // Attach full question review (correct answers + explanations) only after completion.
  if (quiz.settings?.allowReview !== false && attempt.status !== 'in_progress') {
    const marksByQ = marksMap(quiz);
    const ids = Object.keys(marksByQ);
    const docs = await QuestionBank.find({ _id: { $in: ids } }).lean();
    const byId = {}; docs.forEach(d => { byId[String(d._id)] = d; });
    payload.review = (attempt.answers || []).map(a => {
      const q = byId[String(a.questionId)];
      if (!q) return { questionId: a.questionId, response: a.response, isCorrect: a.isCorrect };
      return {
        questionId: a.questionId,
        questionText: q.questionText,
        questionType: q.questionType,
        yourResponse: a.response != null && a.response !== '' ? a.response : a.textAnswer,
        isCorrect: a.isCorrect,
        marksAwarded: a.marksAwarded,
        correctAnswer: q.questionType === 'mcq'
          ? ((q.options || []).find(o => o.isCorrect) || {}).text
          : q.correctAnswer,
        options: (q.options || []).map(o => ({ text: o.text, isCorrect: !!o.isCorrect })),
        explanation: q.explanation || '',
        unit: q.unit, chapter: q.chapter, difficulty: q.difficulty,
      };
    });
  }

  res.json({ success: true, result: payload });
});

// GET /api/quizzes/history — the student's attempt history
const getMyHistory = asyncHandler(async (req, res) => {
  const attempts = await QuizAttempt.find({ collegeId: req.user.collegeId, studentId: req.user._id, status: { $in: ['completed', 'timed_out'] } })
    .populate('quizId', 'title type subjectId totalMarks')
    .sort({ submittedAt: -1 }).limit(100).lean();
  res.json({ success: true, attempts, data: attempts });
});

/* ───────────────────────── STUDENT: bookmarks ───────────────────────── */

const addBookmark = asyncHandler(async (req, res) => {
  const { questionId, note } = req.body;
  if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
    return res.status(400).json({ success: false, message: 'Valid questionId is required' });
  }
  const bookmark = await QuestionBookmark.findOneAndUpdate(
    { collegeId: req.user.collegeId, studentId: req.user._id, questionId },
    { $set: { note: note || '' }, $setOnInsert: { collegeId: req.user.collegeId, studentId: req.user._id, questionId } },
    { new: true, upsert: true }
  );
  res.status(201).json({ success: true, bookmark });
});

const removeBookmark = asyncHandler(async (req, res) => {
  await QuestionBookmark.findOneAndDelete({ collegeId: req.user.collegeId, studentId: req.user._id, questionId: req.params.questionId });
  res.json({ success: true, message: 'Bookmark removed' });
});

const getBookmarks = asyncHandler(async (req, res) => {
  const bookmarks = await QuestionBookmark.find({ collegeId: req.user.collegeId, studentId: req.user._id })
    .populate('questionId', 'questionText questionType options unit chapter difficulty explanation subjectId')
    .sort({ createdAt: -1 }).lean();
  res.json({ success: true, bookmarks, data: bookmarks });
});

/* ───────────────────────── STAFF: authoring ───────────────────────── */

const createQuiz = asyncHandler(async (req, res) => {
  const { title, description, type, subjectId, courseId, semester, educationLevel, board, sections, settings } = req.body;
  if (!title) return res.status(400).json({ success: false, message: 'title is required' });

  const quiz = new Quiz({
    collegeId: req.user.collegeId,
    createdBy: req.user._id,
    title, description, type, subjectId, courseId, semester, educationLevel, board,
    sections: Array.isArray(sections) ? sections : [],
    settings: settings || {},
  });
  quiz.recomputeTotals();
  await quiz.save();

  logAudit(req, 'create', 'quiz', { resourceId: quiz._id, description: `Created quiz: ${title}` });
  emitDataChange(req, { collegeId: req.user.collegeId, resource: 'quizzes', action: 'create' });
  res.status(201).json({ success: true, quiz });
});

// GET /api/quizzes/manage — staff list incl. drafts
const manageQuizzes = asyncHandler(async (req, res) => {
  const { subjectId, type, search, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };
  if (subjectId) query.subjectId = subjectId;
  if (type) query.type = type;
  if (search) query.title = { $regex: search, $options: 'i' };
  const skip = (Number(page) - 1) * Number(limit);
  const [quizzes, total] = await Promise.all([
    Quiz.find(query).populate('subjectId', 'name code').populate('createdBy', 'name').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    Quiz.countDocuments(query),
  ]);
  res.json({ success: true, quizzes, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
});

// GET /api/quizzes/:id — full detail (staff: includes question ids for editing)
const getQuizById = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.id, collegeId: req.user.collegeId }).lean();
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

  const ids = [].concat(...(quiz.sections || []).map(s => s.questionIds || []));
  const questions = ids.length ? await QuestionBank.find({ _id: { $in: ids } }).lean() : [];
  res.json({ success: true, quiz, questions });
});

const updateQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
  const { title, description, type, subjectId, courseId, semester, educationLevel, board, sections, settings, isPublished } = req.body;
  if (title !== undefined) quiz.title = title;
  if (description !== undefined) quiz.description = description;
  if (type !== undefined) quiz.type = type;
  if (subjectId !== undefined) quiz.subjectId = subjectId;
  if (courseId !== undefined) quiz.courseId = courseId;
  if (semester !== undefined) quiz.semester = semester;
  if (educationLevel !== undefined) quiz.educationLevel = educationLevel;
  if (board !== undefined) quiz.board = board;
  if (Array.isArray(sections)) quiz.sections = sections;
  if (settings) quiz.settings = { ...(quiz.settings?.toObject ? quiz.settings.toObject() : quiz.settings || {}), ...settings };
  if (isPublished !== undefined) quiz.isPublished = !!isPublished;
  quiz.recomputeTotals();
  await quiz.save();
  logAudit(req, 'update', 'quiz', { resourceId: quiz._id, description: `Updated quiz: ${quiz.title}` });
  res.json({ success: true, quiz });
});

const deleteQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOneAndUpdate({ _id: req.params.id, collegeId: req.user.collegeId }, { isActive: false }, { new: true });
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
  logAudit(req, 'delete', 'quiz', { resourceId: quiz._id, description: `Deleted quiz: ${quiz.title}` });
  res.json({ success: true, message: 'Quiz deleted' });
});

const publishQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
  if (quiz.questionCount === 0) return res.status(400).json({ success: false, message: 'Add at least one question before publishing.' });
  quiz.isPublished = req.body.isPublished !== undefined ? !!req.body.isPublished : !quiz.isPublished;
  await quiz.save();
  emitDataChange(req, { collegeId: req.user.collegeId, resource: 'quizzes', action: quiz.isPublished ? 'publish' : 'unpublish' });
  res.json({ success: true, quiz });
});

// POST /api/quizzes/:id/questions — add question ids from the bank to a section
const addQuizQuestions = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
  const { sectionName = 'Section A', questionIds = [], marksEach } = req.body;
  if (!Array.isArray(questionIds) || !questionIds.length) {
    return res.status(400).json({ success: false, message: 'questionIds array is required' });
  }
  // Verify questions belong to this college.
  const valid = await QuestionBank.find({ _id: { $in: questionIds }, collegeId: req.user.collegeId, isActive: true }).select('_id');
  const validIds = valid.map(v => v._id);
  if (!validIds.length) return res.status(400).json({ success: false, message: 'No valid questions found' });

  let section = quiz.sections.find(s => s.name === sectionName);
  if (!section) { section = { name: sectionName, questionIds: [], marksEach: marksEach || 1 }; quiz.sections.push(section); }
  if (marksEach != null) section.marksEach = marksEach;
  const existing = new Set((section.questionIds || []).map(String));
  validIds.forEach(id => { if (!existing.has(String(id))) section.questionIds.push(id); });

  quiz.recomputeTotals();
  await quiz.save();
  res.json({ success: true, quiz });
});

// DELETE /api/quizzes/:id/questions/:questionId — remove a question from a quiz
const removeQuizQuestion = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
  (quiz.sections || []).forEach(s => { s.questionIds = (s.questionIds || []).filter(q => String(q) !== String(req.params.questionId)); });
  quiz.sections = quiz.sections.filter(s => (s.questionIds || []).length > 0);
  quiz.recomputeTotals();
  await quiz.save();
  res.json({ success: true, quiz });
});

/* ───────────────────────── STAFF: monitoring + grading ───────────────────────── */

const getQuizAttempts = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.id, collegeId: req.user.collegeId }).lean();
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
  const attempts = await QuizAttempt.find({ quizId: quiz._id })
    .populate('studentId', 'name rollNo email department')
    .sort({ submittedAt: -1, startedAt: -1 }).limit(500).lean();
  res.json({ success: true, attempts, quiz: { title: quiz.title, totalMarks: quiz.totalMarks } });
});

// PATCH /api/quizzes/attempts/:attemptId/grade — manually grade free-text answers
const gradeAttempt = asyncHandler(async (req, res) => {
  const attempt = await QuizAttempt.findOne({ _id: req.params.attemptId, collegeId: req.user.collegeId });
  if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
  const quiz = await Quiz.findById(attempt.quizId);
  const marksByQ = marksMap(quiz);

  const { grades = [] } = req.body; // [{ questionId, isCorrect }]
  const byQ = {}; grades.forEach(g => { byQ[String(g.questionId)] = !!g.isCorrect; });

  let posScore = 0, negTotal = 0, needsManual = false;
  attempt.answers = attempt.answers.map(a => {
    const each = marksByQ[String(a.questionId)] != null ? marksByQ[String(a.questionId)] : 1;
    if (Object.prototype.hasOwnProperty.call(byQ, String(a.questionId))) {
      const correct = byQ[String(a.questionId)];
      const awarded = correct ? each : 0;
      if (correct) posScore += each;
      return { ...a.toObject(), isCorrect: correct, marksAwarded: awarded, negativeApplied: 0 };
    }
    // unchanged
    if (a.isCorrect) posScore += each;
    if (a.negativeApplied) negTotal += a.negativeApplied;
    return a;
  });

  const totalMarks = quiz.totalMarks || attempt.totalMarks;
  const net = Math.max(0, posScore - negTotal);
  attempt.score = posScore;
  attempt.negativeMarks = negTotal;
  attempt.percentage = totalMarks > 0 ? Math.round((net / totalMarks) * 100) : 0;
  attempt.passed = attempt.percentage >= ((quiz.settings?.passPercentage) || 40);
  attempt.needsManualGrading = false;
  attempt.gradedBy = req.user._id;
  await attempt.save();

  logAudit(req, 'update', 'quiz-attempt', { resourceId: attempt._id, description: `Manually graded attempt` });
  res.json({ success: true, attempt });
});

/* ───────────────────────── STAFF: analytics ───────────────────────── */

const getQuizAnalytics = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.id, collegeId: req.user.collegeId }).lean();
  if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

  const marksByQ = marksMap(quiz);
  const ids = Object.keys(marksByQ);
  const docs = ids.length ? await QuestionBank.find({ _id: { $in: ids } }).lean() : [];
  const qMeta = {}; docs.forEach(d => { qMeta[String(d._id)] = d; });

  const attempts = await QuizAttempt.find({ quizId: quiz._id, status: { $in: ['completed', 'timed_out'] } })
    .select('percentage passed score negativeMarks totalMarks timeTaken answers').lean();

  const totalAttempts = attempts.length;
  const percentages = attempts.map(a => a.percentage || 0);
  const avg = totalAttempts ? Math.round(percentages.reduce((s, p) => s + p, 0) / totalAttempts) : 0;
  const highest = totalAttempts ? Math.max(...percentages) : 0;
  const lowest = totalAttempts ? Math.min(...percentages) : 0;
  const passRate = totalAttempts ? Math.round((attempts.filter(a => a.passed).length / totalAttempts) * 100) : 0;

  // Score distribution buckets
  const buckets = [0, 0, 0, 0, 0]; // 0-40,40-60,60-75,75-90,90-100
  percentages.forEach(p => {
    if (p < 40) buckets[0]++; else if (p < 60) buckets[1]++; else if (p < 75) buckets[2]++; else if (p < 90) buckets[3]++; else buckets[4]++;
  });

  // Per-question item analysis + per-topic mastery
  const itemStats = {};
  ids.forEach(id => { itemStats[id] = { asked: 0, answered: 0, correct: 0, sumCorrPct: 0, sumWrongPct: 0, nCorr: 0, nWrong: 0 }; });
  const topicStats = {}; // unit -> { asked, correct }

  attempts.forEach(a => {
    const ansByQ = {};
    (a.answers || []).forEach(ans => { ansByQ[String(ans.questionId)] = ans; });
    ids.forEach(id => {
      const st = itemStats[id];
      st.asked += 1;
      const meta = qMeta[id];
      const unit = meta?.unit || 'General';
      if (!topicStats[unit]) topicStats[unit] = { asked: 0, correct: 0 };
      const ans = ansByQ[id];
      if (ans) {
        st.answered += 1;
        topicStats[unit].asked += 1;
        if (ans.isCorrect) {
          st.correct += 1; st.sumCorrPct += (a.percentage || 0); st.nCorr += 1;
          topicStats[unit].correct += 1;
        } else {
          st.sumWrongPct += (a.percentage || 0); st.nWrong += 1;
        }
      }
    });
  });

  const itemAnalysis = ids.map(id => {
    const st = itemStats[id];
    const meta = qMeta[id] || {};
    const pValue = st.answered ? +(st.correct / st.answered).toFixed(2) : null; // difficulty index (higher = easier)
    const discrimination = (st.nCorr && st.nWrong) ? +((st.sumCorrPct / st.nCorr) - (st.sumWrongPct / st.nWrong)).toFixed(1) : null;
    return {
      questionId: id,
      questionText: meta.questionText || '',
      unit: meta.unit, chapter: meta.chapter, difficulty: meta.difficulty, questionType: meta.questionType,
      asked: st.asked, answered: st.answered, correct: st.correct,
      percentCorrect: st.answered ? Math.round((st.correct / st.answered) * 100) : null,
      pValue, discrimination,
    };
  });

  const topicMastery = Object.entries(topicStats).map(([unit, v]) => ({
    unit, asked: v.asked, correct: v.correct, accuracy: v.asked ? Math.round((v.correct / v.asked) * 100) : 0,
  })).sort((a, b) => a.accuracy - b.accuracy);

  res.json({ success: true, analytics: {
    totalAttempts, avg, highest, lowest, passRate,
    distribution: { labels: ['<40%', '40-60%', '60-75%', '75-90%', '90-100%'], counts: buckets },
    itemAnalysis, topicMastery,
    needsManualGrading: await QuizAttempt.countDocuments({ quizId: quiz._id, needsManualGrading: true }),
  } });
});

/* ───────────────────────── STUDENT: analytics + recommendations ───────────────────────── */

// GET /api/quizzes/my-analytics — per-topic accuracy, weak areas, trends for the logged-in student
const getMyAnalytics = asyncHandler(async (req, res) => {
  const attempts = await QuizAttempt.find({ collegeId: req.user.collegeId, studentId: req.user._id, status: { $in: ['completed', 'timed_out'] } })
    .populate('quizId', 'title type subjectId').lean();

  if (!attempts.length) {
    return res.json({ success: true, analytics: { totalAttempts: 0, byTopic: [], trend: [], streak: 0, avgScore: 0 } });
  }

  // Gather all question ids referenced to map unit/chapter/subject.
  const qids = new Set();
  attempts.forEach(a => (a.answers || []).forEach(ans => qids.add(String(ans.questionId))));
  const docs = qids.size ? await QuestionBank.find({ _id: { $in: Array.from(qids) } }).select('unit chapter subjectId difficulty questionText').lean() : [];
  const qMeta = {}; docs.forEach(d => { qMeta[String(d._id)] = d; });

  const topicMap = {}; // `${unit}` -> { asked, correct }
  const subjMap = {};
  let correctTotal = 0, answeredTotal = 0;
  const trend = attempts.slice().sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt)).map(a => ({ date: a.submittedAt, percentage: a.percentage, quizTitle: a.quizId?.title }));

  attempts.forEach(a => {
    (a.answers || []).forEach(ans => {
      if (!ans || ans.isCorrect === undefined || ans.isCorrect === null) return;
      answeredTotal += 1;
      if (ans.isCorrect) correctTotal += 1;
      const meta = qMeta[String(ans.questionId)] || {};
      const unit = meta.unit || 'General';
      if (!topicMap[unit]) topicMap[unit] = { asked: 0, correct: 0, chapters: {} };
      topicMap[unit].asked += 1;
      if (ans.isCorrect) topicMap[unit].correct += 1;
      const chapter = meta.chapter || 'General';
      if (!topicMap[unit].chapters[chapter]) topicMap[unit].chapters[chapter] = { asked: 0, correct: 0 };
      topicMap[unit].chapters[chapter].asked += 1;
      if (ans.isCorrect) topicMap[unit].chapters[chapter].correct += 1;
    });
  });

  const byTopic = Object.entries(topicMap).map(([unit, v]) => ({
    unit,
    asked: v.asked, correct: v.correct,
    accuracy: v.asked ? Math.round((v.correct / v.asked) * 100) : 0,
    chapters: Object.entries(v.chapters).map(([chapter, c]) => ({ chapter, asked: c.asked, correct: c.correct, accuracy: c.asked ? Math.round((c.correct / c.asked) * 100) : 0 })),
  })).sort((a, b) => a.accuracy - b.accuracy);

  // Streak: consecutive days with at least one completed attempt (ending today or yesterday).
  const days = Array.from(new Set(attempts.filter(a => a.submittedAt).map(a => new Date(a.submittedAt).toDateString()))).map(d => new Date(d)).sort((x, y) => y - x);
  let streak = 0;
  const dayMs = 86400000;
  let cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  if (days.length && days[0].toDateString() !== cursor.toDateString()) cursor = new Date(cursor.getTime() - dayMs);
  for (const d of days) {
    const dd = new Date(d); dd.setHours(0, 0, 0, 0);
    if (dd.getTime() === cursor.getTime()) { streak++; cursor = new Date(cursor.getTime() - dayMs); } else break;
  }

  const avgScore = Math.round(attempts.reduce((s, a) => s + (a.percentage || 0), 0) / attempts.length);

  res.json({ success: true, analytics: {
    totalAttempts: attempts.length, avgScore, overallAccuracy: answeredTotal ? Math.round((correctTotal / answeredTotal) * 100) : 0,
    byTopic, trend, streak, bookmarkCount: await QuestionBookmark.countDocuments({ studentId: req.user._id }),
  } });
});

// GET /api/quizzes/recommendations — rule-based weak-area practice recommendations (+ optional AI tip)
const getRecommendations = asyncHandler(async (req, res) => {
  const attempts = await QuizAttempt.find({ collegeId: req.user.collegeId, studentId: req.user._id, status: { $in: ['completed', 'timed_out'] } }).lean();
  if (!attempts.length) {
    return res.json({ success: true, recommendations: [], message: 'Complete a few quizzes to unlock personalized recommendations.' });
  }
  const qids = new Set();
  attempts.forEach(a => (a.answers || []).forEach(ans => qids.add(String(ans.questionId))));
  const docs = qids.size ? await QuestionBank.find({ _id: { $in: Array.from(qids) } }).select('unit chapter subjectId difficulty questionText').lean() : [];
  const qMeta = {}; docs.forEach(d => { qMeta[String(d._id)] = d; });

  const weak = {}; // unit|chapter -> { asked, correct }
  attempts.forEach(a => {
    (a.answers || []).forEach(ans => {
      if (!ans || ans.isCorrect === undefined || ans.isCorrect === null) return;
      const meta = qMeta[String(ans.questionId)] || {};
      const key = `${meta.unit || 'General'}||${meta.chapter || 'General'}`;
      if (!weak[key]) weak[key] = { asked: 0, correct: 0, subjectId: meta.subjectId, unit: meta.unit || 'General', chapter: meta.chapter || 'General' };
      weak[key].asked += 1;
      if (ans.isCorrect) weak[key].correct += 1;
    });
  });

  const MIN_ASKED = 3;
  const candidates = Object.values(weak)
    .map(v => ({ ...v, accuracy: v.asked ? Math.round((v.correct / v.asked) * 100) : 0 }))
    .filter(v => v.asked >= MIN_ASKED && v.accuracy < 70)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);

  const recommendations = await Promise.all(candidates.map(async c => {
    // Count available practice questions in this weak area.
    const available = await QuestionBank.countDocuments({ collegeId: req.user.collegeId, isActive: true, unit: c.unit, ...(c.chapter && c.chapter !== 'General' ? { chapter: c.chapter } : {}) });
    return {
      unit: c.unit, chapter: c.chapter, accuracy: c.accuracy, asked: c.asked,
      availableQuestions: available,
      priority: c.accuracy < 40 ? 'high' : c.accuracy < 60 ? 'medium' : 'low',
      suggestion: `Practice more ${c.unit}${c.chapter !== 'General' ? ' — ' + c.chapter : ''} questions. You're at ${c.accuracy}% accuracy.`,
    };
  }));

  // Optional AI enrichment (opt-in via ?ai=1) — a short personalized study tip.
  let aiTip = null;
  if (req.query.ai === '1' && recommendations.length) {
    try {
      const { askAI } = require('../services/aiService');
      const list = recommendations.map(r => `${r.unit}/${r.chapter}: ${r.accuracy}% accuracy over ${r.asked} questions`).join('; ');
      aiTip = await askAI(
        `A student has demonstrated performance gaps in: ${list}. Provide a concise, deeply encouraging cognitive study tip and a strategic order of revision. Speak in natural, warm human language as a senior academic mentor.`,
        'You are an empathetic, world-class university academic mentor. Guide students with cognitive learning science and genuine human encouragement. Avoid robotic clichés.',
        { maxTokens: 250 }
      );
    } catch (e) { aiTip = null; }
  }

  res.json({ success: true, recommendations, aiTip });
});

/* ───────────────────────── STAFF: taxonomy (Super Admin manages) ───────────────────────── */

const getTaxonomy = asyncHandler(async (req, res) => {
  let doc = await PlatformSetting.findOne({ key: 'platform' }).lean();
  const tax = doc?.taxonomy || {};
  res.json({ success: true, taxonomy: {
    educationLevels: (tax.educationLevels && tax.educationLevels.length) ? tax.educationLevels : DEFAULT_TAXONOMY.educationLevels,
    boards: (tax.boards && tax.boards.length) ? tax.boards : DEFAULT_TAXONOMY.boards,
    competitiveExams: (tax.competitiveExams && tax.competitiveExams.length) ? tax.competitiveExams : DEFAULT_TAXONOMY.competitiveExams,
  } });
});

const updateTaxonomy = asyncHandler(async (req, res) => {
  let doc = await PlatformSetting.findOne({ key: 'platform' });
  if (!doc) doc = new PlatformSetting({ key: 'platform' });
  const { educationLevels, boards, competitiveExams } = req.body;
  doc.taxonomy = {
    educationLevels: Array.isArray(educationLevels) ? educationLevels : doc.taxonomy?.educationLevels || [],
    boards: Array.isArray(boards) ? boards : doc.taxonomy?.boards || [],
    competitiveExams: Array.isArray(competitiveExams) ? competitiveExams : doc.taxonomy?.competitiveExams || [],
  };
  await doc.save();
  logAudit(req, 'update', 'platform-taxonomy', { description: 'Updated education taxonomy' });
  res.json({ success: true, taxonomy: doc.taxonomy });
});

module.exports = {
  listQuizzes, startAttempt, getAttemptQuestions, saveProgress, submitAttempt, getAttemptResult, getMyHistory,
  addBookmark, removeBookmark, getBookmarks,
  createQuiz, manageQuizzes, getQuizById, updateQuiz, deleteQuiz, publishQuiz, addQuizQuestions, removeQuizQuestion,
  getQuizAttempts, gradeAttempt, getQuizAnalytics, getMyAnalytics, getRecommendations,
  getTaxonomy, updateTaxonomy,
  // internal (reused by the quiz scheduler job)
  marksMap, sanitizeQuestion, finalizeAttempt,
};
