const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  addQuestion,
  bulkAddQuestions,
  getQuestions,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
  getQuestionBankStats,
  createTemplate,
  getTemplates,
  deleteTemplate,
  generatePaper,
  getSubjectStructure,
} = require('../controllers/examGeneratorController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

// Question bank
router.post('/questions', authorize('collegeAdmin', 'faculty'), addQuestion);
router.post('/questions/bulk', authorize('collegeAdmin', 'faculty'), bulkAddQuestions);
router.get('/questions', authorize('collegeAdmin', 'faculty'), getQuestions);
router.get('/questions/stats', authorize('collegeAdmin', 'faculty'), getQuestionBankStats);
router.get('/questions/:id', authorize('collegeAdmin', 'faculty'), getQuestionById);
router.put('/questions/:id', authorize('collegeAdmin', 'faculty'), updateQuestion);
router.delete('/questions/:id', authorize('collegeAdmin', 'faculty'), deleteQuestion);

// Subject structure (units/chapters from question bank)
router.get('/structure/:subjectId?', authorize('collegeAdmin', 'faculty'), getSubjectStructure);

// Templates
router.post('/templates', authorize('collegeAdmin', 'faculty'), createTemplate);
router.get('/templates', authorize('collegeAdmin', 'faculty'), getTemplates);
router.delete('/templates/:id', authorize('collegeAdmin', 'faculty'), deleteTemplate);

// Generate paper
router.post('/generate/:id', authorize('collegeAdmin', 'faculty'), generatePaper);

module.exports = router;
