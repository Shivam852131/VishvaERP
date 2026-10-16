const mongoose = require('mongoose');

/**
 * QuestionBookmark — a student's saved/bookmarked questions for later revision.
 */
const questionBookmarkSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'QuestionBank', required: true },
  note: { type: String, maxlength: 500 },
}, { timestamps: true });

questionBookmarkSchema.index({ studentId: 1, questionId: 1 }, { unique: true });
questionBookmarkSchema.index({ collegeId: 1, studentId: 1, createdAt: -1 });

module.exports = mongoose.model('QuestionBookmark', questionBookmarkSchema);
