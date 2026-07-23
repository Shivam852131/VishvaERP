const express = require('express');
const { register, login, refreshToken, forgotPassword, resetPassword, getMe, updateProfile, changePassword, sendOTPHandler, verifyOTPLogin, sendVerificationOTP, verifyEmail, checkDevice } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { body } = require('express-validator');

const router = express.Router();

router.post('/register', [
  body('name', 'Name is required').notEmpty(),
  body('email', 'Please include a valid email').isEmail(),
  body('password', 'Password must be 6 or more characters').isLength({ min: 6 }),
  body('role', 'Valid role is required').isIn(['superadmin', 'collegeAdmin', 'faculty', 'student', 'parent'])
], register);

router.post('/login', authLimiter, [
  body('email', 'Please include a valid email').isEmail(),
  body('password', 'Password is required').exists()
], login);

router.post('/send-otp', authLimiter, sendOTPHandler);
router.post('/verify-otp-login', authLimiter, verifyOTPLogin);
router.post('/send-verification-otp', authLimiter, sendVerificationOTP);
router.post('/verify-email', verifyEmail);
router.post('/check-device', checkDevice);

router.post('/refresh-token', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);

router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);

module.exports = router;
