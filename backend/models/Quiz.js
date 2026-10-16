const mongoose = require('mongoose');

/**
 * Quiz — a scheduled, timed MCQ/assessment container that draws questions from the
 * shared QuestionBank. Supports practice / quiz / exam modes, negative marking,
 * shuffling, scheduling windows, and multiple attempts.
 */

const quizSectionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'QuestionBank' }],
  marksEach: { type: Number, default: 1, min: 0 },
}, { _id: true });

const quizSettingsSchema = new mongoose.Schema({
  duration: { type: Number, default: 30, min: 1 },        // minutes
  startDate: { type: Date },                              // opens (optional; null = always open once published)
  endDate: { type: Date },                                // closes (optional)
  shuffleQuestions: { type: Boolean, default: true },
  negativeMarking: { type: Number, default: 0, min: 0 },  // marks deducted per wrong answer (0 = disabled)
  showResults: { type: Boolean, default: true },          // reveal score right after submit
  allowReview: { type: Boolean, default: true },          // reveal correct answers/explanations after submit
  maxAttempts: { type: Number, default: 1, min: 1 },
  passPercentage: { type: Number, default: 40, min: 0, max: 100 },
}, { _id: false });

const quizSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String },
  type: { type: String, enum: ['practice', 'quiz', 'exam'], default: 'quiz' },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  semester: { type: Number },
  educationLevel: { type: String, enum: ['school', 'undergraduate', 'postgraduate', 'competitive'], default: 'undergraduate' },
  board: { type: String, trim: true },                  // CBSE, ICSE, JEE, NEET, UPSC, etc.
  sections: [quizSectionSchema],
  settings: { type: quizSettingsSchema, default: () => ({}) },
  totalMarks: { type: Number, default: 0 },
  questionCount: { type: Number, default: 0 },
  isPublished: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  attemptCount: { type: Number, default: 0 },
  avgScore: { type: Number, default: 0 },
}, { timestamps: true });

quizSchema.index({ collegeId: 1, isPublished: 1 });
quizSchema.index({ collegeId: 1, subjectId: 1 });
quizSchema.index({ collegeId: 1, educationLevel: 1, board: 1 });
quizSchema.index({ 'settings.endDate': 1 });

// Recompute denormalized totals from sections (call before save / after edits).
quizSchema.methods.recomputeTotals = function () {
  let marks = 0;
  let count = 0;
  (this.sections || []).forEach(s => {
    const n = (s.questionIds || []).length;
    count += n;
    marks += n * (s.marksEach || 1);
  });
  this.totalMarks = marks;
  this.questionCount = count;
};

// Availability relative to a given time (used by list + start).
quizSchema.methods.isWindowOpen = function (now = new Date()) {
  const s = this.settings || {};
  if (s.startDate && now < new Date(s.startDate)) return false;
  if (s.endDate && now > new Date(s.endDate)) return false;
  return true;
};

module.exports = mongoose.model('Quiz', quizSchema);
