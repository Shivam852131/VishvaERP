const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege, authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { getDrives, createDrive, updateDrive, deleteDrive } = require('../controllers/placementController');

const router = express.Router();
router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.get('/', getDrives);
router.post('/', authorize('collegeAdmin'), createDrive);
router.put('/:id', authorize('collegeAdmin'), updateDrive);
router.delete('/:id', authorize('collegeAdmin'), deleteDrive);

module.exports = router;
