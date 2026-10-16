const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    lowercase: true,
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  otp: {
    type: String,
    required: true,
  },
  channel: {
    type: String,
    enum: ['email', 'whatsapp', 'sms'],
    default: 'email',
  },
  type: {
    type: String,
    enum: ['login', 'registration', 'password-reset', 'phone-login'],
    default: 'login',
  },
  role: {
    type: String,
    enum: ['superadmin', 'collegeAdmin', 'faculty', 'student', 'parent'],
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
  attempts: {
    type: Number,
    default: 0,
    max: 5,
  },
  verified: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

otpSchema.index({ email: 1, type: 1 });
otpSchema.index({ phone: 1, type: 1 });

module.exports = mongoose.model('OTP', otpSchema);
