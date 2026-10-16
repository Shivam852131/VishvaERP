const mongoose = require('mongoose');

/**
 * QuizAttempt — a single student's run through a Quiz. The server computes
 * deadlineAt (= startedAt + duration) and enforces it on autosave/submit.
 * Answers are autosaved incrementally so a refresh/resume never loses work.
 */

const answerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  response: { type: String },        // selected option text (mcq/true_false) or short text
  textAnswer: { type: String },      // free-text response (fill_blank / short_answer / long_answer)
  isCorrect: { type: Boolean },
  marksAwarded: { type: Number, default: 0 },
  negativeApplied: { type: Number, default: 0 },
  flagged: { type: Boolean, default: false },   // flag-for-review / bookmark during attempt
  timeSpent: { type: Number, default: 0 },      // seconds spent on this question
  answeredAt: { type: Date },
}, { _id: true });

const quizAttemptSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  attemptNo: { type: Number, default: 1 },
  questionOrder: [{ type: mongoose.Schema.Types.ObjectId }],  // per-attempt shuffled snapshot
  answers: [answerSchema],
  startedAt: { type: Date, default: Date.now },
  deadlineAt: { type: Date },        // server-computed enforcement point
  submittedAt: { type: Date },
  status: { type: String, enum: ['in_progress', 'completed', 'timed_out', 'abandoned'], default: 'in_progress' },
  autoSubmitted: { type: Boolean, default: false },
  score: { type: Number, default: 0 },          // positive marks only
  negativeMarks: { type: Number, default: 0 },  // total deducted
  totalMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  passed: { type: Boolean, default: false },
  timeTaken: { type: Number, default: 0 },      // seconds
  needsManualGrading: { type: Boolean, default: false },
  gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

quizAttemptSchema.index({ collegeId: 1, quizId: 1, studentId: 1 });
quizAttemptSchema.index({ collegeId: 1, studentId: 1, submittedAt: -1 });
quizAttemptSchema.index({ status: 1, deadlineAt: 1 });   // scheduler sweep
quizAttemptSchema.index({ quizId: 1, status: 1 });

module.exports = mongoose.model('QuizAttempt', quizAttemptSchema);
