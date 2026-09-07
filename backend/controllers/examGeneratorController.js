const asyncHandler = require('../middleware/asyncHandler');
const QuestionBank = require('../models/QuestionBank');
const ExamTemplate = require('../models/ExamTemplate');
const { logAudit } = require('../services/auditService');

// @desc    Add question to bank
const addQuestion = asyncHandler(async (req, res) => {
  const question = await QuestionBank.create({
    collegeId: req.user.collegeId,
    createdBy: req.user._id,
    subjectId: req.body.subjectId,
    unit: req.body.unit,
    chapter: req.body.chapter,
    questionText: req.body.questionText,
    questionImage: req.body.questionImage || null,
    questionType: req.body.questionType,
    options: req.body.options || [],
    correctAnswer: req.body.correctAnswer,
    difficulty: req.body.difficulty,
    marks: req.body.marks || 1,
    explanation: req.body.explanation,
    tags: req.body.tags || [],
  });

  logAudit(req, 'create', 'question_bank', { resourceId: question._id, description: `Added question to bank: ${question.questionType}` });
  res.status(201).json({ success: true, question });
});

// @desc    Bulk add questions
const bulkAddQuestions = asyncHandler(async (req, res) => {
  const { questions } = req.body;
  if (!Array.isArray(questions) || !questions.length) {
    return res.status(400).json({ success: false, message: 'Questions array is required' });
  }

  const prepared = questions.map(q => ({
    collegeId: req.user.collegeId,
    createdBy: req.user._id,
    subjectId: q.subjectId,
    unit: q.unit,
    chapter: q.chapter,
    questionText: q.questionText,
    questionImage: q.questionImage || null,
    questionType: q.questionType,
    options: q.options || [],
    correctAnswer: q.correctAnswer,
    difficulty: q.difficulty,
    marks: q.marks || 1,
    explanation: q.explanation,
    tags: q.tags || [],
  }));

  const created = await QuestionBank.insertMany(prepared);
  logAudit(req, 'create', 'question_bank', { description: `Bulk added ${created.length} questions` });
  res.status(201).json({ success: true, count: created.length, questions: created });
});

// @desc    Get question bank (with filters)
const getQuestions = asyncHandler(async (req, res) => {
  const { subjectId, unit, chapter, difficulty, questionType, page = 1, limit = 50 } = req.query;
  const filter = { collegeId: req.user.collegeId, isActive: true };
  if (subjectId) filter.subjectId = subjectId;
  if (unit) filter.unit = unit;
  if (chapter) filter.chapter = chapter;
  if (difficulty) filter.difficulty = difficulty;
  if (questionType) filter.questionType = questionType;

  const total = await QuestionBank.countDocuments(filter);
  const questions = await QuestionBank.find(filter)
    .populate('subjectId', 'name code')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  res.json({ success: true, total, page: parseInt(page), pages: Math.ceil(total / limit), questions });
});

// @desc    Update question
const updateQuestion = asyncHandler(async (req, res) => {
  const question = await QuestionBank.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true }
  );

  if (!question) {
    return res.status(404).json({ success: false, message: 'Question not found' });
  }

  logAudit(req, 'update', 'question_bank', { resourceId: question._id, description: `Updated question in bank` });
  res.json({ success: true, question });
});

// @desc    Delete question (soft delete)
const deleteQuestion = asyncHandler(async (req, res) => {
  const question = await QuestionBank.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    { isActive: false },
    { new: true }
  );

  if (!question) {
    return res.status(404).json({ success: false, message: 'Question not found' });
  }

  logAudit(req, 'delete', 'question_bank', { resourceId: question._id, description: `Removed question from bank` });
  res.json({ success: true, message: 'Question removed' });
});

// @desc    Get question bank stats
const getQuestionBankStats = asyncHandler(async (req, res) => {
  const filter = { collegeId: req.user.collegeId, isActive: true };
  if (req.query.subjectId) filter.subjectId = req.query.subjectId;

  const [byType, byDifficulty, bySubject, total] = await Promise.all([
    QuestionBank.aggregate([
      { $match: filter },
      { $group: { _id: '$questionType', count: { $sum: 1 } } },
    ]),
    QuestionBank.aggregate([
      { $match: filter },
      { $group: { _id: '$difficulty', count: { $sum: 1 } } },
    ]),
    QuestionBank.aggregate([
      { $match: filter },
      { $group: { _id: '$subjectId', count: { $sum: 1 } } },
      { $lookup: { from: 'subjects', localField: '_id', foreignField: '_id', as: 'subject' } },
      { $unwind: { path: '$subject', preserveNullAndEmptyArrays: true } },
      { $project: { count: 1, subjectName: '$subject.name', subjectCode: '$subject.code' } },
    ]),
    QuestionBank.countDocuments(filter),
  ]);

  res.json({ success: true, total, byType, byDifficulty, bySubject });
});

// @desc    Create exam template
const createTemplate = asyncHandler(async (req, res) => {
  const template = await ExamTemplate.create({
    collegeId: req.user.collegeId,
    createdBy: req.user._id,
    name: req.body.name,
    subjectId: req.body.subjectId,
    courseId: req.body.courseId,
    semester: req.body.semester,
    units: req.body.units || [],
    chapters: req.body.chapters || [],
    difficulty: req.body.difficulty || 'mixed',
    questionDistribution: req.body.questionDistribution || {},
    totalMarks: req.body.totalMarks || 0,
    duration: req.body.duration || 120,
    instructions: req.body.instructions,
  });

  logAudit(req, 'create', 'exam_template', { resourceId: template._id, description: `Created exam template: ${template.name}` });
  res.status(201).json({ success: true, template });
});

// @desc    Get templates
const getTemplates = asyncHandler(async (req, res) => {
  const filter = { collegeId: req.user.collegeId };
  if (req.query.subjectId) filter.subjectId = req.query.subjectId;

  const templates = await ExamTemplate.find(filter)
    .populate('subjectId', 'name code')
    .sort({ createdAt: -1 });

  res.json({ success: true, templates });
});

// @desc    Delete template
const deleteTemplate = asyncHandler(async (req, res) => {
  const template = await ExamTemplate.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!template) {
    return res.status(404).json({ success: false, message: 'Template not found' });
  }

  logAudit(req, 'delete', 'exam_template', { resourceId: template._id, description: `Deleted exam template: ${template.name}` });
  res.json({ success: true, message: 'Template deleted' });
});

// @desc    Generate question paper from template
const generatePaper = asyncHandler(async (req, res) => {
  const template = await ExamTemplate.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('subjectId', 'name code');
  if (!template) {
    return res.status(404).json({ success: false, message: 'Template not found' });
  }

  const baseFilter = {
    collegeId: req.user.collegeId,
    subjectId: template.subjectId._id,
    isActive: true,
  };
  if (template.units.length) baseFilter.unit = { $in: template.units };
  if (template.chapters.length) baseFilter.chapter = { $in: template.chapters };

  const dist = template.questionDistribution;
  const selectedQuestions = [];

  for (const [type, config] of Object.entries(dist)) {
    const count = typeof config === 'object' ? (config.count || 0) : 0;
    if (count <= 0) continue;

    let typeFilter = { ...baseFilter, questionType: type };
    if (template.difficulty !== 'mixed') {
      typeFilter.difficulty = template.difficulty;
    }

    const available = await QuestionBank.find(typeFilter).lean();
    const shuffled = available.sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, count);
    selectedQuestions.push(...picked);
  }

  if (selectedQuestions.length === 0) {
    return res.status(400).json({ success: false, message: 'No questions found matching the template criteria. Add questions to the bank first.' });
  }

  const ids = selectedQuestions.map(q => q._id);
  await QuestionBank.updateMany({ _id: { $in: ids } }, { $inc: { usageCount: 1 } });

  template.generatedPapers.push({
    generatedAt: new Date(),
    questionIds: ids,
    paperHash: require('crypto').createHash('md5').update(ids.join(',')).digest('hex'),
  });
  await template.save();

  logAudit(req, 'create', 'exam_paper', { description: `Generated paper from template: ${template.name}`, metadata: { questionCount: selectedQuestions.length } });

  res.json({
    success: true,
    paper: {
      template: template.name,
      subject: template.subjectId.name,
      totalMarks: template.totalMarks,
      duration: template.duration,
      instructions: template.instructions,
      questions: selectedQuestions,
    },
  });
});

// @desc    Get units and chapters for a subject (from question bank)
const getSubjectStructure = asyncHandler(async (req, res) => {
  const filter = { collegeId: req.user.collegeId, isActive: true };
  if (req.params.subjectId) filter.subjectId = req.params.subjectId;

  const structure = await QuestionBank.aggregate([
    { $match: filter },
    { $group: { _id: { unit: '$unit', chapter: '$chapter' }, count: { $sum: 1 } } },
    { $sort: { '_id.unit': 1, '_id.chapter': 1 } },
  ]);

  const units = {};
  structure.forEach(s => {
    if (!units[s._id.unit]) units[s._id.unit] = [];
    units[s._id.unit].push({ chapter: s._id.chapter, count: s.count });
  });

  res.json({ success: true, structure: units });
});

module.exports = {
  addQuestion,
  bulkAddQuestions,
  getQuestions,
  updateQuestion,
  deleteQuestion,
  getQuestionBankStats,
  createTemplate,
  getTemplates,
  deleteTemplate,
  generatePaper,
  getSubjectStructure,
};
