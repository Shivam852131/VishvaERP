const asyncHandler = require('../middleware/asyncHandler');
const User = require('../models/User');
const College = require('../models/College');
const OTP = require('../models/OTP');
const Subscription = require('../models/Subscription');
const { generateToken, generateRefreshToken, verifyRefreshToken, generateResetToken, hashResetToken } = require('../config/jwt');
const { validationResult } = require('express-validator');
const { sendPasswordResetEmail, sendWelcomeEmail, sendOTP: sendOTPEmail, sendVerificationOTP: sendVerificationOTPEmail } = require('../services/emailService');
const { sendWhatsApp } = require('../services/whatsappService');
const { logAudit } = require('../services/auditService');
const { OAuth2Client } = require('google-auth-library');

const crypto = require('crypto');
const googleClient = new OAuth2Client();

// Accepted Google OAuth client IDs. Configure GOOGLE_CLIENT_ID (single) or
// GOOGLE_CLIENT_IDS (comma-separated) on the server. Falls back to the client ID
// shipped with the frontend so Google sign-in works even before the env var is set.
const FALLBACK_GOOGLE_CLIENT_ID = '429796170500-daln01cn92kqh72vq46uumd8p7cgfg7l.apps.googleusercontent.com';
const GOOGLE_CLIENT_IDS = Array.from(new Set(
  `${process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || FALLBACK_GOOGLE_CLIENT_ID}`
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
));
if (!process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_IDS) {
  console.warn('[Google Auth] GOOGLE_CLIENT_ID is not set - using the default client ID from the frontend. Set GOOGLE_CLIENT_ID in .env for production.');
}

// Roles that may be provisioned through Google sign-in (superadmin is excluded on purpose)
const GOOGLE_PROVISION_ROLES = new Set(['student', 'faculty', 'parent', 'collegeAdmin']);

const failedLoginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes
const DEFAULT_TRIAL_DAYS = 30;

function buildTrialWindow(days = DEFAULT_TRIAL_DAYS) {
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days);
  return { startDate, endDate };
}

async function ensureCollegeTrialSubscription(collegeId, plan = 'basic') {
  if (!collegeId) return null;

  const activeSubscription = await Subscription.findOne({
    collegeId,
    status: 'active',
    endDate: { $gt: new Date() },
  });
  if (activeSubscription) {
    return activeSubscription;
  }

  const { startDate, endDate } = buildTrialWindow();
  const subscription = await Subscription.create({
    collegeId,
    plan,
    amount: 0,
    currency: 'INR',
    status: 'active',
    startDate,
    endDate,
    billingCycle: 'monthly',
  });

  await College.findByIdAndUpdate(collegeId, { plan, planExpiry: endDate }, { runValidators: false });
  return subscription;
}

async function hasActiveCollegeAccess(collegeId) {
  if (!collegeId) return false;

  const activeSubscription = await Subscription.findOne({
    collegeId,
    status: 'active',
    endDate: { $gt: new Date() },
  }).select('_id');
  if (activeSubscription) {
    return true;
  }

  const college = await College.findById(collegeId).select('planExpiry');
  return Boolean(college?.planExpiry && college.planExpiry > new Date());
}

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, email, password, role, collegeId, phone, collegeName } = req.body;

  // Strictly block any unauthenticated creation of superadmin or unapproved faculty accounts
  if (role === 'superadmin' || role === 'faculty') {
    return res.status(403).json({ success: false, message: 'Registration for this role is not permitted via public registration' });
  }

  const effectiveRole = role === 'collegeAdmin' ? 'collegeAdmin' : 'student';

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

  // Validate college for student
  if (effectiveRole !== 'superadmin' && assignedCollegeId) {
    const college = await College.findById(assignedCollegeId);
    if (!college || !college.isActive) {
      return res.status(400).json({ success: false, message: 'Invalid or inactive college' });
    }
  }

  // Auto-create a college if a collegeAdmin registers externally without an ID
  if (effectiveRole === 'collegeAdmin' && !assignedCollegeId) {
    const { endDate } = buildTrialWindow();
    const newCollege = await College.create({
      name: collegeName || `${name}'s College`,
      code: `COL-${Math.floor(1000 + Math.random() * 9000)}`,
      address: 'To be updated',
      email,
      phone,
      plan: 'basic',
      planExpiry: endDate,
      isActive: true
    });
    assignedCollegeId = newCollege._id;
  }

  const user = await User.create({ name, email, password, role: effectiveRole, collegeId: assignedCollegeId || null, phone, tokenVersion: 0 });

  if (effectiveRole === 'collegeAdmin' && assignedCollegeId) {
    await College.findByIdAndUpdate(assignedCollegeId, { adminId: user._id, email, phone }, { runValidators: false });
    await ensureCollegeTrialSubscription(assignedCollegeId, 'basic');
  }

  const token = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });

  // Send welcome email in background (don't block registration)
  sendWelcomeEmail(email, name, 'Set via registration', role).catch(() => {});

  const subscriptionActive = role === 'collegeAdmin' ? await hasActiveCollegeAccess(assignedCollegeId) : null;

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
    subscriptionActive,
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

  if (!user.password || typeof password !== 'string' || !password.trim()) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  let isMatch = false;
  try {
    isMatch = await user.matchPassword(password);
  } catch (matchErr) {
    isMatch = false;
  }
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

  const token = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });

  // For college admins, check subscription status
  let subscriptionActive = null;
  if (user.role === 'collegeAdmin' && user.collegeId) {
    subscriptionActive = await hasActiveCollegeAccess(user.collegeId);
  }

  let children = user.children || [];
  if (user.role === 'parent' && (!children || !children.length)) {
    const linked = await User.find({ collegeId: user.collegeId, role: 'student', parentId: user._id })
      .select('name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt')
      .populate('collegeId', 'name code');
    if (linked.length > 0) children = linked;
  }

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
      ...(user.role === 'parent' ? { children } : {}),
    },
    subscriptionActive,
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

    // Check token revocation
    if (decoded.tokenVersion !== undefined && user.tokenVersion !== undefined && decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ success: false, message: 'Refresh token has been revoked' });
    }

    const newToken = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });
    const newRefreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });

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

  const user = await User.findOne({ email: email.toLowerCase() });
  // Prevent user enumeration: Return same generic response even if email is not found
  if (!user) {
    return res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
  }

  const resetToken = generateResetToken();
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/#/reset-password/${resetToken}`;

  // Store SHA-256 hashed token to prevent database leak of active reset tokens
  user.resetPasswordToken = hashResetToken(resetToken);
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

  res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
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

  const hashedToken = hashResetToken(token);
  // Match hashed token, with legacy unhashed fallback for transition period
  let user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: new Date() },
  }).select('+password');

  if (!user) {
    user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpire: { $gt: new Date() },
    }).select('+password');
  }

  if (!user) {
    return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  // Increment tokenVersion to revoke all previously active sessions across all devices
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  logAudit(req, 'password_reset', 'user', { resourceId: user._id, description: `Password reset completed: ${user.email}` });

  res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  let user = await User.findById(req.user._id)
    .populate('collegeId', 'name code logo')
    .populate({
      path: 'children',
      select: 'name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt',
      populate: { path: 'collegeId', select: 'name code' },
    })
    .populate('parentId', 'name email phone');

  if (user && user.role === 'parent' && (!user.children || !user.children.length)) {
    const linkedChildren = await User.find({ collegeId: user.collegeId, role: 'student', parentId: user._id })
      .select('name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt')
      .populate('collegeId', 'name code');
    if (linkedChildren.length > 0) {
      user = user.toObject();
      user.children = linkedChildren;
    }
  }

  res.json({ success: true, user });
});

// @desc    Update profile
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = asyncHandler(async (req, res) => {
  const GENDERS = ['male', 'female', 'other'];
  const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const updates = {};
  const body = req.body || {};

  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ success: false, message: 'Name must be between 2 and 80 characters' });
    }
    updates.name = name;
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone || '').trim();
    if (phone && !/^[+\d][\d\s()-]{5,19}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Enter a valid phone number' });
    }
    updates.phone = phone;
  }
  if (body.avatar !== undefined) {
    const avatar = String(body.avatar || '').trim();
    if (avatar && !/^(\/uploads\/|https?:\/\/)/.test(avatar)) {
      return res.status(400).json({ success: false, message: 'Avatar must be an uploaded file URL' });
    }
    updates.avatar = avatar || null;
  }
  if (body.gender !== undefined) {
    const gender = String(body.gender || '').trim();
    if (gender && !GENDERS.includes(gender)) {
      return res.status(400).json({ success: false, message: 'Invalid gender value' });
    }
    updates.gender = gender || null;
  }
  if (body.dateOfBirth !== undefined) {
    const raw = String(body.dateOfBirth || '').trim();
    if (raw) {
      const dob = new Date(raw);
      if (Number.isNaN(dob.getTime()) || dob > new Date() || dob.getFullYear() < 1900) {
        return res.status(400).json({ success: false, message: 'Enter a valid date of birth' });
      }
      updates.dateOfBirth = dob;
    } else {
      updates.dateOfBirth = null;
    }
  }
  if (body.address !== undefined) {
    const address = String(body.address || '').trim();
    if (address.length > 300) {
      return res.status(400).json({ success: false, message: 'Address must be under 300 characters' });
    }
    updates.address = address;
  }
  if (body.bloodGroup !== undefined) {
    const bloodGroup = String(body.bloodGroup || '').trim().toUpperCase();
    if (bloodGroup && !BLOOD_GROUPS.includes(bloodGroup)) {
      return res.status(400).json({ success: false, message: 'Invalid blood group' });
    }
    updates.bloodGroup = bloodGroup || null;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, message: 'No valid fields to update' });
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  res.json({ success: true, message: 'Profile updated', user });
});

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ success: false, message: 'Current password and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, message: 'New password must be different from the current one' });
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!user || !user.password) {
    return res.status(400).json({ success: false, message: 'Current password is not set or account not found' });
  }

  let isMatch = false;
  try {
    isMatch = await user.matchPassword(currentPassword);
  } catch (err) {
    isMatch = false;
  }
  if (!isMatch) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  }

  user.password = newPassword;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  logAudit(req, 'password_change', 'user', { resourceId: user._id, description: `Password changed for: ${user.email}` });

  res.json({ success: true, message: 'Password changed successfully' });
});

// @desc    Send OTP to email
// @route   POST /api/auth/send-otp
// @access  Public
const sendOTPHandler = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  // Generate 6-digit OTP
  const otpCode = crypto.randomInt(100000, 999999).toString();

  // Delete any existing OTPs for this email
  await OTP.deleteMany({ email: email.toLowerCase(), verified: false });

  // Store OTP in database (expires in 10 minutes)
  await OTP.create({
    email: email.toLowerCase(),
    otp: otpCode,
    type: 'login',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  // Send OTP via email
  const result = await sendOTPEmail(email, otpCode);
  if (result.skipped) {
    return res.status(200).json({
      success: true,
      message: 'OTP generated (email not sent: email service not configured).',
      otp: process.env.NODE_ENV === 'development' ? otpCode : undefined,
    });
  }

  res.json({ success: true, message: 'OTP sent to your email' });
});

// @desc    Verify OTP and login
// @route   POST /api/auth/verify-otp-login
// @access  Public
const verifyOTPLogin = asyncHandler(async (req, res) => {
  const { email, otp, role } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP are required' });
  }

  // Find OTP record
  const otpRecord = await OTP.findOne({
    email: email.toLowerCase(),
    type: 'login',
    verified: false,
    expiresAt: { $gt: new Date() },
  });

  if (!otpRecord) {
    return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
  }

  // Check attempts
  if (otpRecord.attempts >= 5) {
    return res.status(429).json({ success: false, message: 'Too many OTP attempts. Please request a new code.' });
  }

  // Verify OTP
  if (otpRecord.otp !== otp) {
    otpRecord.attempts += 1;
    await otpRecord.save();
    return res.status(400).json({ success: false, message: 'Invalid OTP' });
  }

  // Mark OTP as verified
  otpRecord.verified = true;
  await otpRecord.save();

  // Find or create user
  let user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    // Auto-create user with OTP login (disallow superadmin/faculty/collegeAdmin privilege escalation)
    const userRole = (role === 'student' || role === 'parent') ? role : 'student';
    user = await User.create({
      name: email.split('@')[0],
      email: email.toLowerCase(),
      password: crypto.randomBytes(16).toString('hex'),
      role: userRole,
      tokenVersion: 0,
    });
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  logAudit(req, 'otp-login', 'user', { resourceId: user._id, description: `OTP login: ${user.email}`, metadata: { role: user.role } });

  const token = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });

  let subscriptionActive = null;
  if (user.role === 'collegeAdmin' && user.collegeId) {
    subscriptionActive = await hasActiveCollegeAccess(user.collegeId);
  }

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
    subscriptionActive,
  });
});

// @desc    Send verification OTP for registration
// @route   POST /api/auth/send-verification-otp
// @access  Public
const sendVerificationOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(404).json({ success: false, message: 'No account found with that email' });
  }

  // Generate 6-digit OTP
  const otpCode = crypto.randomInt(100000, 999999).toString();

  // Store OTP
  await OTP.deleteMany({ email: email.toLowerCase(), type: 'registration', verified: false });
  await OTP.create({
    email: email.toLowerCase(),
    otp: otpCode,
    type: 'registration',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const result = await sendVerificationOTPEmail(email, otpCode, user.name);
  if (result.skipped) {
    return res.status(200).json({
      success: true,
      message: 'Verification OTP generated (email not sent: email service not configured).',
      otp: process.env.NODE_ENV === 'development' ? otpCode : undefined,
    });
  }

  res.json({ success: true, message: 'Verification code sent to your email' });
});

// @desc    Verify email with OTP
// @route   POST /api/auth/verify-email
// @access  Public
const verifyEmail = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP are required' });
  }

  const otpRecord = await OTP.findOne({
    email: email.toLowerCase(),
    type: 'registration',
    verified: false,
    expiresAt: { $gt: new Date() },
  });

  if (!otpRecord) {
    return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
  }

  if (otpRecord.otp !== otp) {
    otpRecord.attempts += 1;
    await otpRecord.save();
    return res.status(400).json({ success: false, message: 'Invalid verification code' });
  }

  otpRecord.verified = true;
  await otpRecord.save();

  // Mark user as verified (add field to User model if needed)
  await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { isEmailVerified: true }
  );

  res.json({ success: true, message: 'Email verified successfully' });
});

// @desc    Get device trust status
// @route   POST /api/auth/check-device
// @access  Public
const checkDevice = asyncHandler(async (req, res) => {
  const { email, deviceFingerprint } = req.body;

  if (!email || !deviceFingerprint) {
    return res.status(400).json({ success: false, trusted: false });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(404).json({ success: false, trusted: false });
  }

  const trustedDevice = user.trustedDevices?.find(d => d.fingerprint === deviceFingerprint);
  const isTrusted = trustedDevice && trustedDevice.expiresAt > new Date();

  res.json({ success: true, trusted: isTrusted });
});

// @desc    Login/Register with Google OAuth
// @route   POST /api/auth/google-login
// @access  Public
// Known-good origin used as a control when probing Google, so we never warn the
// user just because Google refused our own server-side request. It must be an
// origin that is already listed in "Authorized JavaScript origins".
function controlGoogleOrigin() {
  const override = `${process.env.GOOGLE_ALLOWED_ORIGIN_PROBE || ''}`.trim().replace(/\/+$/, '');
  return override || 'https://vishvaerp.vercel.app';
}

async function probeGoogleOrigin(origin) {
  const url = `https://accounts.google.com/gsi/button?client_id=${encodeURIComponent(GOOGLE_CLIENT_IDS[0])}&theme=outline&size=large`;
  try {
    const response = await fetch(url, {
      headers: {
        Origin: origin,
        // Google rejects the default Node/undici user agent outright (403 for every
        // origin), which would make every origin look "blocked". Send a browser one.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: '*/*',
      },
      redirect: 'manual',
    });
    return response.status;
  } catch (err) {
    console.warn('[Google Auth] Origin probe failed:', err.message);
    return null;
  }
}

// @desc    Tell the frontend whether this origin is allowed to use Google Sign-In
// @route   POST /api/auth/google-origin-check
// @access  Public
const googleOriginCheck = asyncHandler(async (req, res) => {
  const origin = typeof req.body.origin === 'string' ? req.body.origin.trim().replace(/\/+$/, '') : '';
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
    return res.status(400).json({ success: false, message: 'Invalid origin' });
  }

  const [status, controlStatus] = await Promise.all([
    probeGoogleOrigin(origin),
    probeGoogleOrigin(controlGoogleOrigin()),
  ]);

  if (status === null || controlStatus === null) {
    // Google unreachable (or blocking our probe): report "unknown", never a false alarm.
    return res.json({ success: true, allowed: null });
  }

  const controlAllowed = controlStatus !== 403;
  res.json({ success: true, allowed: controlAllowed ? status !== 403 : null });
});

const googleLogin = asyncHandler(async (req, res) => {
  const { credential, role } = req.body;
  if (!credential) {
    return res.status(400).json({ success: false, message: 'Google credential is required' });
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_IDS,
    });
  } catch (err) {
    console.error('[Google Auth] Token verification failed:', err.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired Google credential' });
  }

  const payload = ticket.getPayload();
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Invalid Google credential' });
  }

  const tokenAudience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!tokenAudience.some((aud) => GOOGLE_CLIENT_IDS.includes(aud))) {
    return res.status(401).json({ success: false, message: 'Google credential was issued for a different application' });
  }

  const { sub: googleId, email, name, picture } = payload;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email not available from Google account' });
  }

  if (payload.email_verified !== true) {
    return res.status(403).json({ success: false, message: 'Your Google account email address is not verified' });
  }

  let user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    if (role && !GOOGLE_PROVISION_ROLES.has(role)) {
      return res.status(403).json({
        success: false,
        message: `${role} accounts cannot be created with Google sign-in. Pick another role or sign in with your password.`,
      });
    }
    const userRole = GOOGLE_PROVISION_ROLES.has(role) ? role : 'student';

    // College admins get their own college + trial subscription (same as normal registration)
    let assignedCollegeId = null;
    if (userRole === 'collegeAdmin') {
      const { endDate } = buildTrialWindow();
      const newCollege = await College.create({
        name: `${name || email.split('@')[0]}'s College`,
        code: `COL-${Math.floor(1000 + Math.random() * 9000)}`,
        address: 'To be updated',
        email: email.toLowerCase(),
        plan: 'basic',
        planExpiry: endDate,
        isActive: true,
      });
      assignedCollegeId = newCollege._id;
    }

    user = await User.create({
      name: name || email.split('@')[0],
      email: email.toLowerCase(),
      password: crypto.randomBytes(32).toString('hex'),
      role: userRole,
      collegeId: assignedCollegeId,
      avatar: picture || null,
      isEmailVerified: true,
      googleId,
    });

    if (userRole === 'collegeAdmin' && assignedCollegeId) {
      await College.findByIdAndUpdate(assignedCollegeId, { adminId: user._id }, { runValidators: false });
      await ensureCollegeTrialSubscription(assignedCollegeId, 'basic');
    }
  } else if (!user.googleId) {
    user.googleId = googleId;
    if (picture && !user.avatar) user.avatar = picture;
    await user.save({ validateBeforeSave: false });
  }

  if (!user.isActive) {
    return res.status(401).json({ success: false, message: 'Account has been deactivated' });
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  logAudit(req, 'google-login', 'user', { resourceId: user._id, description: `Google login: ${user.email}`, metadata: { role: user.role } });

  const token = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });

  let subscriptionActive = null;
  if (user.role === 'collegeAdmin' && user.collegeId) {
    subscriptionActive = await hasActiveCollegeAccess(user.collegeId);
  }

  let children = user.children || [];
  if (user.role === 'parent' && (!children || !children.length)) {
    const linked = await User.find({ collegeId: user.collegeId, role: 'student', parentId: user._id })
      .select('name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt')
      .populate('collegeId', 'name code');
    if (linked.length > 0) children = linked;
  }

  res.json({
    success: true,
    message: 'Google login successful',
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
      ...(user.role === 'parent' ? { children } : {}),
    },
    subscriptionActive,
  });
});

// @desc    Send OTP to phone via WhatsApp
// @route   POST /api/auth/send-phone-otp
// @access  Public
const sendPhoneOTP = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, message: 'Phone number is required' });
  }

  const cleaned = phone.replace(/\s/g, '');
  const phoneRegex = /^\+[1-9]\d{6,14}$/;
  if (!phoneRegex.test(cleaned)) {
    return res.status(400).json({ success: false, message: 'Invalid phone number format. Use +[country][number] (e.g. +919876543210)' });
  }

  const otpCode = crypto.randomInt(100000, 999999).toString();

  await OTP.deleteMany({ phone: cleaned, type: 'phone-login', verified: false });

  await OTP.create({
    phone: cleaned,
    otp: otpCode,
    type: 'phone-login',
    channel: 'whatsapp',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const result = await sendWhatsApp(cleaned,
    `🔐 *VishvaERP Login OTP*\n\nYour verification code is:\n\n*${otpCode}*\n\nThis code expires in 10 minutes.\nDo not share this code with anyone.\n\n- VishvaERP Team`
  );

  if (result.success) {
    res.json({ success: true, message: 'OTP sent to your WhatsApp', sid: result.sid });
  } else {
    res.status(200).json({
      success: true,
      message: 'OTP generated (WhatsApp not delivered).',
      otp: process.env.NODE_ENV === 'development' ? otpCode : undefined,
      debug: result.message,
    });
  }
});

// @desc    Verify phone OTP and login
// @route   POST /api/auth/verify-phone-otp
// @access  Public
const verifyPhoneOTP = asyncHandler(async (req, res) => {
  const { phone, otp, role } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ success: false, message: 'Phone and OTP are required' });
  }

  const cleaned = phone.replace(/\s/g, '');

  const otpRecord = await OTP.findOne({
    phone: cleaned,
    type: 'phone-login',
    verified: false,
    expiresAt: { $gt: new Date() },
  });

  if (!otpRecord) {
    return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
  }

  if (otpRecord.attempts >= 5) {
    return res.status(429).json({ success: false, message: 'Too many OTP attempts. Please request a new code.' });
  }

  if (otpRecord.otp !== otp) {
    otpRecord.attempts += 1;
    await otpRecord.save();
    return res.status(400).json({ success: false, message: 'Invalid OTP' });
  }

  otpRecord.verified = true;
  await otpRecord.save();

  let user = await User.findOne({ phone: cleaned });

  if (!user) {
    const userRole = (role === 'student' || role === 'parent') ? role : 'student';
    user = await User.create({
      name: `User ${cleaned.slice(-4)}`,
      email: `phone_${cleaned.replace('+', '')}@vishvaerp.local`,
      phone: cleaned,
      password: crypto.randomBytes(16).toString('hex'),
      role: userRole,
      tokenVersion: 0,
    });
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  logAudit(req, 'phone-otp-login', 'user', { resourceId: user._id, description: `Phone OTP login: ${cleaned}`, metadata: { role: user.role } });

  const token = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });

  let subscriptionActive = null;
  if (user.role === 'collegeAdmin' && user.collegeId) {
    subscriptionActive = await hasActiveCollegeAccess(user.collegeId);
  }

  res.json({
    success: true,
    message: 'Login successful',
    token,
    refreshToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      collegeId: user.collegeId,
      avatar: user.avatar,
      lastLogin: user.lastLogin,
    },
    subscriptionActive,
  });
});

// @desc    Logout user and invalidate active tokens
// @route   POST /api/auth/logout
// @access  Private
const logout = asyncHandler(async (req, res) => {
  if (req.user) {
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    await req.user.save({ validateBeforeSave: false });
    logAudit(req, 'logout', 'user', { resourceId: req.user._id, description: `User logged out: ${req.user.email}` });
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
  changePassword,
  sendOTPHandler,
  verifyOTPLogin,
  sendVerificationOTP,
  verifyEmail,
  checkDevice,
  googleLogin,
  googleOriginCheck,
  sendPhoneOTP,
  verifyPhoneOTP,
};
