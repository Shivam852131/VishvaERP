const express = require('express');
const { register, login, logout, refreshToken, forgotPassword, resetPassword, getMe, updateProfile, changePassword, sendOTPHandler, verifyOTPLogin, sendVerificationOTP, verifyEmail, checkDevice, googleLogin, googleOriginCheck, sendPhoneOTP, verifyPhoneOTP } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { body } = require('express-validator');

const router = express.Router();

// Public registration: strictly prohibit 'superadmin' and unapproved 'faculty'
router.post('/register', authLimiter, [
  body('name', 'Name is required').notEmpty().trim(),
  body('email', 'Please include a valid email').isEmail().normalizeEmail(),
  body('password', 'Password must be 6 or more characters').isLength({ min: 6 }),
  body('role', 'Valid registration role is required (collegeAdmin or student)').isIn(['collegeAdmin', 'student'])
], register);

router.post('/login', authLimiter, [
  body('email', 'Please include a valid email').isEmail().normalizeEmail(),
  body('password', 'Password is required').isString().notEmpty()
], login);

router.post('/send-otp', authLimiter, sendOTPHandler);
router.post('/verify-otp-login', authLimiter, verifyOTPLogin);
router.post('/send-phone-otp', authLimiter, sendPhoneOTP);
router.post('/verify-phone-otp', authLimiter, verifyPhoneOTP);
router.post('/send-verification-otp', authLimiter, sendVerificationOTP);
router.post('/verify-email', verifyEmail);
router.post('/check-device', checkDevice);
router.post('/google-login', googleLogin);
router.post('/google-origin-check', googleOriginCheck);

router.post('/refresh-token', authLimiter, refreshToken);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password/:token', authLimiter, resetPassword);

router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);

module.exports = router;
