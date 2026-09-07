const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege, authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { getAssessments, getAssessmentById, createAssessment, startAttempt, submitAttempt, getLeaderboard, getMyStats } = require('../controllers/assessmentController');

const router = express.Router();
router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.get('/', getAssessments);
router.get('/stats', getMyStats);
router.get('/leaderboard', getLeaderboard);
router.post('/', authorize('collegeAdmin', 'faculty'), createAssessment);
router.get('/:id', getAssessmentById);
router.post('/:id/start', startAttempt);
router.post('/:id/submit', submitAttempt);

module.exports = router;
