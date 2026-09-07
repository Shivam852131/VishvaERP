const mongoose = require('mongoose');

const noticeSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  type: { type: String, enum: ['general', 'exam', 'holiday', 'event', 'urgent'], default: 'general' },
  targetRoles: [{ type: String, enum: ['all', 'student', 'faculty', 'parent', 'collegeAdmin'] }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  attachments: [{ type: String }],
  expiryDate: { type: Date },
  isPinned: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

noticeSchema.index({ collegeId: 1, expiryDate: 1 });
noticeSchema.index({ collegeId: 1, isActive: 1 });

module.exports = mongoose.model('Notice', noticeSchema);
