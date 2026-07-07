const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['course', 'faculty', 'institution', 'event'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, refPath: 'targetModel' },
  targetModel: { type: String, enum: ['Subject', 'User', 'College', 'Event'] },
  ratings: {
    content: { type: Number, min: 1, max: 5 },
    delivery: { type: Number, min: 1, max: 5 },
    communication: { type: Number, min: 1, max: 5 },
    overall: { type: Number, min: 1, max: 5 },
  },
  comment: { type: String },
  suggestions: { type: String },
  isAnonymous: { type: Boolean, default: false },
  semester: { type: Number },
  academicYear: { type: String },
}, { timestamps: true });

feedbackSchema.index({ collegeId: 1, type: 1 });
feedbackSchema.index({ collegeId: 1, targetId: 1 });
feedbackSchema.index({ collegeId: 1, userId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('Feedback', feedbackSchema);
