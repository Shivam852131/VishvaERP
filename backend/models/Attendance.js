const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  collegeId:          { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  studentId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  facultyId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  date:               { type: Date, required: true },
  status:             { type: String, enum: ['present', 'absent', 'late', 'excused'], default: 'absent' },
  remarks:            { type: String },

  // Source & verification
  source:             { type: String, enum: ['manual', 'smart-location', 'face-id', 'qr-code', 'live-class'], default: 'manual' },
  verificationMethod: { type: String, enum: ['manual', 'smart-location', 'face-id', 'qr-code', 'live-class'], default: 'manual' },

  // Excuse workflow
  excuseReason:       { type: String },
  excusedBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  excusedAt:          { type: Date },

  // Smart location metadata
  timetableId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Timetable' },
  classroomId:        { type: mongoose.Schema.Types.ObjectId, ref: 'ClassroomLocation' },
  firstSeenAt:        { type: Date },
  lastSeenAt:         { type: Date },
  leftAt:             { type: Date },
  confidence:         { type: Number, min: 0, max: 100 },

  // Correction audit
  correctedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  correctedAt:        { type: Date },
  previousStatus:     { type: String },
}, { timestamps: true });

attendanceSchema.index({ collegeId: 1, studentId: 1, subjectId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ collegeId: 1, date: 1 });
attendanceSchema.index({ collegeId: 1, subjectId: 1, date: 1 });
attendanceSchema.index({ collegeId: 1, studentId: 1, date: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
