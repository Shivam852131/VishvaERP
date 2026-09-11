const mongoose = require('mongoose');

const liveClassSessionSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  semester: { type: Number, required: true },
  department: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  roomName: { type: String, required: true, unique: true, trim: true },
  status: { type: String, enum: ['scheduled', 'active', 'ended'], default: 'active' },
  scheduledStartTime: { type: Date },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },

  // Video recording and lecture materials
  recordingUrl: { type: String, default: '' },
  recordingDuration: { type: Number, default: 0 }, // in minutes
  whiteboardData: { type: String, default: '' }, // serialized drawing / snapshot data
  materials: [{
    title: { type: String, required: true },
    url: { type: String, required: true },
    type: { type: String, default: 'link' }, // pdf, slide, link, code
    size: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  }],

  // Participant attendance roster
  attendees: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    rollNumber: { type: String, default: '' },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date },
    durationMinutes: { type: Number, default: 0 },
    handRaised: { type: Boolean, default: false },
  }],

  // Official ERP attendance sync tracking
  attendanceSynced: { type: Boolean, default: false },
  syncedAttendanceCount: { type: Number, default: 0 },
  syncedAt: { type: Date },

  // In-session live chat & Q&A log
  chatMessages: [{
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderName: { type: String, required: true },
    role: { type: String, default: 'student' },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  }],

  // In-session quick pulse poll
  activePoll: {
    question: { type: String, default: '' },
    options: [{
      id: { type: String, default: '' },
      text: { type: String, default: '' },
      votes: { type: Number, default: 0 },
    }],
    isOpen: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    voters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },

  tags: [{ type: String }],
}, { timestamps: true });

liveClassSessionSchema.index({ collegeId: 1, department: 1, semester: 1, status: 1 });
liveClassSessionSchema.index({ collegeId: 1, facultyId: 1, status: 1 });

module.exports = mongoose.model('LiveClassSession', liveClassSessionSchema);
