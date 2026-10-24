const asyncHandler = require('../middleware/asyncHandler');
const { Notification } = require('../models/Communication');
const { paginate } = require('../utils/paginate');
const { emitNotification } = require('../utils/realtime');

const getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const query = { userId: req.user._id };
  if (unreadOnly === 'true') query.isRead = false;

  const result = await paginate(Notification, query, {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { createdAt: -1 },
  });

  const unreadCount = await Notification.countDocuments({ userId: req.user._id, isRead: false });

  res.json({
    success: true,
    data: result.data,
    notifications: result.data,
    pagination: result.pagination,
    unreadCount,
  });
});

const createNotification = asyncHandler(async (req, res) => {
  const { userId, title, body, type, link } = req.body;
  if (!title || !body) {
    return res.status(400).json({ success: false, message: 'Title and body are required' });
  }

  const targetUserId = userId || req.user._id;

  const notification = await Notification.create({
    userId: targetUserId,
    collegeId: req.user.collegeId,
    title: String(title).trim(),
    body: String(body).trim(),
    type: type || 'info',
    link: link || null,
  });

  emitNotification(targetUserId, notification);
  if (req.io) {
    req.io.to(`user:${targetUserId}`).emit('notification', notification);
  }

  res.status(201).json({ success: true, notification });
});

const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
  if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
  const unreadCount = await Notification.countDocuments({ userId: req.user._id, isRead: false });
  res.json({ success: true, notification, unreadCount });
});

const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { userId: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() }
  );
  res.json({ success: true, message: 'All notifications marked as read', unreadCount: 0 });
});

const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    userId: req.user._id,
  });
  if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
  const unreadCount = await Notification.countDocuments({ userId: req.user._id, isRead: false });
  res.json({ success: true, message: 'Notification deleted', unreadCount });
});

const sendSelfTestNotification = asyncHandler(async (req, res) => {
  const { title = 'System Notification', body = 'Real-time notifications are active and connected.', type = 'info', link = null } = req.body || {};

  const notification = await Notification.create({
    userId: req.user._id,
    collegeId: req.user.collegeId,
    title: String(title).trim(),
    body: String(body).trim(),
    type: type || 'info',
    link,
  });

  emitNotification(req.user._id, notification);
  if (req.io) {
    req.io.to(`user:${req.user._id}`).emit('notification', notification);
  }

  const unreadCount = await Notification.countDocuments({ userId: req.user._id, isRead: false });

  res.status(201).json({ success: true, notification, unreadCount, message: 'Live notification dispatched' });
});

module.exports = {
  getNotifications,
  createNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  sendSelfTestNotification,
};

