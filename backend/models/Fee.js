const mongoose = require('mongoose');

const installmentSchema = new mongoose.Schema({
  installmentNumber: { type: Number, required: true },
  amount: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  paidAmount: { type: Number, default: 0 },
  paidDate: { type: Date },
  status: { type: String, enum: ['pending', 'paid', 'partial', 'overdue', 'waived'], default: 'pending' },
  lateFee: { type: Number, default: 0 },
  lateFeeApplied: { type: Boolean, default: false },
  receiptNo: { type: String },
  paymentMethod: { type: String },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
}, { _id: true, timestamps: true });

const feeSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  feeType: { type: String, enum: ['tuition', 'hostel', 'transport', 'library', 'lab', 'exam', 'development', 'exam-retake', 'sports', 'other'], required: true },
  amount: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  paidDate: { type: Date },
  paidAmount: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'paid', 'partial', 'overdue', 'waived', 'cancelled'], default: 'pending' },
  receiptNo: { type: String, unique: true, sparse: true },
  paymentMethod: { type: String, enum: ['cash', 'online', 'cheque', 'dd', 'card', 'upi', 'wallet'] },
  semester: { type: Number },
  academicYear: { type: String },
  remarks: { type: String },
  department: { type: String },
  batch: { type: String },

  // Installment support
  installmentEnabled: { type: Boolean, default: false },
  installments: [installmentSchema],
  totalInstallments: { type: Number, default: 0 },
  installmentFrequency: { type: String, enum: ['monthly', 'quarterly', 'custom'], default: 'monthly' },

  // Late fee
  lateFeePerDay: { type: Number, default: 0 },
  lateFeeCap: { type: Number, default: 0 },
  totalLateFee: { type: Number, default: 0 },
  lateFeeEnabled: { type: Boolean, default: false },

  // Discount / Scholarship
  discountType: { type: String, enum: ['none', 'percentage', 'fixed', 'scholarship'], default: 'none' },
  discountValue: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  discountReason: { type: String },
  scholarshipName: { type: String },

  // Fee structure reference
  feeStructureId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeStructure' },

  // Payment history
  paymentHistory: [{
    amount: Number,
    date: Date,
    method: String,
    receiptNo: String,
    razorpayPaymentId: String,
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
}, { timestamps: true });

feeSchema.index({ collegeId: 1, studentId: 1 });
feeSchema.index({ collegeId: 1, status: 1 });
feeSchema.index({ dueDate: 1 });
feeSchema.index({ collegeId: 1, department: 1, semester: 1 });
feeSchema.index({ collegeId: 1, academicYear: 1 });

module.exports = mongoose.model('Fee', feeSchema);
