const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  semester: { type: Number, required: true },
  department: { type: String },
  attachments: [{ type: String }],
  downloads: { type: Number, default: 0 },
  tags: [{ type: String, trim: true }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

noteSchema.index({ collegeId: 1, createdAt: -1 });
noteSchema.index({ collegeId: 1, subjectId: 1 });
noteSchema.index({ collegeId: 1, courseId: 1, semester: 1 });
noteSchema.index({ collegeId: 1, title: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Note', noteSchema);
