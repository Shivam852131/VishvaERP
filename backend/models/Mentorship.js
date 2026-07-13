const mongoose = require('mongoose');

const mentorshipSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  menteeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['career', 'academic', 'technical', 'peer'], default: 'career' },
  status: { type: String, enum: ['pending', 'active', 'paused', 'completed', 'rejected'], default: 'pending' },
  goals: [{ type: String, trim: true }],
  notes: { type: String },
  startDate: { type: Date },
  endDate: { type: Date },
  totalSessions: { type: Number, default: 0 },
  rating: { type: Number, min: 1, max: 5 },
  feedback: { type: String },
}, { timestamps: true });

mentorshipSchema.index({ collegeId: 1, mentorId: 1, status: 1 });
mentorshipSchema.index({ collegeId: 1, menteeId: 1, status: 1 });
mentorshipSchema.index({ collegeId: 1, mentorId: 1, menteeId: 1 }, { unique: true });

const mentorSessionSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  mentorshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Mentorship', required: true },
  mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  menteeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scheduledAt: { type: Date, required: true },
  duration: { type: Number, default: 30 },
  topic: { type: String, trim: true },
  status: { type: String, enum: ['scheduled', 'completed', 'cancelled', 'no-show'], default: 'scheduled' },
  meetingUrl: { type: String },
  location: { type: String },
  notes: { type: String },
  menteeFeedback: { type: String },
  mentorFeedback: { type: String },
  rating: { type: Number, min: 1, max: 5 },
}, { timestamps: true });

mentorSessionSchema.index({ collegeId: 1, mentorId: 1, scheduledAt: -1 });
mentorSessionSchema.index({ collegeId: 1, menteeId: 1, scheduledAt: -1 });

const Mentorship = mongoose.model('Mentorship', mentorshipSchema);
const MentorSession = mongoose.model('MentorSession', mentorSessionSchema);

module.exports = { Mentorship, MentorSession };
