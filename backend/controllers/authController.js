const asyncHandler = require('../middleware/asyncHandler');
const User = require('../models/User');
const College = require('../models/College');
const { generateToken, generateRefreshToken, verifyRefreshToken, generateResetToken } = require('../config/jwt');
const { validationResult } = require('express-validator');
const { sendPasswordResetEmail, sendWelcomeEmail } = require('../services/emailService');
const { logAudit } = require('../services/auditService');

const failedLoginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, email, password, role, collegeId, phone } = req.body;

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ success: false, message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)' });
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ success: false, message: 'Email already registered' });
  }

  let assignedCollegeId = collegeId;

  // Validate college for non-superadmin
  if (role !== 'superadmin' && assignedCollegeId) {
    const college = await College.findById(assignedCollegeId);
    if (!college || !college.isActive) {
      return res.status(400).json({ success: false, message: 'Invalid or inactive college' });
    }
  }

  // Auto-create a college if a collegeAdmin registers externally without an ID
  if (role === 'collegeAdmin' && !assignedCollegeId) {
    const newCollege = await College.create({
      name: `${name}'s College`,
      code: `COL-${Math.floor(1000 + Math.random() * 9000)}`,
      address: 'To be updated',
      isActive: true
    });
    assignedCollegeId = newCollege._id;
  }

  const user = await User.create({ name, email, password, role, collegeId: assignedCollegeId || null, phone });

  const token = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId });

  // Send welcome email in background (don't block registration)
  sendWelcomeEmail(email, name, 'Set via registration', role).catch(() => {});

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    token,
    refreshToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      collegeId: user.collegeId,
      avatar: user.avatar,
    },
  });
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;

  const attemptKey = email.toLowerCase();
  const attempts = failedLoginAttempts.get(attemptKey) || { count: 0, lockedUntil: null };

  if (attempts.lockedUntil && attempts.lockedUntil > Date.now()) {
    const remainingMinutes = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ success: false, message: `Account locked due to too many failed attempts. Try again in ${remainingMinutes} minutes.` });
  }

  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  if (!user.isActive) {
    return res.status(401).json({ success: false, message: 'Account has been deactivated' });
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    attempts.count += 1;
    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
      attempts.lockedUntil = Date.now() + LOCK_TIME;
    }
    failedLoginAttempts.set(attemptKey, attempts);
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  // Update last login
  user.lastLogin = new Date();
  failedLoginAttempts.delete(attemptKey);
  await user.save({ validateBeforeSave: false });

  logAudit(req, 'login', 'user', { resourceId: user._id, description: `User login: ${user.email}`, metadata: { role: user.role, collegeId: user.collegeId } });

  const token = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId });

  res.json({
    success: true,
    message: 'Login successful',
    token,
    refreshToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      collegeId: user.collegeId,
      avatar: user.avatar,
      lastLogin: user.lastLogin,
    },
  });
});

// @desc    Refresh token
// @route   POST /api/auth/refresh-token
// @access  Public (with refresh token)
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: 'Refresh token is required' });
  }

  try {
    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const newToken = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId });
    const newRefreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId });

    res.json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken,
    });
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json({ success: false, message: 'No account found with that email' });
  }

  const resetToken = generateResetToken();
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/#/reset-password/${resetToken}`;

  user.resetPasswordToken = resetToken;
  user.resetPasswordExpire = new Date(Date.now() + 3600000); // 1 hour
  await user.save({ validateBeforeSave: false });

  const result = await sendPasswordResetEmail(email, resetUrl, user.name);
  if (result.skipped) {
    return res.status(200).json({
      success: true,
      message: 'Password reset link generated (email not sent: email service not configured).',
      resetUrl: process.env.NODE_ENV === 'development' ? resetUrl : undefined,
    });
  }

  res.json({ success: true, message: 'Password reset link sent to your email' });
});

// @desc    Reset password
// @route   POST /api/auth/reset-password/:token
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }

  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpire: { $gt: new Date() },
  }).select('+password');

  if (!user) {
    return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .populate('collegeId', 'name code logo')
    .populate({
      path: 'children',
      select: 'name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt',
      populate: { path: 'collegeId', select: 'name code' },
    })
    .populate('parentId', 'name email phone');
  res.json({ success: true, user });
});

// @desc    Update profile
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, avatar } = req.body;
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { name, phone, avatar },
    { new: true, runValidators: true }
  );
  res.json({ success: true, message: 'Profile updated', user });
});

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  const isMatch = await user.matchPassword(currentPassword);
  if (!isMatch) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  }

  user.password = newPassword;
  await user.save();

  res.json({ success: true, message: 'Password changed successfully' });
});

module.exports = { register, login, refreshToken, forgotPassword, resetPassword, getMe, updateProfile, changePassword };
