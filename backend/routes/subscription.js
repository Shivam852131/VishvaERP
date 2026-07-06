const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  getPlans,
  createOrder,
  verifyPayment,
  getSubscription,
  getPaymentHistory,
  getSubscriptionStatus,
  getSubscriptionReceipt,
} = require('../controllers/subscriptionController');

const router = express.Router();

// Public endpoint - plans visible to everyone
router.get('/plans', getPlans);

// Protected endpoints
router.use(protect);
router.use(sameCollege);

router.post('/create-order', authorize('collegeAdmin', 'superadmin'), createOrder);
router.post('/verify', authorize('collegeAdmin', 'superadmin'), verifyPayment);
router.get('/current', authorize('collegeAdmin', 'superadmin'), getSubscription);
router.get('/status', authorize('collegeAdmin', 'superadmin'), getSubscriptionStatus);
router.get('/payments', authorize('collegeAdmin', 'superadmin'), getPaymentHistory);
router.get('/receipts/:paymentId', authorize('collegeAdmin', 'superadmin'), getSubscriptionReceipt);

module.exports = router;
