const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  name: { type: String, required: true },
  code: { type: String, required: true },
  semester: { type: Number, required: true },
  credits: { type: Number, default: 3 },
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ['theory', 'practical', 'elective'], default: 'theory' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

subjectSchema.index({ collegeId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('Subject', subjectSchema);
