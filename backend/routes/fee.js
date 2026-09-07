const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  createFeeStructure, getFeeStructures, updateFeeStructure, deleteFeeStructure,
  assignFeeStructure,
  createFee, getFees, getFeeById, payFee, createBulkFees,
  createFeeOrder, verifyFeePayment, getFeePaymentStatus,
  getInstallments, updateInstallment, createInstallmentOrder,
  applyLateFees, waiveFee, applyDiscount,
  getFeeAnalytics, getFeeSummary,
  getAssignableStudents,
} = require('../controllers/feeController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.route('/structures')
  .post(authorize('collegeAdmin'), createFeeStructure)
  .get(getFeeStructures);

router.route('/structures/:id')
  .put(authorize('collegeAdmin'), updateFeeStructure)
  .delete(authorize('collegeAdmin'), deleteFeeStructure);

router.post('/structures/assign', authorize('collegeAdmin'), assignFeeStructure);

router.route('/')
  .post(authorize('collegeAdmin'), createFee)
  .get(getFees);

router.get('/summary', getFeeSummary);
router.get('/analytics', authorize('collegeAdmin', 'superadmin'), getFeeAnalytics);

router.post('/bulk', authorize('collegeAdmin'), createBulkFees);
router.get('/assignable-students', authorize('collegeAdmin'), getAssignableStudents);
router.get('/installments', getInstallments);

router.post('/late-fees/apply', authorize('collegeAdmin'), applyLateFees);

router.get('/:id', getFeeById);
router.post('/:id/pay', authorize('collegeAdmin', 'student', 'parent'), payFee);
router.post('/:id/create-order', authorize('collegeAdmin', 'student', 'parent'), createFeeOrder);
router.get('/:id/payment-status', authorize('collegeAdmin', 'student', 'parent'), getFeePaymentStatus);
router.post('/verify-payment', authorize('collegeAdmin', 'student', 'parent'), verifyFeePayment);

router.put('/:id/installments/:installmentId', authorize('collegeAdmin'), updateInstallment);
router.post('/:id/installments/:installmentId/create-order', authorize('collegeAdmin', 'student', 'parent'), createInstallmentOrder);

router.post('/:id/waive', authorize('collegeAdmin'), waiveFee);
router.post('/:id/discount', authorize('collegeAdmin'), applyDiscount);

module.exports = router;
