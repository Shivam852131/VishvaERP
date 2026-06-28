const express = require('express');
const { body, validationResult } = require('express-validator');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const User = require('../models/User');
const pushService = require('../services/pushNotificationService');
const {
  getNotifications,
  createNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} = require('../controllers/notificationController');

const router = express.Router();

router.use(protect);

router.get('/', getNotifications);
router.post('/', authorize('superadmin', 'collegeAdmin'), createNotification);
router.put('/:id/read', markAsRead);
router.post('/read-all', markAllAsRead);
router.delete('/:id', deleteNotification);

router.get('/status', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    pushEnabled: pushService.isPushConfigured(),
    deviceCount: (req.user.deviceTokens || []).length,
  });
}));

router.post('/register-device', [
  body('token', 'Device token is required').notEmpty(),
  body('platform').optional().isIn(['web', 'android', 'ios']),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { token, platform = 'web' } = req.body;
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  user.deviceTokens = (user.deviceTokens || []).filter((entry) => entry.token !== token);
  user.deviceTokens.push({
    token,
    platform,
    updatedAt: new Date(),
  });

  if (user.deviceTokens.length > 10) {
    user.deviceTokens = user.deviceTokens.slice(-10);
  }

  await user.save();

  res.json({ success: true, message: 'Device registered for notifications' });
}));

router.delete('/unregister-device', [
  body('token', 'Device token is required').notEmpty(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  await User.findByIdAndUpdate(req.user._id, {
    $pull: { deviceTokens: { token: req.body.token } },
  });

  res.json({ success: true, message: 'Device unregistered' });
}));

router.post('/test', authorize('superadmin', 'collegeAdmin'), asyncHandler(async (req, res) => {
  const result = await pushService.sendToUser(req.user._id, {
    title: 'Vishva ERP',
    body: 'Push notifications are working on this device.',
    url: '/pages/login.html',
    type: 'test',
  });

  res.json({ success: true, result });
}));

module.exports = router;
