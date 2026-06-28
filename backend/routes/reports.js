const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { downloadFeeReceipt, emailFeeReceipt, downloadResultSheet, downloadIdCard } = require('../controllers/reportController');

router.get('/fee-receipt/:id', protect, sameCollege, downloadFeeReceipt);
router.post('/fee-receipt/:id/email', protect, authorize('collegeAdmin', 'superadmin'), sameCollege, emailFeeReceipt);
router.get('/result-sheet/:examId', protect, authorize('collegeAdmin', 'faculty', 'superadmin'), sameCollege, downloadResultSheet);
router.get('/id-card/:userId?', protect, downloadIdCard);

module.exports = router;
