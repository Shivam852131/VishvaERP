const asyncHandler = require('../middleware/asyncHandler');
const { Notification } = require('../models/Communication');
const { paginate } = require('../utils/paginate');

const getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const query = { userId: req.user._id, collegeId: req.user.collegeId };
  if (unreadOnly === 'true') query.isRead = false;

  const result = await paginate(Notification, query, {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { createdAt: -1 },
  });

  const unreadCount = await Notification.countDocuments({ ...query, isRead: false });

  res.json({ success: true, ...result, unreadCount });
});

const createNotification = asyncHandler(async (req, res) => {
  const { userId, title, body, type, link } = req.body;

  const notification = await Notification.create({
    userId,
    collegeId: req.user.collegeId,
    title,
    body,
    type: type || 'info',
    link,
  });

  if (req.io) {
    req.io.to(`user:${userId}`).emit('notification', notification);
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
  res.json({ success: true, notification });
});

const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { userId: req.user._id, collegeId: req.user.collegeId, isRead: false },
    { isRead: true, readAt: new Date() }
  );
  res.json({ success: true, message: 'All notifications marked as read' });
});

const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    userId: req.user._id,
  });
  if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
  res.json({ success: true, message: 'Notification deleted' });
});

module.exports = { getNotifications, createNotification, markAsRead, markAllAsRead, deleteNotification };
