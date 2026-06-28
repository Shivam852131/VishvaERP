const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { createFee, getFees, payFee, createBulkFees } = require('../controllers/feeController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

router.route('/')
  .post(authorize('collegeAdmin'), createFee)
  .get(getFees);

router.post('/bulk', authorize('collegeAdmin'), createBulkFees);
router.post('/:id/pay', authorize('collegeAdmin', 'student', 'parent'), payFee);

module.exports = router;
