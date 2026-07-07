const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { createGrievance, getGrievances, getGrievanceById, updateGrievance, addResponse, addFeedback, getGrievanceStats } = require('../controllers/grievanceController');

const router = express.Router();
router.use(protect, sameCollege, requireSubscription);

router.route('/')
  .post(authorize('student', 'parent', 'faculty'), createGrievance)
  .get(getGrievances);

router.get('/stats', authorize('collegeAdmin', 'superadmin'), getGrievanceStats);
router.get('/:id', getGrievanceById);
router.put('/:id', authorize('collegeAdmin', 'superadmin'), updateGrievance);
router.post('/:id/respond', authorize('collegeAdmin', 'superadmin', 'faculty'), addResponse);
router.post('/:id/feedback', authorize('student', 'parent'), addFeedback);

module.exports = router;
