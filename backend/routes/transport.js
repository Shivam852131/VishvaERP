const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  addRoute,
  getRoutes,
  getRouteById,
  updateRoute,
  deleteRoute,
  enrollStudent,
  unenrollStudent,
  updateGPSLocation,
  getLiveGPS,
  getLiveFleet,
  getMyTransport,
  getMyPass,
} = require('../controllers/logisticsController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

// Dedicated fleet & pass routes
router.get('/live-fleet', authorize('collegeAdmin', 'superadmin', 'student', 'faculty', 'parent'), getLiveFleet);
router.get('/my-pass', authorize('student'), getMyPass);
router.get('/my-transport', authorize('student'), getMyTransport);

// Collection routes
router.route('/')
  .get(authorize('collegeAdmin', 'superadmin', 'student', 'faculty', 'parent'), getRoutes)
  .post(authorize('collegeAdmin', 'superadmin'), addRoute);

// Single route operations
router.route('/:id')
  .get(authorize('collegeAdmin', 'superadmin', 'student', 'faculty', 'parent'), getRouteById)
  .put(authorize('collegeAdmin', 'superadmin'), updateRoute)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteRoute);

// Enrollment & Pass management
router.post('/:id/enroll', authorize('collegeAdmin', 'superadmin', 'student'), enrollStudent);
router.post('/:id/unenroll', authorize('collegeAdmin', 'superadmin', 'student'), unenrollStudent);

// Telemetry & GPS tracking
router.post('/:id/gps', authorize('collegeAdmin', 'superadmin', 'faculty'), updateGPSLocation);
router.get('/:id/live-gps', authorize('collegeAdmin', 'superadmin', 'student', 'faculty', 'parent'), getLiveGPS);

module.exports = router;
