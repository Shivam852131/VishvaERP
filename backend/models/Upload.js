const mongoose = require('mongoose');

/**
 * Registry of uploaded files.
 *
 * Purpose: bind every uploaded artefact to the user who uploaded it so that
 * file deletion cannot be abused as a cross-user destruction primitive
 * (e.g. a student deleting another student's resume or a faculty member's
 * assignment submission by guessing/learning the file URL).
 */
const uploadSchema = new mongoose.Schema({
  url: { type: String, required: true, unique: true },
  filename: { type: String },
  originalName: { type: String },
  mimetype: { type: String },
  size: { type: Number, default: 0 },
  subdir: { type: String, default: 'temp' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedByEmail: { type: String },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
}, { timestamps: true });

uploadSchema.index({ uploadedBy: 1, createdAt: -1 });
uploadSchema.index({ collegeId: 1, createdAt: -1 });

module.exports = mongoose.model('Upload', uploadSchema);
