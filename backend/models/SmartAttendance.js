const mongoose = require('mongoose');

const classroomLocationSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  roomName: { type: String, required: true, trim: true },
  building: { type: String, trim: true },
  floor: { type: String, trim: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  radiusMeters: { type: Number, default: 35, min: 5, max: 250 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

classroomLocationSchema.index({ collegeId: 1, roomName: 1 }, { unique: true });

const locationConsentSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  enabled: { type: Boolean, default: false },
  consentVersion: { type: String, default: 'smart-attendance-v1' },
  grantedAt: { type: Date },
  revokedAt: { type: Date },
  grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

locationConsentSchema.index({ collegeId: 1, studentId: 1 }, { unique: true });

const livePresenceSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['student', 'faculty'], required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  timetableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Timetable', required: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassroomLocation' },
  sessionKey: { type: String, required: true },
  status: { type: String, enum: ['inside', 'outside', 'waitingTeacher', 'noClassroom'], default: 'outside' },
  latitude: { type: Number },
  longitude: { type: Number },
  accuracyMeters: { type: Number },
  distanceMeters: { type: Number },
  enteredAt: { type: Date },
  lastSeenAt: { type: Date, default: Date.now },
  exitedAt: { type: Date },
  autoAttendanceStatus: { type: String, enum: ['present', 'late', 'left', 'waiting', 'none'], default: 'none' },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

livePresenceSchema.index({ sessionKey: 1, userId: 1 }, { unique: true });
livePresenceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ClassroomLocation = mongoose.model('ClassroomLocation', classroomLocationSchema);
const LocationConsent = mongoose.model('LocationConsent', locationConsentSchema);
const LivePresence = mongoose.model('LivePresence', livePresenceSchema);

module.exports = { ClassroomLocation, LocationConsent, LivePresence };
