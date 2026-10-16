/**
 * importService — parses uploaded question sets into normalized question objects.
 * Supports Excel/CSV (local, via xlsx), PDF (local text extraction via pdf-parse),
 * and images (via OpenAI Vision). Text/PDF/image extraction is AI-assisted and
 * returns a preview that the caller confirms before saving to the QuestionBank.
 */

const XLSX = require('xlsx');
const aiService = require('./aiService');

// Canonical template columns for Excel/CSV import.
const TEMPLATE_HEADERS = [
  'question', 'type', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e',
  'correct', 'marks', 'difficulty', 'unit', 'chapter', 'explanation', 'tags',
];

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const VALID_TYPES = ['mcq', 'true_false', 'fill_blank', 'short_answer', 'long_answer', 'numerical'];
const VALID_DIFF = ['easy', 'medium', 'hard', 'very_hard'];

// Normalize a header/key: lowercase, strip non-alphanumerics.
function normKey(k) { return String(k || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

const KEY_ALIASES = {
  question: ['question', 'questiontext', 'q', 'text', 'prompt'],
  type: ['type', 'questiontype', 'qtype'],
  correct: ['correct', 'answer', 'correctanswer', 'key', 'answerkey'],
  marks: ['marks', 'mark', 'points', 'score'],
  difficulty: ['difficulty', 'level', 'difficultylevel'],
  unit: ['unit', 'topic', 'module', 'section'],
  chapter: ['chapter', 'lesson', 'unit'],
  explanation: ['explanation', 'solution', 'rationale', 'feedback'],
  tags: ['tags', 'labels', 'keywords'],
};

function pickField(row, canonical) {
  const aliases = KEY_ALIASES[canonical] || [canonical];
  for (const key of Object.keys(row)) {
    if (aliases.includes(normKey(key))) return row[key];
  }
  return undefined;
}

function optionColumns(row) {
  const opts = {};
  for (const key of Object.keys(row)) {
    const nk = normKey(key);
    const m = nk.match(/^option([a-h])$/);
    if (m) opts[m[1]] = row[key];
  }
  return opts;
}

// Turn a `correct` value + options into a normalized options[] + correctAnswer.
function buildOptions(type, optMap, correctRaw) {
  const correctStr = String(correctRaw == null ? '' : correctRaw).trim();
  if (type === 'true_false') {
    const isTrue = /^true|^t$|^yes|^\+$/i.test(correctStr);
    return {
      options: [{ text: 'True', isCorrect: isTrue }, { text: 'False', isCorrect: !isTrue }],
      correctAnswer: isTrue ? 'True' : 'False',
    };
  }
  const letters = Object.keys(optMap).sort();
  const options = letters.map(l => ({ text: String(optMap[l] == null ? '' : optMap[l]).trim(), isCorrect: false })).filter(o => o.text);
  if (!options.length) return { options: [], correctAnswer: correctStr };

  // Resolve which option is correct.
  let idx = -1;
  const lowerCorrect = correctStr.toLowerCase();
  if (/^[a-h]$/i.test(correctStr)) idx = LETTERS.indexOf(lowerCorrect);
  if (idx === -1 && /^\d+$/.test(correctStr)) { const n = parseInt(correctStr, 10); idx = (n >= 1 && n <= options.length) ? n - 1 : (n >= 0 && n < options.length ? n : -1); }
  if (idx === -1) idx = options.findIndex(o => o.text.toLowerCase() === lowerCorrect);
  if (idx >= 0 && idx < options.length) options[idx].isCorrect = true;

  const correctAnswer = idx >= 0 ? options[idx].text : correctStr;
  return { options, correctAnswer };
}

function normalizeRow(row, defaults = {}) {
  const questionText = String(pickField(row, 'question') || '').trim();
  if (!questionText) return null;
  let type = String(pickField(row, 'type') || 'mcq').toLowerCase().trim().replace(/[\s-]/g, '_');
  if (type === 'multiple' || type === 'multiplechoice' || type === 'multi') type = 'mcq';
  if (type === 'tf' || type === 'boolean') type = 'true_false';
  if (!VALID_TYPES.includes(type)) type = 'mcq';

  let difficulty = String(pickField(row, 'difficulty') || defaults.difficulty || 'medium').toLowerCase().trim().replace(/\s+/g, '_');
  if (difficulty === 'veryhard') difficulty = 'very_hard';
  if (!VALID_DIFF.includes(difficulty)) difficulty = 'medium';

  const optMap = optionColumns(row);
  const { options, correctAnswer } = buildOptions(type, optMap, pickField(row, 'correct'));

  const tagsRaw = pickField(row, 'tags');
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map(String) : String(tagsRaw || '').split(/[;,|]/).map(s => s.trim()).filter(Boolean);

  const marksNum = parseFloat(pickField(row, 'marks'));
  const unit = String(pickField(row, 'unit') || defaults.unit || 'General').trim() || 'General';
  // chapter aliases include 'unit', so prefer an explicit chapter if present and != unit
  let chapter = pickField(row, 'chapter');
  chapter = String(chapter == null || chapter === '' ? unit : chapter).trim() || 'General';

  return {
    questionText,
    questionType: type,
    options: (type === 'mcq' || type === 'true_false') ? options : options,
    correctAnswer,
    explanation: String(pickField(row, 'explanation') || '').trim(),
    difficulty,
    marks: marksNum > 0 ? marksNum : 1,
    unit,
    chapter,
    tags,
    source: defaults.source || 'excel',
  };
}

// Parse an Excel/CSV file buffer into normalized questions (local, no AI).
function parseSpreadsheet(buffer, defaults = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const questions = rows.map(r => normalizeRow(r, defaults)).filter(Boolean);
  return { questions, totalRows: rows.length };
}

// Parse a PDF: extract text locally, then AI-parse into structured questions.
async function parsePdf(buffer, opts = {}) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  let text = '';
  try {
    const result = await parser.getText();
    text = result?.text || '';
  } finally {
    try { await parser.destroy(); } catch (e) { /* ignore */ }
  }
  if (!text.trim()) throw new Error('Could not extract text from the PDF (it may be scanned/image-only).');
  const questions = await aiService.extractQuestionsFromText(text, opts);
  return { questions, chars: text.length };
}

// Parse an image via OpenAI Vision.
async function parseImage(base64DataUrl, opts = {}) {
  const questions = await aiService.extractQuestionsFromImage(base64DataUrl, opts);
  return { questions };
}

function buildTemplateCsv() {
  const example = [
    TEMPLATE_HEADERS.join(','),
    '"What is 2+2?",mcq,3,4,5,6,,b,1,medium,Algebra,Basics,"Simple addition",math',
    '"The sky is green",true_false,,,,,,,True,1,easy,General,General,"Observation",science',
    '"Water boils at ___ degrees Celsius",fill_blank,90,100,110,120,c,1,medium,Chemistry,States,"100C at sea level",science',
  ];
  return example.join('\n');
}

module.exports = { parseSpreadsheet, parsePdf, parseImage, buildTemplateCsv, TEMPLATE_HEADERS, normalizeRow };
