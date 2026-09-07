const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  status: { type: String, enum: ['present', 'absent', 'late', 'excused'], default: 'absent' },
  remarks: { type: String },
  source: { type: String, enum: ['manual', 'smart-location'], default: 'manual' },
  timetableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Timetable' },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassroomLocation' },
  firstSeenAt: { type: Date },
  lastSeenAt: { type: Date },
  leftAt: { type: Date },
  confidence: { type: Number },
}, { timestamps: true });

attendanceSchema.index({ collegeId: 1, studentId: 1, subjectId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
