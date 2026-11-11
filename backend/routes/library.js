const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  addBook,
  getBooks,
  getBookById,
  getBookByISBN,
  updateBook,
  deleteBook,
  issueBook,
  reserveBook,
  renewBook,
  returnBook,
  payFine,
  scanOverdue,
  getIssueRecords,
  getMyIssues,
  getLibraryStats,
  exportLibraryReport,
} = require('../controllers/libraryController');

const router = express.Router();
router.use(protect, sameCollege, requireSubscription);

// Books Catalog
router.route('/books')
  .get(getBooks)
  .post(authorize('collegeAdmin', 'superadmin'), addBook);

router.route('/')
  .get(getBooks)
  .post(authorize('collegeAdmin', 'superadmin'), addBook);

router.get('/books/mine', getMyIssues);
router.get('/books/isbn/:isbn', getBookByISBN);
router.get('/isbn/:isbn', getBookByISBN);

router.route('/books/:id')
  .get(getBookById)
  .put(authorize('collegeAdmin', 'superadmin'), updateBook)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteBook);

// Issue & Circulation Lifecycle
router.post('/issue', authorize('collegeAdmin', 'superadmin', 'faculty', 'student'), issueBook);
router.post('/books/:id/issue', authorize('collegeAdmin', 'superadmin', 'faculty', 'student'), issueBook);

router.post('/reserve', authorize('collegeAdmin', 'superadmin', 'faculty', 'student'), reserveBook);
router.post('/books/:id/reserve', authorize('collegeAdmin', 'superadmin', 'faculty', 'student'), reserveBook);

// Renew / return are limited to the borrower (students and their parents),
// library staff (faculty) and administrators. Without a role gate and an
// ownership check any authenticated user could return another user's book
// (clearing their fine) or extend any due date indefinitely.
router.post('/renew/:id', authorize('collegeAdmin', 'superadmin', 'faculty', 'student', 'parent'), renewBook);
router.post('/renew', authorize('collegeAdmin', 'superadmin', 'faculty', 'student', 'parent'), renewBook);

router.post('/return/:id', authorize('collegeAdmin', 'superadmin', 'faculty', 'student', 'parent'), returnBook);
router.post('/return', authorize('collegeAdmin', 'superadmin', 'faculty', 'student', 'parent'), returnBook);

router.post('/pay-fine/:id', authorize('collegeAdmin', 'superadmin', 'student', 'parent'), payFine);
router.post('/scan-overdue', authorize('collegeAdmin', 'superadmin'), scanOverdue);

// Circulation Records & Reports
router.get('/issues', authorize('collegeAdmin', 'superadmin', 'faculty'), getIssueRecords);
// Available to every role (the student dashboard shows catalogue and personal
// loan counters). Institution-wide fine revenue is stripped from the response
// for non-administrators inside the controller.
router.get('/stats', authorize('collegeAdmin', 'superadmin', 'student', 'faculty', 'parent'), getLibraryStats);
router.get('/export', authorize('collegeAdmin', 'superadmin'), exportLibraryReport);

module.exports = router;
