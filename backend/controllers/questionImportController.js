const asyncHandler = require('../middleware/asyncHandler');
const QuestionBank = require('../models/QuestionBank');
const importService = require('../services/importService');
const aiService = require('../services/aiService');
const { logAudit } = require('../services/auditService');

// Detect source from an uploaded file buffer and parse accordingly.
//
// The parser is selected from a *server side* extension/mime allow-list, not
// from whatever the client claims: otherwise a file could be routed to a
// parser it was never meant for (type confusion).
const PARSER_BY_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
};

const PARSER_BY_EXTENSION = {
  '.pdf': 'pdf',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.xlsx': 'excel',
  '.xls': 'excel',
  '.csv': 'excel',
};

const MAX_BASE64_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_QUESTIONS = 500;

function resolveParser(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (PARSER_BY_MIME[mime]) return PARSER_BY_MIME[mime];

  const name = String(file.originalname || '');
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (PARSER_BY_EXTENSION[ext]) return PARSER_BY_EXTENSION[ext];

  // Unknown type - try the spreadsheet parser (the safest default).
  return 'excel';
}

async function parseUploadedFile(file, opts) {
  const parser = resolveParser(file);

  if (parser === 'pdf') {
    const r = await importService.parsePdf(file.buffer, opts);
    return { source: 'pdf', ...r };
  }
  if (parser === 'image') {
    const mime = String(file.mimetype || 'image/png').toLowerCase();
    const dataUrl = `data:${mime};base64,${file.buffer.toString('base64')}`;
    const r = await importService.parseImage(dataUrl, opts);
    return { source: 'image', ...r };
  }

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
      if (String(imageBase64).length > MAX_BASE64_BYTES) {
        return res.status(413).json({ success: false, message: 'Image payload is too large (max 8MB).' });
      }
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
  const questions = (result.questions || []).slice(0, MAX_IMPORT_QUESTIONS);
  res.json({ success: true, source: result.source, count: questions.length, questions });
});

// POST /api/quizzes/import/confirm — persist the reviewed questions into the QuestionBank
const confirmImport = asyncHandler(async (req, res) => {
  const { subjectId, educationLevel, board, questions } = req.body || {};
  if (!subjectId) return res.status(400).json({ success: false, message: 'subjectId is required' });
  if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ success: false, message: 'No questions to import' });
  if (questions.length > MAX_IMPORT_QUESTIONS) {
    return res.status(400).json({ success: false, message: `At most ${MAX_IMPORT_QUESTIONS} questions can be imported at once.` });
  }

  // LLM / spreadsheet produced content is still untrusted: strip any markup
  // before it is persisted so it can never become stored XSS when rendered.
  const sanitizeText = (value, maxLength = 5000) => String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, maxLength)
    .trim();

  const docs = questions.map(q => ({
    collegeId: req.user.collegeId,
    subjectId,
    createdBy: req.user._id,
    unit: sanitizeText(q.unit || 'General', 100),
    chapter: sanitizeText(q.chapter || q.unit || 'General', 100),
    questionText: sanitizeText(q.questionText),
    questionType: q.questionType || 'mcq',
    options: (q.questionType === 'mcq' || q.questionType === 'true_false')
      ? (Array.isArray(q.options) ? q.options : []).slice(0, 12).map(o => ({ text: sanitizeText(o.text, 500), isCorrect: !!o.isCorrect }))
      : [],
    correctAnswer: sanitizeText(q.correctAnswer, 1000),
    difficulty: q.difficulty || 'medium',
    marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
    explanation: sanitizeText(q.explanation, 5000),
    tags: Array.isArray(q.tags) ? q.tags.slice(0, 20).map(t => sanitizeText(t, 50)) : [],
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
