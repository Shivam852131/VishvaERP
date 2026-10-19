const mongoose = require('mongoose');

const collegeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  email: { type: String, trim: true },
  phone: { type: String },
  address: { type: String },
  city: { type: String },
  state: { type: String },
  country: { type: String, default: 'India' },
  logo: { type: String, default: null },
  website: { type: String },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  isActive: { type: Boolean, default: true },
  plan: { type: String, enum: ['basic', 'pro', 'enterprise'], default: 'basic' },
  planExpiry: { type: Date },
  departments: [{ type: String }],
  totalStudents: { type: Number, default: 0 },
  totalFaculty: { type: Number, default: 0 },
  settings: {
    academicYear: { type: String },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    gradingSystem: { type: String, enum: ['percentage', 'gpa', 'cgpa'], default: 'cgpa' },
  },
  // Per-college portal theming (managed by the College Admin, visible to all
  // portal users of this college). Empty values = use platform defaults.
  theme: {
    portalName: { type: String, default: '' },
    tagline: { type: String, default: '' },
    primaryColor: { type: String, default: '' },
    accentColor: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
  },
}, { timestamps: true });

module.exports = mongoose.model('College', collegeSchema);
