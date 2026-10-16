const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  targetRoles: [{ type: String, enum: ['all', 'student', 'faculty', 'parent', 'collegeAdmin', 'superadmin'] }],
  priority: { type: String, enum: ['info', 'warning', 'urgent'], default: 'info' },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('Broadcast', broadcastSchema);
