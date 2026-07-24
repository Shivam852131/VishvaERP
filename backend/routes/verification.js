const express = require('express');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { getChannels, sendCode, checkCode, verifyAndLogin, setupTotp, verifyTotp, getAttempts } = require('../controllers/verificationController');

const router = express.Router();

router.get('/channels', getChannels);
router.post('/send', authLimiter, sendCode);
router.post('/check', authLimiter, checkCode);
router.post('/verify-and-login', authLimiter, verifyAndLogin);
router.get('/attempts', getAttempts);

router.use(protect);
router.post('/totp/setup', setupTotp);
router.post('/totp/verify', verifyTotp);

module.exports = router;
