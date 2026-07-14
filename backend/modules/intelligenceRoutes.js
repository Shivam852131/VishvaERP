const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege, authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { getCampusHealth, getAtRiskStudents, getModuleAnalytics, getTrends, aiQuery, getPredictions } = require('../controllers/intelligenceController');

const router = express.Router();
router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.get('/health', authorize('collegeAdmin'), getCampusHealth);
router.get('/at-risk', authorize('collegeAdmin', 'faculty'), getAtRiskStudents);
router.get('/analytics', authorize('collegeAdmin', 'faculty'), getModuleAnalytics);
router.get('/trends', authorize('collegeAdmin', 'faculty'), getTrends);
router.post('/query', authorize('collegeAdmin', 'faculty'), aiQuery);
router.get('/predictions', authorize('collegeAdmin'), getPredictions);

module.exports = router;
