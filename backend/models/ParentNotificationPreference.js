const mongoose = require('mongoose');

const parentNotificationPreferenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  channels: {
    push: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
    whatsapp: { type: Boolean, default: false },
  },
  preferences: {
    attendance: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
      threshold: { type: Number, default: 75, min: 0, max: 100 },
    },
    fees: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
      reminderDaysBefore: { type: Number, default: 7 },
    },
    exams: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
    },
    results: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
    },
    assignments: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
    notices: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
    liveClasses: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
    messages: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
    progressReport: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
    },
  },
  quietHours: {
    enabled: { type: Boolean, default: false },
    start: { type: String, default: '22:00' },
    end: { type: String, default: '07:00' },
    timezone: { type: String, default: 'Asia/Kolkata' },
  },
  language: { type: String, enum: ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'bn', 'gu', 'mr', 'pa'], default: 'en' },
  whatsappPhone: { type: String, trim: true },
  emailAddresses: [{ type: String, trim: true, lowercase: true }],
}, { timestamps: true });

parentNotificationPreferenceSchema.index({ userId: 1 });
parentNotificationPreferenceSchema.index({ collegeId: 1 });

module.exports = mongoose.model('ParentNotificationPreference', parentNotificationPreferenceSchema);
