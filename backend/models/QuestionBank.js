const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  unit: { type: String, required: true },
  chapter: { type: String, required: true },
  questionText: { type: String, required: true },
  questionImage: { type: String },
  questionType: { type: String, enum: ['mcq', 'short_answer', 'long_answer', 'true_false', 'fill_blank', 'numerical'], required: true },
  options: [{ text: String, isCorrect: Boolean }],
  correctAnswer: { type: String },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'very_hard'], required: true },
  marks: { type: Number, required: true, min: 0.5 },
  explanation: { type: String },
  tags: [String],
  // ─── Smart MCQ / Exam-Prep extensions (all optional/defaulted — existing docs unaffected) ───
  source: { type: String, enum: ['manual', 'ai', 'pdf', 'excel', 'image'], default: 'manual' },
  educationLevel: { type: String, enum: ['school', 'undergraduate', 'postgraduate', 'competitive'], default: 'undergraduate' },
  board: { type: String, trim: true },        // e.g. CBSE, ICSE, State Board, or a competitive exam tag (JEE, NEET, UPSC)
  cognitiveLevel: { type: String, enum: ['recall', 'understanding', 'application', 'analysis'], default: 'understanding' },
  // Performance counters updated as attempts are graded (drives analytics + recommendations)
  timesAsked: { type: Number, default: 0 },
  timesCorrect: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  usageCount: { type: Number, default: 0 },
}, { timestamps: true });

questionSchema.index({ collegeId: 1, subjectId: 1 });
questionSchema.index({ collegeId: 1, subjectId: 1, unit: 1, chapter: 1 });
questionSchema.index({ collegeId: 1, difficulty: 1 });
questionSchema.index({ collegeId: 1, educationLevel: 1, board: 1 });

// Convenience: derived accuracy (0-100) used by analytics/recommendations
questionSchema.virtual('accuracyPct').get(function () {
  return this.timesAsked > 0 ? Math.round((this.timesCorrect / this.timesAsked) * 100) : null;
});
questionSchema.set('toJSON', { virtuals: true });
questionSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('QuestionBank', questionSchema);
