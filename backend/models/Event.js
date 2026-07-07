const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  title: { type: String, required: true },
  description: { type: String },
  category: { type: String, enum: ['academic', 'cultural', 'sports', 'technical', 'workshop', 'seminar', 'holiday', 'examination', 'other'], required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  startTime: { type: String },
  endTime: { type: String },
  venue: { type: String },
  isVirtual: { type: Boolean, default: false },
  meetingLink: { type: String },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetAudience: [{ type: String, enum: ['all', 'student', 'faculty', 'parent', 'collegeAdmin'] }],
  departments: [String],
  maxParticipants: { type: Number },
  registrations: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    registeredAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['registered', 'waitlisted', 'cancelled'], default: 'registered' },
  }],
  attachments: [{ type: String }],
  coverImage: { type: String },
  isPublic: { type: Boolean, default: true },
  isRecurring: { type: Boolean, default: false },
  recurrenceRule: { type: String },
  color: { type: String },
  status: { type: String, enum: ['draft', 'published', 'ongoing', 'completed', 'cancelled'], default: 'published' },
}, { timestamps: true });

eventSchema.index({ collegeId: 1, startDate: 1 });
eventSchema.index({ collegeId: 1, category: 1 });
eventSchema.index({ collegeId: 1, status: 1 });

module.exports = mongoose.model('Event', eventSchema);
