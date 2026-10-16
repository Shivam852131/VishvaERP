const asyncHandler = require('../middleware/asyncHandler');
const QuestionBank = require('../models/QuestionBank');
const importService = require('../services/importService');
const aiService = require('../services/aiService');
const { logAudit } = require('../services/auditService');

// Detect source from an uploaded file buffer and parse accordingly.
async function parseUploadedFile(file, opts) {
  const mime = file.mimetype || '';
  const name = file.originalname || '';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
    const r = await importService.parsePdf(file.buffer, opts);
    return { source: 'pdf', ...r };
  }
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) {
    const dataUrl = `data:${mime || 'image/png'};base64,${file.buffer.toString('base64')}`;
    const r = await importService.parseImage(dataUrl, opts);
    return { source: 'image', ...r };
  }
  // Excel / CSV / anything else → spreadsheet parser
  const r = importService.parseSpreadsheet(file.buffer, { source: 'excel', difficulty: opts.difficulty, unit: opts.subject });
  return { source: 'excel', ...r };
}

// POST /api/quizzes/import/preview — parse a file / pasted text / image into a reviewable list
const previewImport = asyncHandler(async (req, res) => {
  const { text, imageBase64, subject, educationLevel, difficulty, count } = req.body || {};
  const opts = { subject, educationLevel, difficulty, count: Number(count) || 50 };
  let result;
  try {
    if (req.file) {
      result = await parseUploadedFile(req.file, opts);
    } else if (imageBase64) {
      result = { source: 'image', ...(await importService.parseImage(imageBase64, opts)) };
    } else if (text) {
      const questions = await aiService.extractQuestionsFromText(text, opts);
      result = { source: 'pdf', questions };
    } else {
      return res.status(400).json({ success: false, message: 'Upload a file, or provide text / image content to extract.' });
    }
  } catch (e) {
    return res.status(422).json({ success: false, message: e.message });
  }
  res.json({ success: true, source: result.source, count: (result.questions || []).length, questions: result.questions || [] });
});

// POST /api/quizzes/import/confirm — persist the reviewed questions into the QuestionBank
const confirmImport = asyncHandler(async (req, res) => {
  const { subjectId, educationLevel, board, questions } = req.body || {};
  if (!subjectId) return res.status(400).json({ success: false, message: 'subjectId is required' });
  if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ success: false, message: 'No questions to import' });

  const docs = questions.map(q => ({
    collegeId: req.user.collegeId,
    subjectId,
    createdBy: req.user._id,
    unit: q.unit || 'General',
    chapter: q.chapter || q.unit || 'General',
    questionText: String(q.questionText || '').trim(),
    questionType: q.questionType || 'mcq',
    options: (q.questionType === 'mcq' || q.questionType === 'true_false')
      ? (q.options || []).map(o => ({ text: o.text, isCorrect: !!o.isCorrect }))
      : [],
    correctAnswer: q.correctAnswer || '',
    difficulty: q.difficulty || 'medium',
    marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
    explanation: q.explanation || '',
    tags: Array.isArray(q.tags) ? q.tags : [],
    source: q.source || 'excel',
    educationLevel: educationLevel || q.educationLevel || 'undergraduate',
    board: board || q.board || '',
  })).filter(q => q.questionText);

  if (!docs.length) return res.status(400).json({ success: false, message: 'No valid questions after validation' });

  const created = await QuestionBank.insertMany(docs, { ordered: false });
  logAudit(req, 'create', 'question_bank', { description: `Imported ${created.length} questions (${docs[0].source})` });
  res.status(201).json({ success: true, imported: created.length, source: docs[0].source, ids: created.map(c => c._id) });
});

// GET /api/quizzes/import/template — downloadable CSV template
const downloadTemplate = asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="question-import-template.csv"');
  res.send(importService.buildTemplateCsv());
});

// POST /api/quizzes/generate-questions — AI generation (preview, or save directly to bank)
const generateQuestions = asyncHandler(async (req, res) => {
  const { subject, topic, count, difficulty, questionType, educationLevel, board, save, subjectId } = req.body || {};
  let questions;
  try {
    questions = await aiService.generateMCQs({ subject, topic, count, difficulty, questionType, educationLevel, board });
  } catch (e) {
    return res.status(503).json({ success: false, message: e.message });
  }

  if (save && subjectId) {
    const docs = questions.map(q => ({
      collegeId: req.user.collegeId, subjectId, createdBy: req.user._id,
      unit: q.unit, chapter: q.chapter, questionText: q.questionText, questionType: q.questionType,
      options: q.options, correctAnswer: q.correctAnswer, difficulty: q.difficulty, marks: q.marks,
      explanation: q.explanation, tags: q.tags, source: 'ai',
      educationLevel: educationLevel || 'undergraduate', board: board || '',
    }));
    const created = await QuestionBank.insertMany(docs);
    logAudit(req, 'create', 'question_bank', { description: `AI-generated ${created.length} questions` });
    return res.status(201).json({ success: true, saved: created.length, questions: created });
  }
  res.json({ success: true, questions });
});

module.exports = { previewImport, confirmImport, downloadTemplate, generateQuestions };
