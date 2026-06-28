const mongoose = require('mongoose');

const feeSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  feeType: { type: String, enum: ['tuition', 'hostel', 'transport', 'library', 'lab', 'exam', 'other'], required: true },
  amount: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  paidDate: { type: Date },
  paidAmount: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'paid', 'partial', 'overdue', 'waived'], default: 'pending' },
  receiptNo: { type: String, unique: true, sparse: true },
  paymentMethod: { type: String, enum: ['cash', 'online', 'cheque', 'dd', 'card'] },
  semester: { type: Number },
  academicYear: { type: String },
  remarks: { type: String },
}, { timestamps: true });

feeSchema.index({ collegeId: 1, studentId: 1 });
feeSchema.index({ collegeId: 1, status: 1 });
feeSchema.index({ dueDate: 1 });

module.exports = mongoose.model('Fee', feeSchema);
