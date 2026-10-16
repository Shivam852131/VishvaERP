const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  getLogisticsStats,
  exportLogisticsReport,
  getMyHostel,
  getMyTransport,
  getRooms,
} = require('../controllers/logisticsController');
const transportRouter = require('./transport');
const hostelRouter = require('./hostel');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

// Stats & Export
router.get('/stats', authorize('collegeAdmin', 'superadmin'), getLogisticsStats);
router.get('/export', authorize('collegeAdmin', 'superadmin'), exportLogisticsReport);

// Direct student shortcuts
router.get('/my-hostel', authorize('student'), getMyHostel);
router.get('/my-transport', authorize('student'), getMyTransport);

// Direct rooms query
router.get('/rooms', authorize('collegeAdmin', 'superadmin', 'student', 'faculty'), getRooms);

// Sub-routers mounted for full path parity
router.use('/transport', transportRouter);
router.use('/hostels', hostelRouter);

// Overview / root fallback
router.get('/', authorize('collegeAdmin', 'superadmin', 'student', 'faculty'), getLogisticsStats);

module.exports = router;
