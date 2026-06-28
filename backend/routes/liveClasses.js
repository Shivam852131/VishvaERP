const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { listLiveClasses, startLiveClass, endLiveClass } = require('../controllers/liveClassController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

router.get('/', authorize('faculty', 'student', 'parent', 'collegeAdmin', 'superadmin'), listLiveClasses);
router.post('/', authorize('faculty'), startLiveClass);
router.put('/:id/end', authorize('faculty'), endLiveClass);

module.exports = router;
