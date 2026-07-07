const asyncHandler = require('../middleware/asyncHandler');
const crypto = require('crypto');
const Fee = require('../models/Fee');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { emitDataChange } = require('../utils/realtime');
const { parseSemester } = require('../utils/parseHelpers');
const { logAudit } = require('../services/auditService');

let razorpay;
function getRazorpay() {
  if (!razorpay) {
    const Razorpay = require('razorpay');
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
      key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret',
    });
  }
  return razorpay;
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
  const body = orderId + '|' + paymentId;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret')
    .update(body)
    .digest('hex');
  return expectedSignature === signature;
}

const feeTypeMap = {
    'tuition fee': 'tuition',
    tuition: 'tuition',
    'hostel fee': 'hostel',
    hostel: 'hostel',
    'transport fee': 'transport',
    transport: 'transport',
    'library fee': 'library',
    library: 'library',
    'lab fee': 'lab',
    lab: 'lab',
    'exam fee': 'exam',
    exam: 'exam',
    other: 'other',
  };

// @desc    Create fee record
const createFee = asyncHandler(async (req, res) => {
    let studentId = req.body.studentId;
    if (!studentId && (req.body.rollNo || req.body.roll)) {
      const student = await User.findOne({ collegeId: req.user.collegeId, role: 'student', rollNo: req.body.rollNo || req.body.roll }).select('_id');
      studentId = student?._id;
    }

    if (!studentId) {
      return res.status(400).json({ success: false, message: 'Valid student is required' });
    }

    const rawFeeType = String(req.body.feeType || req.body.type || 'other').trim().toLowerCase();
    const fee = await Fee.create({
      collegeId: req.user.collegeId,
      studentId,
      feeType: feeTypeMap[rawFeeType] || 'other',
      amount: req.body.amount,
      dueDate: req.body.dueDate || new Date(),
      paidDate: req.body.paidDate,
      paidAmount: req.body.paidAmount || 0,
      status: req.body.status || 'pending',
      receiptNo: req.body.receiptNo || req.body.transactionId || req.body.fTxn,
      paymentMethod: req.body.paymentMethod || String(req.body.paymentMode || req.body.fMode || '').toLowerCase() || undefined,
      semester: parseSemester(req.body.semester || req.body.sem),
      academicYear: req.body.academicYear,
      remarks: req.body.remarks,
    });

    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'fees', action: 'created' });
    logAudit(req, 'create', 'fee', { resourceId: fee._id, description: `Created fee record for student`, metadata: { studentId, feeType: fee.feeType, amount: fee.amount } });
    res.status(201).json({ success: true, message: 'Fee record created', fee });
  });

// @desc    Get fees
const getFees = asyncHandler(async (req, res) => {
    const { studentId, status, semester, feeType } = req.query;
    const query = { collegeId: req.user.collegeId };
    
    if (studentId) query.studentId = studentId;
    if (status) query.status = status;
    if (semester) query.semester = parseInt(semester);
    if (feeType) query.feeType = feeType;

    // Students/parents can only view their own fees
    if (req.user.role === 'student') query.studentId = req.user._id;
    if (req.user.role === 'parent') {
      const parent = await User.findById(req.user._id);
      query.studentId = { $in: parent.children || [] };
    }

    const fees = await Fee.find(query).populate('studentId', 'name rollNo department').sort({ dueDate: 1 });
    res.json({ success: true, fees });
  });

// @desc    Pay fee
const payFee = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { amount, paymentMethod, receiptNo } = req.body;

    const fee = await Fee.findOne({ _id: id, collegeId: req.user.collegeId });
    if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

    if (req.user.role === 'student' && String(fee.studentId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only pay your own fees' });
    }

    if (req.user.role === 'parent') {
      const parent = await User.findById(req.user._id).select('children');
      const childIds = (parent?.children || []).map(String);
      if (!childIds.includes(String(fee.studentId))) {
        return res.status(403).json({ success: false, message: 'You can only pay your child fee records' });
      }
    }

    fee.paidAmount = (fee.paidAmount || 0) + amount;
    fee.paymentMethod = paymentMethod;
    fee.paidDate = new Date();
    fee.receiptNo = receiptNo || `RCPT-${Date.now()}`;
    
    if (fee.paidAmount >= fee.amount) {
      fee.status = 'paid';
    } else if (fee.paidAmount > 0) {
      fee.status = 'partial';
    }

    await fee.save();
    logAudit(req, 'fee_payment', 'fee', { resourceId: fee._id, description: `Payment of ${fee.paidAmount} recorded for fee`, metadata: { studentId: fee.studentId, amount: fee.paidAmount } });
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'fees', action: 'paid' });
    res.json({ success: true, message: 'Payment recorded', fee });
  });

const createBulkFees = asyncHandler(async (req, res) => {
  const { fees } = req.body;
  if (!fees || !Array.isArray(fees) || fees.length === 0) {
    return res.status(400).json({ success: false, message: 'Fees array is required' });
  }

  const records = fees.map(fee => ({
    collegeId: req.user.collegeId,
    studentId: fee.studentId,
    feeType: fee.feeType || 'tuition',
    amount: fee.amount,
    dueDate: fee.dueDate,
    semester: fee.semester,
    academicYear: fee.academicYear,
    receiptNo: fee.receiptNo,
    remarks: fee.remarks,
  }));

  const result = await Fee.insertMany(records, { ordered: false }).catch(err => {
    if (err.insertedDocs && err.insertedDocs.length > 0) {
      return err.insertedDocs;
    }
    throw err;
  });

  logAudit(req, 'bulk_create', 'fee', { description: `Bulk created ${Array.isArray(result) ? result.length : fees.length} fee records`, metadata: { count: Array.isArray(result) ? result.length : fees.length } });

  res.status(201).json({ success: true, message: `${Array.isArray(result) ? result.length : fees.length} fee records created`, fees: result });
});

// @desc    Create Razorpay order for fee payment
const createFeeOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const fee = await Fee.findOne({ _id: id, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

  if (req.user.role === 'student' && String(fee.studentId) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: 'You can only pay your own fees' });
  }

  const pendingAmount = fee.amount - (fee.paidAmount || 0);
  if (pendingAmount <= 0) return res.status(400).json({ success: false, message: 'Fee already paid' });

  const razorpayInstance = getRazorpay();
  const order = await razorpayInstance.orders.create({
    amount: pendingAmount * 100,
    currency: 'INR',
    receipt: `fee_${fee._id}_${Date.now()}`,
    notes: { feeId: String(fee._id), collegeId: String(req.user.collegeId) },
  });

  logAudit(req, 'create', 'fee-order', { resourceId: fee._id, description: `Created Razorpay order for fee payment of ₹${pendingAmount}` });

  res.status(201).json({
    success: true,
    order: { id: order.id, amount: pendingAmount * 100, currency: 'INR' },
    feeId: fee._id,
    pendingAmount,
    key: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
  });
});

// @desc    Verify Razorpay payment for fee
const verifyFeePayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, feeId } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !feeId) {
    return res.status(400).json({ success: false, message: 'Missing payment details' });
  }

  const isValid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!isValid) return res.status(400).json({ success: false, message: 'Invalid payment signature' });

  const fee = await Fee.findOne({ _id: feeId, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

  const pendingAmount = fee.amount - (fee.paidAmount || 0);
  fee.paidAmount = (fee.paidAmount || 0) + pendingAmount;
  fee.paymentMethod = 'online';
  fee.paidDate = new Date();
  fee.receiptNo = `FEE-${Date.now()}`;
  fee.status = 'paid';
  await fee.save();

  await Payment.create({
    collegeId: req.user.collegeId,
    userId: req.user._id,
    type: 'fee',
    referenceId: fee._id,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    amount: pendingAmount,
    currency: 'INR',
    status: 'captured',
    receiptNo: fee.receiptNo,
    description: `Fee payment - ${fee.feeType}`,
    metadata: { feeType: fee.feeType, semester: fee.semester },
  });

  logAudit(req, 'fee_payment', 'fee', { resourceId: fee._id, description: `Razorpay payment of ₹${pendingAmount} verified for fee`, metadata: { studentId: fee.studentId, amount: pendingAmount } });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'fees', action: 'paid' });

  res.json({ success: true, message: 'Payment verified and recorded', fee, receiptNo: fee.receiptNo });
});

module.exports = { createFee, getFees, payFee, createBulkFees, createFeeOrder, verifyFeePayment };
