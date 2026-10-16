const mongoose = require('mongoose');

const feeComponentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  feeType: { type: String, enum: ['tuition', 'hostel', 'transport', 'library', 'lab', 'exam', 'development', 'exam-retake', 'sports', 'other'], required: true },
  amount: { type: Number, required: true },
  description: { type: String },
  mandatory: { type: Boolean, default: true },
}, { _id: true });

const feeStructureSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true },
  description: { type: String },
  academicYear: { type: String, required: true },
  semester: { type: Number },
  department: { type: String },
  batch: { type: String },
  components: [feeComponentSchema],
  totalAmount: { type: Number, required: true },
  status: { type: String, enum: ['active', 'draft', 'archived'], default: 'active' },

  // Installment settings
  installmentEnabled: { type: Boolean, default: false },
  installmentCount: { type: Number, default: 1 },
  installmentFrequency: { type: String, enum: ['monthly', 'quarterly', 'custom'], default: 'monthly' },

  // Late fee settings
  lateFeePerDay: { type: Number, default: 0 },
  lateFeeCap: { type: Number, default: 0 },

  // Default discount
  defaultDiscountType: { type: String, enum: ['none', 'percentage', 'fixed'], default: 'none' },
  defaultDiscountValue: { type: Number, default: 0 },

  // Stats
  assignedCount: { type: Number, default: 0 },
  collectedCount: { type: Number, default: 0 },
  totalCollected: { type: Number, default: 0 },
}, { timestamps: true });

feeStructureSchema.index({ collegeId: 1, academicYear: 1 });
feeStructureSchema.index({ collegeId: 1, department: 1 });
feeStructureSchema.index({ collegeId: 1, status: 1 });

module.exports = mongoose.model('FeeStructure', feeStructureSchema);
