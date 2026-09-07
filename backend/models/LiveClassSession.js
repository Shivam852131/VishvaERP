const mongoose = require('mongoose');

const liveClassSessionSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  semester: { type: Number, required: true },
  department: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  roomName: { type: String, required: true, unique: true, trim: true },
  status: { type: String, enum: ['scheduled', 'active', 'ended'], default: 'active' },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('LiveClassSession', liveClassSessionSchema);
