const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role: {
    type: String,
    enum: ['superadmin', 'collegeAdmin', 'faculty', 'student', 'parent'],
    required: true,
  },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', default: null },
  phone: { type: String, trim: true },
  address: { type: String, trim: true },
  dateOfBirth: { type: Date, default: null },
  gender: { type: String, enum: ['male', 'female', 'other'], default: null },
  bloodGroup: { type: String, trim: true },
  admissionDate: { type: Date, default: null },
  enrollmentNo: { type: String, trim: true },
  section: { type: String, trim: true },
  avatar: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  // Student specific
  rollNo: { type: String },
  semester: { type: Number },
  department: { type: String },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Faculty specific
  designation: { type: String },
  subjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
  // Parent specific
  children: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deviceTokens: [{
    token: { type: String, required: true },
    platform: { type: String, enum: ['web', 'android', 'ios'], default: 'web' },
    updatedAt: { type: Date, default: Date.now },
  }],
  trustedDevices: [{
    fingerprint: { type: String, required: true },
    name: { type: String },
    lastUsed: { type: Date, default: Date.now },
    expiresAt: { type: Date },
  }],
  isEmailVerified: { type: Boolean, default: false },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String },
  googleId: { type: String, sparse: true },
  resetPasswordToken: { type: String },
  resetPasswordExpire: { type: Date },
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Don't return password in JSON
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
