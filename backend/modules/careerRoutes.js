const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege, authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  getMyProfile,
  updateMyProfile,
  getStudentProfile,
  addSkill,
  deleteSkill,
  endorseSkill,
  getCareerInsights,
  getSkillAnalytics,
  getLearningPaths,
  getAIRecommendations,
} = require('../controllers/careerController');

const router = express.Router();
router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.get('/profile', getMyProfile);
router.put('/profile', updateMyProfile);
router.get('/profile/:studentId', getStudentProfile);

router.post('/skills', addSkill);
router.delete('/skills/:skillName', deleteSkill);
router.post('/skills/:skillName/endorse', authorize('faculty', 'collegeAdmin', 'student'), endorseSkill);
router.post('/profile/:studentId/skills/:skillName/endorse', authorize('faculty', 'collegeAdmin', 'student'), endorseSkill);

router.get('/insights', getCareerInsights);
router.get('/analytics', authorize('collegeAdmin', 'faculty'), getSkillAnalytics);
router.get('/learning-paths', getLearningPaths);
router.get('/ai-recommendations', getAIRecommendations);

module.exports = router;
