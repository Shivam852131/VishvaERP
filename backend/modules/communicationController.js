const asyncHandler = require('../middleware/asyncHandler');
const { Message } = require('../models/Communication');
const User = require('../models/User');
const { emitDirectMessage } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

const getContactUsers = asyncHandler(async (req, res) => {
  const query = { _id: { $ne: req.user._id }, isActive: true };

  if (req.user.role !== 'superadmin') {
    query.collegeId = req.user.collegeId;
  }

  const users = await User.find(query)
    .select('name email role lastLogin isActive collegeId')
    .sort({ name: 1 });

  res.json({ success: true, users });
});

const getConversations = asyncHandler(async (req, res) => {
  const messages = await Message.find({
    $or: [{ senderId: req.user._id }, { receiverId: req.user._id }],
  })
    .populate('senderId', 'name role lastLogin')
    .populate('receiverId', 'name role lastLogin')
    .sort({ createdAt: -1 });

  const grouped = new Map();

  messages.forEach((message) => {
    const isSender = String(message.senderId._id) === String(req.user._id);
    const contact = isSender ? message.receiverId : message.senderId;
    const key = String(contact._id);

    if (!grouped.has(key)) {
      grouped.set(key, {
        _id: contact._id,
        name: contact.name,
        role: contact.role,
        lastLogin: contact.lastLogin,
        lastMessage: message.content,
        lastMessageAt: message.createdAt,
        unreadCount: 0,
      });
    }

    if (!isSender && !message.isRead) {
      grouped.get(key).unreadCount += 1;
    }
  });

  res.json({ success: true, conversations: Array.from(grouped.values()) });
});

const getMessages = asyncHandler(async (req, res) => {
  const otherUserId = req.params.userId;

  const messages = await Message.find({
    $or: [
      { senderId: req.user._id, receiverId: otherUserId },
      { senderId: otherUserId, receiverId: req.user._id },
    ],
  })
    .populate('senderId', 'name role')
    .populate('receiverId', 'name role')
    .sort({ createdAt: 1 });

  await Message.updateMany(
    { senderId: otherUserId, receiverId: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() }
  );

  res.json({ success: true, messages });
});

const sendMessage = asyncHandler(async (req, res) => {
  const { receiverId, content } = req.body;
  if (!receiverId || !content?.trim()) {
    return res.status(400).json({ success: false, message: 'Receiver and message are required' });
  }

  const receiver = await User.findById(receiverId).select('collegeId role isActive');
  if (!receiver || !receiver.isActive) {
    return res.status(404).json({ success: false, message: 'Receiver not found' });
  }

  if (req.user.role !== 'superadmin' && String(receiver.collegeId) !== String(req.user.collegeId)) {
    return res.status(403).json({ success: false, message: 'Cannot message users outside your college' });
  }

  const message = await Message.create({
    collegeId: req.user.collegeId || receiver.collegeId,
    senderId: req.user._id,
    receiverId,
    content: content.trim(),
    messageType: req.body.messageType || 'text',
    attachment: req.body.attachment || null,
  });

  logAudit(req, 'create', 'message', { resourceId: message._id, description: `Sent message to ${receiverId}`, metadata: { receiverId, messageType: message.messageType } });
  const populated = await Message.findById(message._id)
    .populate('senderId', 'name role')
    .populate('receiverId', 'name role');

  emitDirectMessage(req, [String(req.user._id), String(receiverId)], {
    action: 'created',
    message: populated,
  });

  res.status(201).json({ success: true, message: populated });
});

module.exports = {
  getContactUsers,
  getConversations,
  getMessages,
  sendMessage,
};
