const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { submitFeedback, getFeedback, getFeedbackStats, getMyFeedback } = require('../controllers/feedbackController');

const router = express.Router();
router.use(protect, sameCollege, requireSubscription);

router.route('/')
  .post(submitFeedback)
  .get(getFeedback);

router.get('/stats', authorize('collegeAdmin', 'superadmin', 'faculty'), getFeedbackStats);
router.get('/my', getMyFeedback);

module.exports = router;
