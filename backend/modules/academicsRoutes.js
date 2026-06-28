const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  getCourses,
  createCourse,
  getSubjects,
  getStudents,
  getStudentProfile,
  createSubject,
  getTimetable,
  createTimetable,
  getAssignments,
  createAssignment,
  deleteAssignment,
  submitAssignment,
  getAssignmentSubmissions,
  getLibraryBooks,
  createBook,
  getLibraryRecords,
  issueBook,
  returnBook,
  gradeSubmission,
} = require('./academicsController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

router.route('/courses')
  .get(getCourses)
  .post(authorize('collegeAdmin'), createCourse);

router.route('/subjects')
  .get(getSubjects)
  .post(authorize('collegeAdmin'), createSubject);

router.get('/students', authorize('faculty', 'collegeAdmin'), getStudents);
router.get('/student-profile/:studentId?', authorize('student', 'parent', 'faculty', 'collegeAdmin'), getStudentProfile);

router.route('/timetable')
  .get(getTimetable)
  .post(authorize('collegeAdmin'), createTimetable);

router.route('/assignments')
  .get(getAssignments)
  .post(authorize('faculty', 'collegeAdmin'), createAssignment);

router.delete('/assignments/:id', authorize('faculty', 'collegeAdmin'), deleteAssignment);

router.get('/assignments/:id/submissions', authorize('faculty', 'collegeAdmin'), getAssignmentSubmissions);
router.post('/assignments/:id/submit', authorize('student'), submitAssignment);

router.route('/library/books')
  .get(getLibraryBooks)
  .post(authorize('collegeAdmin'), createBook);

router.get('/library/records', getLibraryRecords);
router.post('/library/issue', authorize('collegeAdmin', 'student', 'parent'), issueBook);
router.post('/library/return', authorize('collegeAdmin', 'student', 'parent'), returnBook);

router.put('/assignments/:id/grade/:submissionId', authorize('faculty', 'collegeAdmin'), gradeSubmission);

module.exports = router;
