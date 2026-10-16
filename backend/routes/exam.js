const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  createExam,
  getExams,
  addResults,
  getStudentResults,
  getResultSheet,
  getExamAnalytics,
  exportExamCSVTemplate,
} = require('../controllers/examController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

// Manage exams and results
router.route('/')
  .post(authorize('collegeAdmin', 'faculty'), createExam)
  .get(getExams);

router.get('/analytics', authorize('faculty', 'collegeAdmin'), getExamAnalytics);
router.get('/template', authorize('faculty', 'collegeAdmin'), exportExamCSVTemplate);
router.post('/results', authorize('collegeAdmin', 'faculty'), addResults);
router.get('/results-sheet', authorize('faculty', 'collegeAdmin'), getResultSheet);

// Student/Parent view results
router.get('/results/:studentId?', authorize('student', 'parent', 'faculty', 'collegeAdmin'), getStudentResults);

module.exports = router;
