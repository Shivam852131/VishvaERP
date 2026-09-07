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
  isActive: { type: Boolean, default: true },
  usageCount: { type: Number, default: 0 },
}, { timestamps: true });

questionSchema.index({ collegeId: 1, subjectId: 1 });
questionSchema.index({ collegeId: 1, subjectId: 1, unit: 1, chapter: 1 });
questionSchema.index({ collegeId: 1, difficulty: 1 });

module.exports = mongoose.model('QuestionBank', questionSchema);
