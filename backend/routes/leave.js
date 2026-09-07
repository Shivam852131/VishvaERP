const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { applyLeave, getMyLeaves, getAllLeaves, updateLeaveStatus } = require('../controllers/leaveController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

// Faculty routes
router.post('/apply', authorize('faculty'), applyLeave);
router.get('/my-leaves', authorize('faculty'), getMyLeaves);

// Admin routes
router.get('/all', authorize('collegeAdmin', 'superadmin'), getAllLeaves);
router.put('/:id/status', authorize('collegeAdmin', 'superadmin'), updateLeaveStatus);

module.exports = router;
