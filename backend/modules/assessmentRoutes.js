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
// Skill assessments are taken by students. Attempts are self-scoped to the
// caller, but parents/faculty must not be able to create attempts.
router.get('/:id', authorize('student', 'faculty', 'collegeAdmin'), getAssessmentById);
router.post('/:id/start', authorize('student'), startAttempt);
router.post('/:id/submit', authorize('student'), submitAttempt);

module.exports = router;
