const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  getNotices,
  createNotice,
  updateNotice,
  deleteNotice,
} = require('./noticeController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

router.route('/')
  .get(getNotices)
  .post(authorize('collegeAdmin', 'superadmin'), createNotice);

router.route('/:id')
  .put(authorize('collegeAdmin', 'superadmin'), updateNotice)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteNotice);

module.exports = router;
