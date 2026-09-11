const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  getAttendance,
  markAttendance,
  getStudentAttendanceSummary,
  getStudentCalendar,
  getShortageAlerts,
  getAttendanceStreak,
  bulkExcuse,
  correctAttendanceRecord,
  exportAttendance,
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
  generateQRToken,
  scanQRAttendance,
  getQRScanStatus,
} = require('../controllers/attendanceController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

// ── Faculty routes ──────────────────────────────
router.post('/mark', authorize('faculty', 'collegeAdmin'), markAttendance);
router.get('/', authorize('faculty', 'collegeAdmin', 'student', 'parent'), getAttendance);

// ── Correction ──────────────────────────────────
router.patch('/:id/correct', authorize('faculty', 'collegeAdmin'), correctAttendanceRecord);

// ── Bulk excuse ─────────────────────────────────
router.post('/bulk-excuse', authorize('faculty', 'collegeAdmin'), bulkExcuse);

// ── Smart location attendance ───────────────────
router.get('/location-consent', authorize('student'), getLocationConsent);
router.post('/location-consent', authorize('student'), updateLocationConsent);
router.post('/classrooms', authorize('faculty', 'collegeAdmin'), upsertClassroomLocation);
router.post('/live-location', authorize('student', 'faculty'), publishLiveLocation);
router.get('/live-class', authorize('faculty', 'collegeAdmin'), getLiveClassPresence);

// ── Student / Parent routes ─────────────────────
router.get('/summary/:studentId?', authorize('student', 'parent', 'faculty', 'collegeAdmin'), getStudentAttendanceSummary);
router.get('/calendar/:studentId?', authorize('student', 'parent', 'faculty', 'collegeAdmin'), getStudentCalendar);
router.get('/streak/:studentId?', authorize('student', 'parent', 'faculty', 'collegeAdmin'), getAttendanceStreak);

// ── College Admin routes ────────────────────────
router.get('/classrooms', authorize('faculty', 'collegeAdmin'), getClassroomLocations);
router.delete('/classrooms/:id', authorize('collegeAdmin'), deleteClassroomLocation);
router.get('/analytics', authorize('collegeAdmin', 'superadmin'), getAttendanceAnalytics);
router.get('/shortage', authorize('faculty', 'collegeAdmin', 'superadmin'), getShortageAlerts);
router.get('/heatmap', authorize('collegeAdmin', 'superadmin'), getAttendanceHeatmap);
router.get('/timetable', authorize('faculty', 'collegeAdmin'), getTimetableSlots);
router.get('/export', authorize('faculty', 'collegeAdmin', 'superadmin'), exportAttendance);
router.post('/notify-absentees', authorize('collegeAdmin'), notifyAbsentees);

// ── QR Code Attendance ─────────────────────────
router.post('/qr/generate', authorize('faculty', 'collegeAdmin'), generateQRToken);
router.post('/qr/scan', authorize('student'), scanQRAttendance);
router.get('/qr/status/:token', authorize('faculty', 'collegeAdmin'), getQRScanStatus);

module.exports = router;
