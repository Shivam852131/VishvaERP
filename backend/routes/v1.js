const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/super-admin', require('./superAdmin'));
router.use('/college-admin', require('./collegeAdmin'));
router.use('/attendance', require('./attendance'));
router.use('/exams', require('./exam'));
router.use('/fees', require('./fee'));
router.use('/ai', require('./ai'));
router.use('/leave', require('./leave'));
router.use('/logistics', require('./logistics'));
router.use('/live-classes', require('./liveClasses'));
router.use('/academics', require('../modules/academicsRoutes'));
router.use('/notices', require('../modules/noticesRoutes'));
router.use('/communications', require('../modules/communicationsRoutes'));
router.use('/notifications', require('./notifications'));
router.use('/config', require('./config'));
router.use('/health', require('./health'));
router.use('/upload', require('./upload'));
router.use('/reports', require('./reports'));

module.exports = router;
