const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true },
  code: { type: String, required: true },
  department: { type: String, required: true },
  duration: { type: Number, default: 4 }, // years
  totalSemesters: { type: Number, default: 8 },
  description: { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

courseSchema.index({ collegeId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('Course', courseSchema);
