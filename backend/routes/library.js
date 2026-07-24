const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  addBook, getBooks, getBookById, updateBook, deleteBook,
  issueBook, returnBook, getIssueRecords, getMyIssues, getLibraryStats,
} = require('../controllers/libraryController');

const router = express.Router();
router.use(protect, sameCollege, requireSubscription);

router.route('/books')
  .get(getBooks)
  .post(authorize('collegeAdmin', 'superadmin'), addBook);

router.get('/books/mine', getMyIssues);
router.get('/stats', authorize('collegeAdmin', 'superadmin'), getLibraryStats);
router.get('/issues', getIssueRecords);

router.route('/books/:id')
  .get(getBookById)
  .put(authorize('collegeAdmin', 'superadmin'), updateBook)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteBook);

router.post('/issue', authorize('collegeAdmin', 'superadmin', 'faculty'), issueBook);
router.post('/return/:id', returnBook);

module.exports = router;
