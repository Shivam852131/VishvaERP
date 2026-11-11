const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege, authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  getAvailableMentors, requestMentorship, getMyMentorships, updateMentorshipStatus,
  scheduleSession, getMySessions, updateSession, getMentorshipStats,
} = require('../controllers/mentorshipController');

const router = express.Router();
router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.get('/mentors', getAvailableMentors);
router.post('/request', requestMentorship);
router.get('/my-mentorships', getMyMentorships);
router.put('/:id/status', updateMentorshipStatus);

router.post('/sessions', scheduleSession);
router.get('/sessions', getMySessions);
router.put('/sessions/:id', updateSession);

// College-wide mentoring statistics - staff only.
router.get('/stats', authorize('collegeAdmin', 'superadmin', 'faculty'), getMentorshipStats);

module.exports = router;
