const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { getMyPreferences, updateMyPreferences, getChannelStatus, sendTestNotification } = require('../controllers/parentNotificationController');

const router = express.Router();
router.use(protect);

router.get('/preferences', authorize('parent'), getMyPreferences);
router.put('/preferences', authorize('parent'), updateMyPreferences);
router.get('/channels', getChannelStatus);
router.post('/test', sendTestNotification);

module.exports = router;
