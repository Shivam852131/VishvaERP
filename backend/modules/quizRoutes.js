const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');

const quiz = require('../controllers/quizController');
const importer = require('../controllers/questionImportController');

const router = express.Router();
router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

// In-memory upload for question import (Excel / CSV / PDF / image)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

const STAFF = ['collegeAdmin', 'faculty'];

/* ─── Taxonomy (read: staff; write: superadmin) ─── */
router.get('/taxonomy', authorize('superadmin', ...STAFF), quiz.getTaxonomy);
router.put('/taxonomy', authorize('superadmin'), quiz.updateTaxonomy);

/* ─── Import + AI generation (staff) ─── */
router.get('/import/template', authorize(...STAFF), importer.downloadTemplate);
router.post('/import/preview', authorize(...STAFF), upload.single('file'), importer.previewImport);
router.post('/import/confirm', authorize(...STAFF), importer.confirmImport);
router.post('/generate-questions', authorize(...STAFF), importer.generateQuestions);

/* ─── Staff: manage quizzes ─── */
router.get('/manage', authorize(...STAFF), quiz.manageQuizzes);
router.post('/', authorize(...STAFF), quiz.createQuiz);

/* ─── Student: analytics, recommendations, history, bookmarks ─── */
router.get('/my-analytics', authorize('student'), quiz.getMyAnalytics);
router.get('/recommendations', authorize('student'), quiz.getRecommendations);
router.get('/history', authorize('student'), quiz.getMyHistory);
router.get('/bookmarks', authorize('student'), quiz.getBookmarks);
router.post('/bookmarks', authorize('student'), quiz.addBookmark);
router.delete('/bookmarks/:questionId', authorize('student'), quiz.removeBookmark);

/* ─── Attempt lifecycle (student) + manual grading (staff) ─── */
router.get('/attempts/:attemptId/questions', authorize('student'), quiz.getAttemptQuestions);
router.patch('/attempts/:attemptId/answers', authorize('student'), quiz.saveProgress);
router.post('/attempts/:attemptId/submit', authorize('student'), quiz.submitAttempt);
router.get('/attempts/:attemptId/result', authorize('student'), quiz.getAttemptResult);
router.get('/attempts/:attemptId/review', authorize('student'), quiz.getAttemptResult); // alias
router.patch('/attempts/:attemptId/grade', authorize(...STAFF), quiz.gradeAttempt);

/* ─── Per-quiz routes (literal paths above take precedence over /:id) ─── */
router.post('/:id/start', authorize('student'), quiz.startAttempt);
router.get('/:id/attempts', authorize(...STAFF), quiz.getQuizAttempts);
router.get('/:id/analytics', authorize(...STAFF), quiz.getQuizAnalytics);
router.post('/:id/questions', authorize(...STAFF), quiz.addQuizQuestions);
router.delete('/:id/questions/:questionId', authorize(...STAFF), quiz.removeQuizQuestion);
router.patch('/:id/publish', authorize(...STAFF), quiz.publishQuiz);
router.put('/:id', authorize(...STAFF), quiz.updateQuiz);
router.delete('/:id', authorize(...STAFF), quiz.deleteQuiz);
router.get('/:id', authorize('superadmin', ...STAFF), quiz.getQuizById);

/* ─── Student browse (registered last so literals win) ─── */
router.get('/', authorize('student', ...STAFF, 'superadmin'), quiz.listQuizzes);

module.exports = router;
