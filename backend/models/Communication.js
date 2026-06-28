const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  messageType: { type: String, enum: ['text', 'file', 'image'], default: 'text' },
  attachment: { type: String },
}, { timestamps: true });

messageSchema.index({ senderId: 1, receiverId: 1 });
messageSchema.index({ receiverId: 1, isRead: 1 });
messageSchema.index({ collegeId: 1, createdAt: -1 });

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, enum: ['info', 'success', 'warning', 'error', 'exam', 'fee', 'attendance', 'assignment'], default: 'info' },
  link: { type: String },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
}, { timestamps: true });

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ collegeId: 1, createdAt: -1 });

const Message = mongoose.model('Message', messageSchema);
const Notification = mongoose.model('Notification', notificationSchema);

module.exports = { Message, Notification };
