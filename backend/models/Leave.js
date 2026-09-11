const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['faculty', 'student', 'staff'], default: 'faculty' },
  leaveType: {
    type: String,
    enum: [
      'casual',
      'sick',
      'duty',
      'earned',
      'maternity',
      'paternity',
      'study',
      'bereavement',
      'medical',
      'compensatory',
      'other',
    ],
    required: true,
  },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  isHalfDay: { type: Boolean, default: false },
  halfDaySession: { type: String, enum: ['first_half', 'second_half', null], default: null },
  totalDays: { type: Number, default: 1, min: 0.5 },
  reason: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
  },
  substituteFacultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  substituteStatus: {
    type: String,
    enum: ['not_required', 'pending', 'accepted', 'declined'],
    default: 'not_required',
  },
  substituteNotes: { type: String, default: '' },
  attachments: [{
    name: { type: String, required: true },
    url: { type: String, required: true },
    fileType: { type: String, default: 'document' },
    uploadedAt: { type: Date, default: Date.now },
  }],
  contactDuringLeave: { type: String, default: '' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  remarks: { type: String, default: '' },
  rejectionReason: { type: String, default: '' },
  actionHistory: [{
    action: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String },
    timestamp: { type: Date, default: Date.now },
    notes: { type: String },
  }],
}, { timestamps: true });

leaveSchema.index({ collegeId: 1, userId: 1 });
leaveSchema.index({ collegeId: 1, status: 1 });
leaveSchema.index({ collegeId: 1, substituteFacultyId: 1 });
leaveSchema.index({ collegeId: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('Leave', leaveSchema);
