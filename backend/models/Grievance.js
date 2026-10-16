const mongoose = require('mongoose');

const grievanceSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  category: {
    type: String,
    enum: ['academic', 'infrastructure', 'facilities', 'harassment', 'fee', 'exam', 'library', 'hostel', 'transport', 'canteen', 'other'],
    required: true,
  },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'under-review', 'resolved', 'closed', 'reopened'],
    default: 'open',
  },
  escalationTier: { type: Number, default: 1, min: 1, max: 3 },
  slaDeadline: { type: Date },
  attachments: [{ type: String }],
  responses: [{
    responder: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: { type: String },
    isInternal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }],
  resolution: { type: String },
  resolvedAt: { type: Date },
  feedback: { type: String, enum: ['satisfied', 'partially-satisfied', 'not-satisfied'] },
  feedbackComment: { type: String },
  satisfactionRating: { type: Number, min: 1, max: 5 },
  isAnonymous: { type: Boolean, default: false },
  trackingId: { type: String, unique: true },
}, { timestamps: true });

grievanceSchema.index({ collegeId: 1, status: 1 });
grievanceSchema.index({ collegeId: 1, raisedBy: 1 });
grievanceSchema.index({ collegeId: 1, escalationTier: 1 });

grievanceSchema.pre('save', function (next) {
  if (!this.trackingId) {
    this.trackingId = `GRV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  if (!this.slaDeadline && this.isNew) {
    const hours = this.priority === 'urgent' ? 24 : (this.priority === 'high' ? 48 : (this.priority === 'medium' ? 120 : 168));
    this.slaDeadline = new Date(Date.now() + hours * 3600 * 1000);
  }
  next();
});

module.exports = mongoose.model('Grievance', grievanceSchema);
