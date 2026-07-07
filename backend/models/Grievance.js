const mongoose = require('mongoose');

const grievanceSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  category: { type: String, enum: ['academic', 'infrastructure', 'harassment', 'fee', 'exam', 'library', 'hostel', 'transport', 'canteen', 'other'], required: true },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  status: { type: String, enum: ['open', 'in-progress', 'under-review', 'resolved', 'closed', 'reopened'], default: 'open' },
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
  isAnonymous: { type: Boolean, default: false },
  trackingId: { type: String, unique: true },
}, { timestamps: true });

grievanceSchema.index({ collegeId: 1, status: 1 });
grievanceSchema.index({ collegeId: 1, raisedBy: 1 });

grievanceSchema.pre('save', function (next) {
  if (!this.trackingId) {
    this.trackingId = `GRV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('Grievance', grievanceSchema);
