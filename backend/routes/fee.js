const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { createFee, getFees, payFee, createBulkFees, createFeeOrder, verifyFeePayment } = require('../controllers/feeController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.route('/')
  .post(authorize('collegeAdmin'), createFee)
  .get(getFees);

router.post('/bulk', authorize('collegeAdmin'), createBulkFees);
router.post('/:id/pay', authorize('collegeAdmin', 'student', 'parent'), payFee);
router.post('/:id/create-order', authorize('student', 'parent'), createFeeOrder);
router.post('/verify-payment', authorize('student', 'parent'), verifyFeePayment);

module.exports = router;
