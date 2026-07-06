const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  plan: { type: String, enum: ['basic', 'pro', 'enterprise'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
  razorpaySignature: { type: String },
  status: { type: String, enum: ['created', 'active', 'expired', 'cancelled', 'failed'], default: 'created' },
  startDate: { type: Date },
  endDate: { type: Date },
  billingCycle: { type: String, enum: ['monthly', 'quarterly', 'yearly'], default: 'yearly' },
  paymentHistory: [{
    razorpayOrderId: String,
    razorpayPaymentId: String,
    amount: Number,
    status: String,
    date: { type: Date, default: Date.now },
  }],
  receiptUrl: { type: String },
}, { timestamps: true });

subscriptionSchema.index({ collegeId: 1 });
subscriptionSchema.index({ collegeId: 1, status: 1 });

subscriptionSchema.methods.isActive = function () {
  return this.status === 'active' && this.endDate && this.endDate > new Date();
};

module.exports = mongoose.model('Subscription', subscriptionSchema);
