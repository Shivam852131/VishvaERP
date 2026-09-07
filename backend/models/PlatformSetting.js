const mongoose = require('mongoose');

const platformSettingSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'platform' },
  general: {
    platformName: { type: String, default: 'VishvaERP' },
    supportEmail: { type: String, default: 'support@vishvaerp.com' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    maintenanceMode: { type: Boolean, default: false },
    publicRegistration: { type: Boolean, default: true },
  },
  security: {
    require2FA: { type: Boolean, default: true },
    strongPasswords: { type: Boolean, default: true },
    sessionTimeoutMinutes: { type: Number, default: 120 },
  },
  email: {
    fromName: { type: String, default: 'VishvaERP' },
    fromEmail: { type: String, default: 'noreply@vishvaerp.com' },
    smtpHost: { type: String, default: '' },
    smtpPort: { type: Number, default: 587 },
    smtpSecure: { type: Boolean, default: false },
    smtpUser: { type: String, default: '' },
  },
  storage: {
    provider: { type: String, default: 'local' },
    bucketName: { type: String, default: '' },
    baseUrl: { type: String, default: '' },
  },
  ai: {
    apiKey: { type: String, default: '' },
    defaultModel: { type: String, default: 'gemini-1.5-pro' },
    enabled: { type: Boolean, default: true },
  },
}, { timestamps: true });

module.exports = mongoose.model('PlatformSetting', platformSettingSchema);
