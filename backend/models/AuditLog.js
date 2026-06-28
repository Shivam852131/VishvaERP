const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userEmail: { type: String },
  userRole: { type: String, enum: ['superadmin', 'collegeAdmin', 'faculty', 'student', 'parent'] },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
  action: {
    type: String,
    required: true,
    enum: [
      'create', 'update', 'delete', 'login', 'logout', 'password_change', 'password_reset',
      'status_toggle', 'bulk_action', 'payment', 'fee_create', 'result_entry', 'attendance_mark',
      'assignment_grade', 'leave_approve', 'leave_reject', 'broadcast_send', 'settings_update',
      'user_import', 'report_download', 'id_card_generate',
    ],
  },
  resource: { type: String, required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId },
  description: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
  userAgent: { type: String },
  status: { type: String, enum: ['success', 'failure'], default: 'success' },
}, { timestamps: true });

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ collegeId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
