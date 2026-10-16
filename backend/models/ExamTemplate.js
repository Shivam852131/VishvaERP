const mongoose = require('mongoose');

const examTemplateSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  semester: { type: Number },
  units: [String],
  chapters: [String],
  difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'very_hard', 'mixed'], default: 'mixed' },
  questionDistribution: {
    mcq: { count: { type: Number, default: 0 }, marksEach: { type: Number, default: 1 } },
    true_false: { count: { type: Number, default: 0 }, marksEach: { type: Number, default: 1 } },
    fill_blank: { count: { type: Number, default: 0 }, marksEach: { type: Number, default: 1 } },
    short_answer: { count: { type: Number, default: 0 }, marksEach: { type: Number, default: 2 } },
    long_answer: { count: { type: Number, default: 0 }, marksEach: { type: Number, default: 5 } },
    numerical: { count: { type: Number, default: 0 }, marksEach: { type: Number, default: 3 } },
  },
  totalMarks: { type: Number, default: 0 },
  duration: { type: Number, default: 120 },
  instructions: { type: String, default: 'Answer all questions. Write clearly and legibly.' },
  isPublished: { type: Boolean, default: false },
  generatedPapers: [{
    generatedAt: Date,
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'QuestionBank' }],
    paperHash: String,
  }],
}, { timestamps: true });

examTemplateSchema.index({ collegeId: 1 });
examTemplateSchema.index({ collegeId: 1, subjectId: 1 });

module.exports = mongoose.model('ExamTemplate', examTemplateSchema);
