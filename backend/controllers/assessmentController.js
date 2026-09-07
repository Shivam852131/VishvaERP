const asyncHandler = require('../middleware/asyncHandler');
const { SkillAssessment, AssessmentAttempt } = require('../models/SkillAssessment');
const StudentProfile = require('../models/StudentProfile');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

const getAssessments = asyncHandler(async (req, res) => {
  const { category, skillTag, difficulty, search, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId, isPublished: true, isActive: true };
  if (category) query.category = category;
  if (skillTag) query.skillTags = { $in: Array.isArray(skillTag) ? skillTag : [skillTag] };
  if (difficulty) query.difficulty = difficulty;
  if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];

  const skip = (Number(page) - 1) * Number(limit);
  const [assessments, total] = await Promise.all([
    SkillAssessment.find(query).select('-questions').populate('createdBy', 'name').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    SkillAssessment.countDocuments(query),
  ]);

  const attempts = await AssessmentAttempt.find({ collegeId: req.user.collegeId, studentId: req.user._id }).select('assessmentId score percentage passed completedAt');
  const attemptMap = {};
  attempts.forEach(a => { attemptMap[a.assessmentId.toString()] = a; });

  const enriched = assessments.map(a => ({
    ...a.toObject(),
    myAttempts: attemptMap[a._id.toString()] ? [attemptMap[a._id.toString()]] : [],
    hasPassed: attemptMap[a._id.toString()]?.passed || false,
  }));

  res.json({ success: true, assessments: enriched, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } });
});

const getAssessmentById = asyncHandler(async (req, res) => {
  const assessment = await SkillAssessment.findOne({ _id: req.params.id, collegeId: req.user.collegeId, isPublished: true })
    .populate('createdBy', 'name');
  if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

  const attemptCount = await AssessmentAttempt.countDocuments({ assessmentId: assessment._id, studentId: req.user._id });
  const bestAttempt = await AssessmentAttempt.findOne({ assessmentId: assessment._id, studentId: req.user._id, status: 'completed' })
    .sort({ percentage: -1 }).select('score percentage passed completedAt');

  res.json({ success: true, assessment, attemptCount, bestAttempt, canAttempt: attemptCount < assessment.maxAttempts });
});

const createAssessment = asyncHandler(async (req, res) => {
  const { title, description, category, skillTags, difficulty, questions, timeLimit, passingScore, maxAttempts, isPublic, tags } = req.body;
  if (!title || !category || !questions || !questions.length) {
    return res.status(400).json({ success: false, message: 'title, category, and questions are required' });
  }

  const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
  const assessment = await SkillAssessment.create({
    collegeId: req.user.collegeId, createdBy: req.user._id,
    title, description, category, skillTags: skillTags || [], difficulty: difficulty || 'medium',
    questions, timeLimit: timeLimit || 30, totalPoints, passingScore: passingScore || 60,
    maxAttempts: maxAttempts || 3, isPublic: isPublic !== false, tags: tags || [],
  });

  logAudit(req, 'create', 'skill-assessment', { resourceId: assessment._id, description: `Created: ${title}` });
  res.status(201).json({ success: true, assessment });
});

const startAttempt = asyncHandler(async (req, res) => {
  const assessment = await SkillAssessment.findOne({ _id: req.params.id, collegeId: req.user.collegeId, isPublished: true });
  if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

  const existingAttempts = await AssessmentAttempt.countDocuments({ assessmentId: assessment._id, studentId: req.user._id });
  if (existingAttempts >= assessment.maxAttempts) {
    return res.status(400).json({ success: false, message: `Maximum attempts (${assessment.maxAttempts}) reached` });
  }

  const inProgress = await AssessmentAttempt.findOne({ assessmentId: assessment._id, studentId: req.user._id, status: 'in_progress' });
  if (inProgress) {
    const elapsed = (Date.now() - inProgress.startedAt.getTime()) / 60000;
    if (elapsed <= assessment.timeLimit) {
      return res.json({ success: true, attempt: inProgress, timeRemaining: Math.round(assessment.timeLimit - elapsed) });
    }
    inProgress.status = 'timed_out';
    await inProgress.save();
  }

  const attempt = await AssessmentAttempt.create({
    collegeId: req.user.collegeId, assessmentId: assessment._id, studentId: req.user._id,
    totalPoints: assessment.totalPoints, startedAt: new Date(),
  });

  await SkillAssessment.findByIdAndUpdate(assessment._id, { $inc: { attemptCount: 1 } });
  logAudit(req, 'create', 'assessment-attempt', { resourceId: attempt._id, description: `Started: ${assessment.title}` });

  res.status(201).json({ success: true, attempt, timeRemaining: assessment.timeLimit });
});

const submitAttempt = asyncHandler(async (req, res) => {
  const attempt = await AssessmentAttempt.findOne({ _id: req.params.id, studentId: req.user._id, status: 'in_progress' });
  if (!attempt) return res.status(404).json({ success: false, message: 'No active attempt found' });

  const assessment = await SkillAssessment.findById(attempt.assessmentId);
  if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

  const answers = req.body.answers || [];
  let score = 0;

  const gradedAnswers = answers.map(a => {
    const question = assessment.questions.id(a.questionId);
    if (!question) return { ...a, isCorrect: false, pointsEarned: 0 };

    let isCorrect = false;
    if (question.type === 'mcq') {
      isCorrect = question.options.some(o => o.text === a.selectedOption && o.isCorrect);
    } else if (question.type === 'true_false') {
      isCorrect = String(a.selectedOption).toLowerCase() === String(question.correctAnswer).toLowerCase();
    } else if (question.type === 'fill_blank') {
      isCorrect = String(a.textAnswer || '').trim().toLowerCase() === String(question.correctAnswer || '').trim().toLowerCase();
    }

    const pointsEarned = isCorrect ? (question.points || 1) : 0;
    score += pointsEarned;
    return { ...a, isCorrect, pointsEarned };
  });

  const percentage = attempt.totalPoints > 0 ? Math.round((score / attempt.totalPoints) * 100) : 0;
  const passed = percentage >= assessment.passingScore;
  const timeTaken = Math.round((Date.now() - attempt.startedAt.getTime()) / 60000);

  attempt.answers = gradedAnswers;
  attempt.score = score;
  attempt.percentage = percentage;
  attempt.passed = passed;
  attempt.timeTaken = timeTaken;
  attempt.completedAt = new Date();
  attempt.status = 'completed';
  await attempt.save();

  if (passed) {
    const skillUpdates = {};
    (assessment.skillTags || []).forEach(tag => {
      skillUpdates[`skills`] = { $each: [{ name: tag, category: 'technical', level: percentage >= 80 ? 'advanced' : percentage >= 60 ? 'intermediate' : 'beginner', verified: true }] };
    });
  }

  const totalAttempts = await AssessmentAttempt.countDocuments({ assessmentId: assessment._id, status: 'completed' });
  const avgScore = await AssessmentAttempt.aggregate([
    { $match: { assessmentId: assessment._id, status: 'completed' } },
    { $group: { _id: null, avg: { $avg: '$percentage' } } },
  ]);
  await SkillAssessment.findByIdAndUpdate(assessment._id, { avgScore: Math.round(avgScore[0]?.avg || 0) });

  logAudit(req, 'submit', 'assessment-attempt', { resourceId: attempt._id, description: `Score: ${percentage}%` });
  res.json({ success: true, attempt: { score, totalPoints: attempt.totalPoints, percentage, passed, timeTaken, answers: gradedAnswers } });
});

const getLeaderboard = asyncHandler(async (req, res) => {
  const { assessmentId } = req.query;
  const match = { collegeId: req.user.collegeId, status: 'completed' };
  if (assessmentId) match.assessmentId = require('mongoose').Types.ObjectId.createFromHexString(assessmentId);

  const leaderboard = await AssessmentAttempt.aggregate([
    { $match: match },
    { $sort: { percentage: -1, timeTaken: 1 } },
    { $group: {
      _id: '$studentId',
      bestScore: { $max: '$percentage' },
      bestTime: { $min: '$timeTaken' },
      totalAttempts: { $sum: 1 },
      passedAttempts: { $sum: { $cond: ['$passed', 1, 0] } },
    }},
    { $sort: { bestScore: -1, bestTime: 1 } },
    { $limit: 50 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'student' } },
    { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
    { $project: { studentId: '$_id', name: '$student.name', avatar: '$student.avatar', department: '$student.department', bestScore: 1, bestTime: 1, totalAttempts: 1, passedAttempts: 1 } },
  ]);

  res.json({ success: true, leaderboard });
});

const getMyStats = asyncHandler(async (req, res) => {
  const attempts = await AssessmentAttempt.find({ collegeId: req.user.collegeId, studentId: req.user._id, status: 'completed' })
    .populate('assessmentId', 'title category skillTags');

  const totalAttempts = attempts.length;
  const passedAttempts = attempts.filter(a => a.passed).length;
  const avgScore = totalAttempts > 0 ? Math.round(attempts.reduce((s, a) => s + a.percentage, 0) / totalAttempts) : 0;
  const bestScore = totalAttempts > 0 ? Math.max(...attempts.map(a => a.percentage)) : 0;
  const recentAttempts = attempts.slice(-10).reverse();

  const categoryStats = {};
  attempts.forEach(a => {
    const cat = a.assessmentId?.category || 'other';
    if (!categoryStats[cat]) categoryStats[cat] = { attempts: 0, passed: 0, avgScore: 0, totalScore: 0 };
    categoryStats[cat].attempts++;
    if (a.passed) categoryStats[cat].passed++;
    categoryStats[cat].totalScore += a.percentage;
  });
  Object.keys(categoryStats).forEach(k => {
    categoryStats[k].avgScore = Math.round(categoryStats[k].totalScore / categoryStats[k].attempts);
    delete categoryStats[k].totalScore;
  });

  const profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId: req.user._id });

  res.json({
    success: true,
    stats: { totalAttempts, passedAttempts, passRate: totalAttempts > 0 ? Math.round((passedAttempts / totalAttempts) * 100) : 0, avgScore, bestScore, categoryStats, recentAttempts },
    assessmentScore: profile?.skillAssessmentScore || 0,
  });
});

module.exports = { getAssessments, getAssessmentById, createAssessment, startAttempt, submitAttempt, getLeaderboard, getMyStats };
