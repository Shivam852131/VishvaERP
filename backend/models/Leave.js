const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  leaveType: { type: String, enum: ['casual', 'sick', 'duty', 'earned', 'maternity', 'other'], required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  remarks: { type: String }, // Comments by approver
}, { timestamps: true });

leaveSchema.index({ collegeId: 1, userId: 1 });
leaveSchema.index({ collegeId: 1, status: 1 });

module.exports = mongoose.model('Leave', leaveSchema);
