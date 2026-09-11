const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  createAssignment,
  getFacultyAssignments,
  getStudentAssignments,
  getAssignmentSubmissions,
  submitAssignment,
  gradeSubmission,
  updateAssignment,
  deleteAssignment,
} = require('../controllers/assignmentController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

// Faculty & Admin: list & create assignments
router.route('/')
  .post(authorize('collegeAdmin', 'faculty'), createAssignment);

router.get('/faculty', authorize('faculty', 'collegeAdmin'), getFacultyAssignments);
router.get('/student', authorize('student'), getStudentAssignments);

// Submissions & Grading
router.get('/:id/submissions', authorize('faculty', 'collegeAdmin'), getAssignmentSubmissions);
router.post('/:id/submit', authorize('student'), submitAssignment);
router.post('/submissions/:submissionId/grade', authorize('faculty', 'collegeAdmin'), gradeSubmission);

// Update & Delete
router.route('/:id')
  .put(authorize('faculty', 'collegeAdmin'), updateAssignment)
  .delete(authorize('faculty', 'collegeAdmin'), deleteAssignment);

module.exports = router;
