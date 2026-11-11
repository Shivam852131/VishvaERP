const express = require('express');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { getChannels, sendCode, checkCode, verifyAndLogin, setupTotp, verifyTotp, getAttempts } = require('../controllers/verificationController');

const router = express.Router();

// A dedicated, tighter limiter for the verification surface. These endpoints
// send SMS/WhatsApp/e-mail, so they are the most attractive abuse target
// (cost amplification + OTP brute force).
const verifyLimiter = authLimiter;

router.get('/channels', getChannels);
router.post('/send', verifyLimiter, sendCode);
router.post('/check', verifyLimiter, checkCode);
router.post('/verify-and-login', verifyLimiter, verifyAndLogin);
router.get('/attempts', verifyLimiter, getAttempts);

router.use(protect);
router.post('/totp/setup', setupTotp);
router.post('/totp/verify', verifyTotp);

module.exports = router;
