const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege, authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  createVisitor,
  preRegisterVisitor,
  checkInPreRegistered,
  getVisitors,
  getVisitorById,
  getGatePass,
  verifyGatePass,
  checkOutVisitor,
  cancelVisitor,
  blacklistVisitor,
  getVisitorStats,
  exportVisitors,
  deleteVisitor,
} = require('../controllers/visitorController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

// Core endpoints
router.route('/')
  .get(getVisitors)
  .post(authorize('collegeAdmin', 'superadmin', 'faculty'), createVisitor);

router.post('/pre-register', preRegisterVisitor);
router.get('/stats', getVisitorStats);
router.get('/export', authorize('collegeAdmin', 'superadmin'), exportVisitors);
router.post('/verify', verifyGatePass);
router.get('/verify/:gatePass', verifyGatePass);
router.post('/blacklist', authorize('collegeAdmin', 'superadmin'), blacklistVisitor);

// Pass endpoints
router.get('/pass/:gatePass', getGatePass);
router.get('/:id/gate-pass', getGatePass);

// Specific visitor actions
router.route('/:id')
  .get(getVisitorById)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteVisitor);

router.post('/:id/checkin', checkInPreRegistered);
router.post('/:id/checkout', checkOutVisitor);
router.post('/:id/cancel', cancelVisitor);

module.exports = router;
