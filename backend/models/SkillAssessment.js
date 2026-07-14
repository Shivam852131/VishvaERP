const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  type: { type: String, enum: ['mcq', 'true_false', 'fill_blank', 'short_answer'], default: 'mcq' },
  options: [{ text: String, isCorrect: Boolean }],
  correctAnswer: { type: String },
  explanation: { type: String },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  points: { type: Number, default: 1 },
  skillTag: { type: String },
}, { _id: true });

const skillAssessmentSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String },
  category: { type: String, enum: ['technical', 'aptitude', 'domain', 'soft_skill', 'coding', 'custom'], required: true },
  skillTags: [{ type: String, trim: true }],
  difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'mixed'], default: 'medium' },
  questions: [questionSchema],
  timeLimit: { type: Number, default: 30 },
  totalPoints: { type: Number, default: 0 },
  passingScore: { type: Number, default: 60 },
  maxAttempts: { type: Number, default: 3 },
  isPublished: { type: Boolean, default: false },
  isPublic: { type: Boolean, default: true },
  attemptCount: { type: Number, default: 0 },
  avgScore: { type: Number, default: 0 },
  tags: [{ type: String }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

skillAssessmentSchema.index({ collegeId: 1, category: 1, isPublished: 1 });
skillAssessmentSchema.index({ collegeId: 1, skillTags: 1 });

const assessmentAttemptSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillAssessment', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  answers: [{
    questionId: mongoose.Schema.Types.ObjectId,
    selectedOption: String,
    textAnswer: String,
    isCorrect: Boolean,
    pointsEarned: { type: Number, default: 0 },
  }],
  score: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  passed: { type: Boolean, default: false },
  timeTaken: { type: Number },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  status: { type: String, enum: ['in_progress', 'completed', 'timed_out', 'abandoned'], default: 'in_progress' },
}, { timestamps: true });

assessmentAttemptSchema.index({ collegeId: 1, assessmentId: 1, studentId: 1 });
assessmentAttemptSchema.index({ collegeId: 1, studentId: 1, completedAt: -1 });

const SkillAssessment = mongoose.model('SkillAssessment', skillAssessmentSchema);
const AssessmentAttempt = mongoose.model('AssessmentAttempt', assessmentAttemptSchema);

module.exports = { SkillAssessment, AssessmentAttempt };
