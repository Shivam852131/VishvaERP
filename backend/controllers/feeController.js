const asyncHandler = require('../middleware/asyncHandler');
const Fee = require('../models/Fee');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { emitDataChange } = require('../utils/realtime');
const { parseSemester } = require('../utils/parseHelpers');
const { logAudit } = require('../services/auditService');
const {
  confirmRazorpayPayment,
  getRazorpay,
  getRazorpayKeyId,
  verifyRazorpaySignature,
} = require('../services/razorpayService');

function getPendingAmount(fee) {
  return Math.max(Number(fee.amount || 0) - Number(fee.paidAmount || 0), 0);
}

async function markFeePaymentFailed(req, fee, payment, failureReason, razorpayPaymentId) {
  if (payment && payment.status !== 'captured') {
    payment.status = 'failed';
    if (razorpayPaymentId) payment.razorpayPaymentId = razorpayPaymentId;
    payment.metadata = { ...(payment.metadata || {}), failureReason };
    await payment.save();
  }

  logAudit(req, 'fee_payment_failed', 'fee', {
    resourceId: fee._id,
    description: `Fee payment failed for ${fee.feeType}`,
    metadata: { studentId: fee.studentId, reason: failureReason, razorpayPaymentId },
  });
}

async function captureFeePayment(req, fee, payment, payload) {
  const paidAmount = Number(payment.amount || 0);

  if (payment.status === 'captured' && fee.receiptNo && Number(fee.paidAmount || 0) >= paidAmount) {
    return { fee, payment };
  }

  fee.paidAmount = Number(fee.paidAmount || 0) + paidAmount;
  fee.paymentMethod = 'online';
  fee.paidDate = new Date();
  fee.receiptNo = fee.receiptNo || `FEE-${Date.now()}-${String(fee._id).slice(-6)}`;
  fee.status = fee.paidAmount >= fee.amount ? 'paid' : 'partial';
  await fee.save();

  payment.razorpayPaymentId = payload.razorpayPaymentId;
  payment.razorpaySignature = payload.razorpaySignature || payment.razorpaySignature;
  payment.status = 'captured';
  payment.receiptNo = fee.receiptNo;
  payment.metadata = {
    ...(payment.metadata || {}),
    orderStatus: payload.orderStatus,
    paymentStatus: payload.paymentStatus,
    paymentMethod: payload.paymentMethod,
    email: payload.email,
    contact: payload.contact,
  };
  await payment.save();

  logAudit(req, 'fee_payment', 'fee', {
    resourceId: fee._id,
    description: `Razorpay payment of ₹${paidAmount} verified for fee`,
    metadata: { studentId: fee.studentId, amount: paidAmount, paymentId: payload.razorpayPaymentId },
  });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'fees', action: 'paid' });

  return { fee, payment };
}

async function canAccessFee(req, fee) {
  if (req.user.role === 'student') {
    return String(fee.studentId) === String(req.user._id);
  }

  if (req.user.role === 'parent') {
    const parent = await User.findById(req.user._id).select('children');
    const childIds = (parent?.children || []).map(String);
    return childIds.includes(String(fee.studentId));
  }

  return true;
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
    const paymentAmount = Number(amount);

    const fee = await Fee.findOne({ _id: id, collegeId: req.user.collegeId });
    if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

    if (!(await canAccessFee(req, fee))) {
      return res.status(403).json({ success: false, message: 'You are not allowed to pay this fee' });
    }

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid payment amount is required' });
    }

    const pendingAmount = getPendingAmount(fee);
    if (pendingAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Fee already paid' });
    }

    if (paymentAmount > pendingAmount) {
      return res.status(400).json({ success: false, message: 'Payment amount exceeds pending amount' });
    }

    fee.paidAmount = Number(fee.paidAmount || 0) + paymentAmount;
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

  if (!(await canAccessFee(req, fee))) {
    return res.status(403).json({ success: false, message: 'You are not allowed to pay this fee' });
  }

  const pendingAmount = getPendingAmount(fee);
  if (pendingAmount <= 0) return res.status(400).json({ success: false, message: 'Fee already paid' });

  const amountInPaise = Math.round(pendingAmount * 100);
  const razorpayInstance = getRazorpay();
  const order = await razorpayInstance.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: `fee_${Date.now()}_${String(fee._id).slice(-8)}`,
    notes: { feeId: String(fee._id), collegeId: String(req.user.collegeId) },
  });

  await Payment.create({
    collegeId: req.user.collegeId,
    userId: req.user._id,
    type: 'fee',
    referenceId: fee._id,
    razorpayOrderId: order.id,
    amount: pendingAmount,
    currency: 'INR',
    status: 'created',
    description: `Fee payment - ${fee.feeType}`,
    metadata: { feeType: fee.feeType, semester: fee.semester },
  });

  logAudit(req, 'create', 'fee-order', { resourceId: fee._id, description: `Created Razorpay order for fee payment of ₹${pendingAmount}` });

  res.status(201).json({
    success: true,
    order: { id: order.id, amount: amountInPaise, currency: 'INR' },
    feeId: fee._id,
    pendingAmount,
    key: getRazorpayKeyId(),
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

  if (!(await canAccessFee(req, fee))) {
    return res.status(403).json({ success: false, message: 'You are not allowed to pay this fee' });
  }

  const payment = await Payment.findOne({
    collegeId: req.user.collegeId,
    type: 'fee',
    referenceId: fee._id,
    razorpayOrderId,
    status: 'created',
  });

  if (!payment) {
    const processedPayment = await Payment.findOne({
      collegeId: req.user.collegeId,
      type: 'fee',
      referenceId: fee._id,
      razorpayOrderId,
      razorpayPaymentId,
      status: 'captured',
    });
    if (processedPayment) {
      return res.json({ success: true, message: 'Payment already verified', fee, receiptNo: fee.receiptNo });
    }

    return res.status(404).json({ success: false, message: 'Payment order not found or already processed' });
  }

  const pendingAmount = getPendingAmount(fee);
  const paidAmount = Number(payment.amount || 0);
  if (pendingAmount <= 0 || paidAmount > pendingAmount) {
    return res.status(400).json({ success: false, message: 'Fee amount changed. Please create a new payment order.' });
  }

  const { order, payment: razorpayPayment } = await confirmRazorpayPayment({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    expectedAmount: paidAmount,
    currency: payment.currency || 'INR',
  });

  if (razorpayPayment.status !== 'captured') {
    await markFeePaymentFailed(req, fee, payment, 'Payment is not captured by Razorpay yet', razorpayPaymentId);
    return res.status(400).json({ success: false, message: 'Payment is not captured by Razorpay yet' });
  }

  await captureFeePayment(req, fee, payment, {
    razorpayPaymentId,
    razorpaySignature,
    orderStatus: order?.status,
    paymentStatus: razorpayPayment.status,
    paymentMethod: razorpayPayment.method,
    email: razorpayPayment.email,
    contact: razorpayPayment.contact,
  });

  res.json({ success: true, message: 'Payment verified and recorded', fee, receiptNo: fee.receiptNo });
});

// @desc    Get live fee payment status for an order
const getFeePaymentStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const fee = await Fee.findOne({ _id: id, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

  if (!(await canAccessFee(req, fee))) {
    return res.status(403).json({ success: false, message: 'You are not allowed to view this fee payment' });
  }

  const payment = await Payment.findOne({
    collegeId: req.user.collegeId,
    type: 'fee',
    referenceId: fee._id,
    razorpayOrderId: req.query.orderId,
  }).sort({ createdAt: -1 });

  if (!payment) {
    return res.status(404).json({ success: false, message: 'Payment order not found' });
  }

  const lookupPaymentId = payment.razorpayPaymentId || req.query.razorpayPaymentId;
  let razorpayOrder = null;
  let razorpayPayment = null;

  try {
    if (lookupPaymentId && payment.status !== 'captured') {
      const confirmation = await confirmRazorpayPayment({
        orderId: payment.razorpayOrderId,
        paymentId: lookupPaymentId,
        expectedAmount: payment.amount,
        currency: payment.currency || 'INR',
      });
      razorpayOrder = confirmation.order;
      razorpayPayment = confirmation.payment;

      if (confirmation.localStatus === 'captured') {
        await captureFeePayment(req, fee, payment, {
          razorpayPaymentId: razorpayPayment.id,
          razorpaySignature: payment.razorpaySignature,
          orderStatus: razorpayOrder?.status,
          paymentStatus: razorpayPayment.status,
          paymentMethod: razorpayPayment.method,
          email: razorpayPayment.email,
          contact: razorpayPayment.contact,
        });
      } else if (confirmation.localStatus === 'failed') {
        await markFeePaymentFailed(req, fee, payment, 'Razorpay marked the payment as failed', razorpayPayment.id);
      }
    }
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) throw error;
  }

  const refreshedPayment = await Payment.findById(payment._id);
  const refreshedFee = await Fee.findById(fee._id);

  res.json({
    success: true,
    fee: refreshedFee,
    payment: refreshedPayment
      ? {
        id: String(refreshedPayment._id),
        status: refreshedPayment.status,
        orderId: refreshedPayment.razorpayOrderId,
        paymentId: refreshedPayment.razorpayPaymentId,
        receiptNo: refreshedPayment.receiptNo,
        amount: refreshedPayment.amount,
      }
      : null,
    razorpay: {
      orderStatus: razorpayOrder?.status || null,
      paymentStatus: razorpayPayment?.status || null,
    },
  });
});

module.exports = { createFee, getFees, payFee, createBulkFees, createFeeOrder, verifyFeePayment, getFeePaymentStatus };
