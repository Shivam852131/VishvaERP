const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege, authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { logEnergy, getEnergyLogs, getEnergyDashboard, createGoal, getGoals, updateGoal, deleteGoal } = require('../controllers/energyController');

const router = express.Router();
router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.post('/logs', authorize('collegeAdmin'), logEnergy);
router.get('/logs', getEnergyLogs);
router.get('/dashboard', getEnergyDashboard);

router.route('/goals')
  .get(getGoals)
  .post(authorize('collegeAdmin'), createGoal);

router.route('/goals/:id')
  .put(authorize('collegeAdmin'), updateGoal)
  .delete(authorize('collegeAdmin'), deleteGoal);

module.exports = router;
