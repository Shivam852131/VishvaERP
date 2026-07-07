const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  getAttendance,
  markAttendance,
  getStudentAttendanceSummary,
  getLocationConsent,
  updateLocationConsent,
  upsertClassroomLocation,
  publishLiveLocation,
  getLiveClassPresence,
  getClassroomLocations,
  deleteClassroomLocation,
  getAttendanceAnalytics,
  notifyAbsentees,
  getTimetableSlots,
  getAttendanceHeatmap,
} = require('../controllers/attendanceController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

// Faculty routes
router.post('/mark', authorize('faculty', 'collegeAdmin'), markAttendance);
router.get('/', authorize('faculty', 'collegeAdmin', 'student', 'parent'), getAttendance);

// Smart location attendance routes
router.get('/location-consent', authorize('student'), getLocationConsent);
router.post('/location-consent', authorize('student'), updateLocationConsent);
router.post('/classrooms', authorize('faculty', 'collegeAdmin'), upsertClassroomLocation);
router.post('/live-location', authorize('student', 'faculty'), publishLiveLocation);
router.get('/live-class', authorize('faculty', 'collegeAdmin'), getLiveClassPresence);

// Student/Parent routes
router.get('/summary/:studentId?', authorize('student', 'parent', 'faculty', 'collegeAdmin'), getStudentAttendanceSummary);

// College Admin attendance management routes
router.get('/classrooms', authorize('faculty', 'collegeAdmin'), getClassroomLocations);
router.delete('/classrooms/:id', authorize('collegeAdmin'), deleteClassroomLocation);
router.get('/analytics', authorize('collegeAdmin', 'superadmin'), getAttendanceAnalytics);
router.post('/notify-absentees', authorize('collegeAdmin'), notifyAbsentees);
router.get('/timetable', authorize('faculty', 'collegeAdmin'), getTimetableSlots);
router.get('/heatmap', authorize('collegeAdmin', 'superadmin'), getAttendanceHeatmap);

module.exports = router;
