const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { createExam, getExams, addResults, getStudentResults, getResultSheet } = require('../controllers/examController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

// Manage exams and results
router.route('/')
  .post(authorize('collegeAdmin', 'faculty'), createExam)
  .get(getExams);

router.post('/results', authorize('collegeAdmin', 'faculty'), addResults);
router.get('/results-sheet', authorize('faculty', 'collegeAdmin'), getResultSheet);

// Student/Parent view results
router.get('/results/:studentId?', authorize('student', 'parent', 'faculty', 'collegeAdmin'), getStudentResults);

module.exports = router;
