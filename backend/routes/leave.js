const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  applyLeave,
  getMyLeaves,
  getAllLeaves,
  updateLeaveStatus,
  cancelLeave,
  getMySubstituteRequests,
  respondSubstituteRequest,
  getLeaveStats,
  exportLeaveReport,
  getFacultyWorkload,
} = require('../controllers/leaveController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

// Applicant routes (Faculty, Student, Staff)
router.post('/apply', authorize('faculty', 'student', 'collegeAdmin', 'superadmin'), applyLeave);
router.post('/leaves/apply', authorize('faculty', 'student', 'collegeAdmin', 'superadmin'), applyLeave);
router.get('/my-leaves', authorize('faculty', 'student', 'collegeAdmin', 'superadmin'), getMyLeaves);
router.get('/leaves/my-leaves', authorize('faculty', 'student', 'collegeAdmin', 'superadmin'), getMyLeaves);
router.put('/:id/cancel', authorize('faculty', 'student', 'collegeAdmin', 'superadmin'), cancelLeave);
router.put('/leaves/:id/cancel', authorize('faculty', 'student', 'collegeAdmin', 'superadmin'), cancelLeave);

// Substitute faculty coverage handshake
router.get('/substitute-requests', authorize('faculty', 'collegeAdmin', 'superadmin'), getMySubstituteRequests);
router.get('/substitute/requests', authorize('faculty', 'collegeAdmin', 'superadmin'), getMySubstituteRequests);
router.patch('/:id/substitute-response', authorize('faculty', 'collegeAdmin', 'superadmin'), respondSubstituteRequest);
router.patch('/substitute/:id/response', authorize('faculty', 'collegeAdmin', 'superadmin'), respondSubstituteRequest);

// Analytics, Directory & Reporting
router.get('/stats', authorize('collegeAdmin', 'superadmin'), getLeaveStats);
router.get('/export', authorize('collegeAdmin', 'superadmin'), exportLeaveReport);
router.get('/leaves/export', authorize('collegeAdmin', 'superadmin'), exportLeaveReport);
router.get('/faculty-workload', authorize('collegeAdmin', 'faculty', 'superadmin'), getFacultyWorkload);
router.get('/workload', authorize('collegeAdmin', 'faculty', 'superadmin'), getFacultyWorkload);

// Institutional Admin routes
router.get('/all', authorize('collegeAdmin', 'superadmin'), getAllLeaves);
router.get('/leaves/all', authorize('collegeAdmin', 'superadmin'), getAllLeaves);
router.get('/leaves', authorize('collegeAdmin', 'superadmin'), getAllLeaves);
router.get('/', authorize('collegeAdmin', 'superadmin'), getAllLeaves);
router.put('/:id/status', authorize('collegeAdmin', 'superadmin'), updateLeaveStatus);
router.put('/leaves/:id/status', authorize('collegeAdmin', 'superadmin'), updateLeaveStatus);

module.exports = router;
