const asyncHandler = require('../middleware/asyncHandler');
const verifyService = require('../services/twilioVerifyService');
const User = require('../models/User');
const { generateToken, generateRefreshToken } = require('../config/jwt');
const { logAudit } = require('../services/auditService');

// Roles that may ever be provisioned through a public verification flow.
// Without this allow-list any anonymous caller could self-register as
// `superadmin` (privilege escalation) - the same guard exists in
// authController.register / verifyOTPLogin / googleLogin.
const PUBLIC_PROVISION_ROLES = new Set(['student', 'parent']);

const resolveRequestedRole = (role) => (PUBLIC_PROVISION_ROLES.has(role) ? role : 'student');

const getChannels = asyncHandler(async (req, res) => {
  const configured = verifyService.isVerifyConfigured();
  const channels = Object.keys(verifyService.CHANNELS).map((key) => ({
    id: key,
    name: key.charAt(0).toUpperCase() + key.slice(1).replace('totp', 'TOTP').replace('sna', 'SNA'),
    enabled: configured,
  }));
  res.json({ success: true, configured, channels });
});

const sendCode = asyncHandler(async (req, res) => {
  const { phone, email, channel, locale } = req.body;
  const to = channel === 'email' ? email : phone;
  if (!to || !channel) {
    return res.status(400).json({ success: false, message: 'Phone/email and channel are required' });
  }
  const result = await verifyService.sendVerification(to, channel, { locale });
  if (result.success) {
    logAudit(req, 'send-verification', 'auth', { description: `Sent ${channel} verification to ${to}` });
  }
  res.json(result);
});

const checkCode = asyncHandler(async (req, res) => {
  const { phone, email, code, channel } = req.body;
  const to = channel === 'email' ? email : phone;
  if (!to || !code || !channel) {
    return res.status(400).json({ success: false, message: 'Phone/email, code, and channel are required' });
  }
  const result = await verifyService.checkVerification(to, code, channel);
  res.json(result);
});

const verifyAndLogin = asyncHandler(async (req, res) => {
  const { phone, email, code, channel, role } = req.body;
  const to = channel === 'email' ? email : phone;
  if (!to || !code || !channel) {
    return res.status(400).json({ success: false, message: 'Phone/email, code, and channel are required' });
  }

  const result = await verifyService.checkVerification(to, code, channel);
  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message || 'Invalid verification code' });
  }

  let user = phone
    ? await User.findOne({ phone })
    : await User.findOne({ email: email?.toLowerCase() });

  if (!user) {
    const isPhone = Boolean(phone);
    user = await User.create({
      name: isPhone ? `User ${phone.slice(-4)}` : (email?.split('@')[0] || 'User'),
      email: isPhone ? `verified_${phone.replace('+', '')}@vishvaerp.local` : email.toLowerCase(),
      phone: phone || undefined,
      password: require('crypto').randomBytes(16).toString('hex'),
      // Role is server-controlled: a public caller can never ask for an
      // administrative role.
      role: resolveRequestedRole(role),
      isEmailVerified: channel === 'email',
      tokenVersion: 0,
    });
  }

  if (!user.isActive) {
    return res.status(401).json({ success: false, message: 'Account has been deactivated' });
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  logAudit(req, 'multi-channel-login', 'user', {
    resourceId: user._id,
    description: `${channel} verification login: ${to}`,
    metadata: { role: user.role, channel },
  });

  const token = generateToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });
  const refreshToken = generateRefreshToken({ id: user._id, role: user.role, collegeId: user.collegeId, tokenVersion: user.tokenVersion || 0 });

  let subscriptionActive = null;
  if (user.role === 'collegeAdmin' && user.collegeId) {
    const { hasActiveCollegeAccess } = require('../services/subscriptionService');
    subscriptionActive = await hasActiveCollegeAccess(user.collegeId);
  }

  res.json({
    success: true,
    message: 'Verification successful',
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

const setupTotp = asyncHandler(async (req, res) => {
  const { label } = req.body;
  const identity = req.user._id.toString();
  const result = await verifyService.createTotpSecret(label || req.user.name);
  if (result.success) {
    logAudit(req, 'setup-totp', 'user', { resourceId: req.user._id, description: 'TOTP authenticator setup' });
  }
  res.json(result);
});

const verifyTotp = asyncHandler(async (req, res) => {
  const { code, factorSid } = req.body;
  const identity = req.user._id.toString();
  if (!code || !factorSid) {
    return res.status(400).json({ success: false, message: 'Code and factorSid are required' });
  }
  const result = await verifyService.verifyTotp(identity, code, factorSid);
  res.json(result);
});

/**
 * Verification attempt history.
 *
 * This endpoint is reachable without a session (the OTP screen needs it), so
 * the response is deliberately minimised: no Twilio SIDs, no raw provider
 * payload - only how many codes were requested and whether the last one was
 * approved. Without this an anonymous caller could enumerate registered
 * phone numbers / e-mail addresses and harvest OTP-guessing intelligence.
 */
const getAttempts = asyncHandler(async (req, res) => {
  const { phone, email } = req.query;
  const to = email || phone;

  if (!to || typeof to !== 'string') {
    return res.status(400).json({ success: false, message: 'Phone or email required' });
  }

  const value = to.trim();
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  const looksLikePhone = /^\+?[1-9]\d{6,14}$/.test(value.replace(/[\s()-]/g, ''));
  if (!looksLikeEmail && !looksLikePhone) {
    return res.status(400).json({ success: false, message: 'Invalid phone or email format' });
  }

  const result = await verifyService.getVerificationAttempts(value);
  if (!result.success) {
    return res.status(200).json({ success: false, count: 0, approved: false, lastStatus: null, message: 'Verification service unavailable' });
  }

  const attempts = Array.isArray(result.attempts) ? result.attempts : [];
  res.json({
    success: true,
    count: attempts.length,
    approved: attempts.some((attempt) => attempt.status === 'approved'),
    lastStatus: attempts.length ? attempts[0].status : null,
  });
});

module.exports = { getChannels, sendCode, checkCode, verifyAndLogin, setupTotp, verifyTotp, getAttempts };
