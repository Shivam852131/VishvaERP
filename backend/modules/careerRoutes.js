const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege, authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { getMyProfile, updateMyProfile, getStudentProfile, getCareerInsights, getSkillAnalytics, getLearningPaths, getAIRecommendations } = require('../controllers/careerController');

const router = express.Router();
router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.get('/profile', getMyProfile);
router.put('/profile', updateMyProfile);
router.get('/profile/:studentId', getStudentProfile);
router.get('/insights', getCareerInsights);
router.get('/analytics', authorize('collegeAdmin', 'faculty'), getSkillAnalytics);
router.get('/learning-paths', getLearningPaths);
router.get('/ai-recommendations', getAIRecommendations);

module.exports = router;
