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
// The visitor register contains personal identifying information (names,
// phone numbers, e-mail addresses, vehicle numbers, security notes) and
// represents physical access to the campus - it is staff-only.
router.route('/')
  .get(authorize('collegeAdmin', 'superadmin', 'faculty'), getVisitors)
  .post(authorize('collegeAdmin', 'superadmin', 'faculty'), createVisitor);

router.post('/pre-register', preRegisterVisitor);
router.get('/stats', authorize('collegeAdmin', 'superadmin', 'faculty'), getVisitorStats);
router.get('/export', authorize('collegeAdmin', 'superadmin'), exportVisitors);
router.post('/verify', verifyGatePass);
router.get('/verify/:gatePass', verifyGatePass);
router.post('/blacklist', authorize('collegeAdmin', 'superadmin'), blacklistVisitor);

// Pass endpoints
router.get('/pass/:gatePass', getGatePass);
router.get('/:id/gate-pass', getGatePass);

// Specific visitor actions
router.route('/:id')
  .get(authorize('collegeAdmin', 'superadmin', 'faculty'), getVisitorById)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteVisitor);

router.post('/:id/checkin', authorize('collegeAdmin', 'superadmin', 'faculty'), checkInPreRegistered);
router.post('/:id/checkout', authorize('collegeAdmin', 'superadmin', 'faculty'), checkOutVisitor);
router.post('/:id/cancel', authorize('collegeAdmin', 'superadmin', 'faculty'), cancelVisitor);

module.exports = router;
