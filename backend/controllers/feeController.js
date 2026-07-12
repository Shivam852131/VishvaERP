const asyncHandler = require('../middleware/asyncHandler');
const Fee = require('../models/Fee');
const FeeStructure = require('../models/FeeStructure');
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
  if (fee.installmentEnabled && fee.installments?.length) {
    return fee.installments
      .filter((i) => i.status !== 'paid' && i.status !== 'waived')
      .reduce((sum, i) => sum + Math.max(Number(i.amount || 0) - Number(i.paidAmount || 0), 0), 0);
  }
  return Math.max(Number(fee.amount || 0) - Number(fee.paidAmount || 0), 0);
}

function recalcFeeStatus(fee) {
  if (fee.installmentEnabled && fee.installments?.length) {
    const totalPending = fee.installments
      .filter((i) => i.status !== 'waived')
      .reduce((sum, i) => sum + Math.max(Number(i.amount || 0) - Number(i.paidAmount || 0), 0), 0);
    const totalPaid = fee.installments.reduce((sum, i) => sum + Number(i.paidAmount || 0), 0);
    fee.paidAmount = totalPaid;
    if (totalPending <= 0) fee.status = 'paid';
    else if (totalPaid > 0) fee.status = 'partial';
    else {
      const hasOverdue = fee.installments.some((i) => i.status === 'overdue');
      fee.status = hasOverdue ? 'overdue' : 'pending';
    }
  } else {
    if (fee.paidAmount >= fee.amount) fee.status = 'paid';
    else if (fee.paidAmount > 0) fee.status = 'partial';
  }
}

function generateInstallments(fee, count, frequency, baseDate) {
  const installments = [];
  const baseAmount = Math.floor(fee.amount / count);
  const remainder = fee.amount - baseAmount * count;

  for (let i = 0; i < count; i++) {
    const dueDate = new Date(baseDate);
    if (frequency === 'monthly') dueDate.setMonth(dueDate.getMonth() + i);
    else if (frequency === 'quarterly') dueDate.setMonth(dueDate.getMonth() + i * 3);
    else dueDate.setDate(dueDate.getDate() + (i * 30));

    installments.push({
      installmentNumber: i + 1,
      amount: i === 0 ? baseAmount + remainder : baseAmount,
      dueDate,
      status: 'pending',
    });
  }
  return installments;
}

function calculateLateFees(fee) {
  if (!fee.lateFeeEnabled || !fee.lateFeePerDay) return 0;
  const now = new Date();
  let totalLateFee = 0;

  if (fee.installmentEnabled && fee.installments?.length) {
    fee.installments.forEach((inst) => {
      if (inst.status !== 'paid' && inst.status !== 'waived' && new Date(inst.dueDate) < now) {
        const daysOverdue = Math.floor((now - new Date(inst.dueDate)) / (1000 * 60 * 60 * 24));
        const lateFee = Math.min(daysOverdue * fee.lateFeePerDay, fee.lateFeeCap || Infinity);
        inst.lateFee = lateFee;
        inst.lateFeeApplied = true;
        inst.status = 'overdue';
        totalLateFee += lateFee;
      }
    });
  } else if (new Date(fee.dueDate) < now && fee.status !== 'paid' && fee.status !== 'waived') {
    const daysOverdue = Math.floor((now - new Date(fee.dueDate)) / (1000 * 60 * 60 * 24));
    totalLateFee = Math.min(daysOverdue * fee.lateFeePerDay, fee.lateFeeCap || Infinity);
  }

  fee.totalLateFee = totalLateFee;
  return totalLateFee;
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

  fee.paymentHistory = fee.paymentHistory || [];
  fee.paymentHistory.push({
    amount: paidAmount,
    date: new Date(),
    method: 'online',
    receiptNo: fee.receiptNo,
    razorpayPaymentId: payload.razorpayPaymentId,
    recordedBy: req.user._id,
  });

  recalcFeeStatus(fee);
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
  if (req.user.role === 'student') return String(fee.studentId) === String(req.user._id);
  if (req.user.role === 'parent') {
    const parent = await User.findById(req.user._id).select('children');
    return (parent?.children || []).map(String).includes(String(fee.studentId));
  }
  return true;
}

const feeTypeMap = {
  'tuition fee': 'tuition', tuition: 'tuition', 'hostel fee': 'hostel', hostel: 'hostel',
  'transport fee': 'transport', transport: 'transport', 'library fee': 'library', library: 'library',
  'lab fee': 'lab', lab: 'lab', 'exam fee': 'exam', exam: 'exam',
  'development fee': 'development', development: 'development',
  'exam retake': 'exam-retake', 'exam-retake': 'exam-retake',
  sports: 'sports', other: 'other',
};

// ═══════════════════════════════════════════
// FEE STRUCTURE MANAGEMENT
// ═══════════════════════════════════════════

const createFeeStructure = asyncHandler(async (req, res) => {
  const { name, description, academicYear, semester, department, batch, components, installmentEnabled, installmentCount, installmentFrequency, lateFeePerDay, lateFeeCap, defaultDiscountType, defaultDiscountValue } = req.body;
  if (!name || !academicYear || !components?.length) {
    return res.status(400).json({ success: false, message: 'Name, academic year, and at least one component required' });
  }
  const totalAmount = components.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const structure = await FeeStructure.create({
    collegeId: req.user.collegeId, name, description, academicYear, semester, department, batch,
    components, totalAmount,
    installmentEnabled: !!installmentEnabled, installmentCount: installmentCount || 1, installmentFrequency: installmentFrequency || 'monthly',
    lateFeePerDay: lateFeePerDay || 0, lateFeeCap: lateFeeCap || 0,
    defaultDiscountType: defaultDiscountType || 'none', defaultDiscountValue: defaultDiscountValue || 0,
  });
  logAudit(req, 'create', 'fee-structure', { resourceId: structure._id, description: `Created fee structure: ${name}` });
  res.status(201).json({ success: true, structure });
});

const getFeeStructures = asyncHandler(async (req, res) => {
  const { status, academicYear, department } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (status) query.status = status;
  if (academicYear) query.academicYear = academicYear;
  if (department) query.department = department;
  const structures = await FeeStructure.find(query).sort({ createdAt: -1 });
  res.json({ success: true, structures });
});

const updateFeeStructure = asyncHandler(async (req, res) => {
  const structure = await FeeStructure.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!structure) return res.status(404).json({ success: false, message: 'Fee structure not found' });
  const allowed = ['name', 'description', 'status', 'components', 'installmentEnabled', 'installmentCount', 'installmentFrequency', 'lateFeePerDay', 'lateFeeCap', 'defaultDiscountType', 'defaultDiscountValue'];
  allowed.forEach((field) => { if (req.body[field] !== undefined) structure[field] = req.body[field]; });
  if (req.body.components) structure.totalAmount = structure.components.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  await structure.save();
  res.json({ success: true, structure });
});

const deleteFeeStructure = asyncHandler(async (req, res) => {
  const structure = await FeeStructure.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!structure) return res.status(404).json({ success: false, message: 'Fee structure not found' });
  res.json({ success: true, message: 'Fee structure deleted' });
});

// ═══════════════════════════════════════════
// BULK FEE ASSIGNMENT
// ═══════════════════════════════════════════

const assignFeeStructure = asyncHandler(async (req, res) => {
  const { structureId, studentIds, department, semester, academicYear, dueDate, discountType, discountValue, discountReason, scholarshipName } = req.body;
  if (!structureId || (!studentIds?.length && !department)) {
    return res.status(400).json({ success: false, message: 'Structure ID and students or department required' });
  }

  const structure = await FeeStructure.findOne({ _id: structureId, collegeId: req.user.collegeId });
  if (!structure) return res.status(404).json({ success: false, message: 'Fee structure not found' });

  let targetStudents = studentIds || [];
  if (!targetStudents.length && department) {
    const query = { collegeId: req.user.collegeId, role: 'student' };
    if (department) query.department = department;
    if (semester) query.semester = parseInt(semester);
    const students = await User.find(query).select('_id');
    targetStudents = students.map((s) => String(s._id));
  }

  if (!targetStudents.length) return res.status(400).json({ success: false, message: 'No students found for assignment' });

  const totalAmount = structure.totalAmount;
  const discountAmt = discountType === 'percentage' ? Math.round(totalAmount * (discountValue / 100)) : discountType === 'fixed' ? discountValue : 0;
  const finalAmount = totalAmount - discountAmt;

  const feeRecords = [];
  for (const studentId of targetStudents) {
    const existing = await Fee.findOne({ collegeId: req.user.collegeId, studentId, feeStructureId: structure._id, academicYear: academicYear || structure.academicYear });
    if (existing) continue;

    const feeData = {
      collegeId: req.user.collegeId,
      studentId,
      feeType: structure.components[0]?.feeType || 'tuition',
      amount: finalAmount,
      dueDate: dueDate || new Date(),
      semester: semester || structure.semester,
      academicYear: academicYear || structure.academicYear,
      department: department || structure.department,
      batch: structure.batch,
      installmentEnabled: structure.installmentEnabled,
      installmentFrequency: structure.installmentFrequency,
      lateFeeEnabled: structure.lateFeePerDay > 0,
      lateFeePerDay: structure.lateFeePerDay,
      lateFeeCap: structure.lateFeeCap,
      feeStructureId: structure._id,
      discountType: discountType || structure.defaultDiscountType || 'none',
      discountValue: discountValue || structure.defaultDiscountValue || 0,
      discountAmount: discountAmt,
      discountReason,
      scholarshipName: discountType === 'scholarship' ? scholarshipName : undefined,
    };

    if (structure.installmentEnabled && structure.installmentCount > 1) {
      feeData.installments = generateInstallments({ amount: finalAmount }, structure.installmentCount, structure.installmentFrequency, dueDate || new Date());
      feeData.totalInstallments = structure.installmentCount;
    }

    feeRecords.push(feeData);
  }

  const created = feeRecords.length ? await Fee.insertMany(feeRecords, { ordered: false }).catch((err) => err.insertedDocs || []) : [];

  structure.assignedCount = (structure.assignedCount || 0) + created.length;
  await structure.save();

  logAudit(req, 'bulk_assign', 'fee', { description: `Assigned fee structure to ${created.length} students`, metadata: { structureId, count: created.length } });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'fees', action: 'created' });

  res.status(201).json({ success: true, message: `Fee assigned to ${created.length} students`, count: created.length, fees: created });
});

// ═══════════════════════════════════════════
// FEE CRUD + PAYMENT
// ═══════════════════════════════════════════

const createFee = asyncHandler(async (req, res) => {
  let studentId = req.body.studentId;
  if (!studentId && (req.body.rollNo || req.body.roll)) {
    const student = await User.findOne({ collegeId: req.user.collegeId, role: 'student', rollNo: req.body.rollNo || req.body.roll }).select('_id');
    studentId = student?._id;
  }
  if (!studentId) return res.status(400).json({ success: false, message: 'Valid student is required' });

  const rawFeeType = String(req.body.feeType || req.body.type || 'other').trim().toLowerCase();
  const fee = await Fee.create({
    collegeId: req.user.collegeId, studentId,
    feeType: feeTypeMap[rawFeeType] || 'other',
    amount: req.body.amount, dueDate: req.body.dueDate || new Date(),
    paidDate: req.body.paidDate, paidAmount: req.body.paidAmount || 0,
    status: req.body.status || 'pending',
    receiptNo: req.body.receiptNo || req.body.transactionId || req.body.fTxn,
    paymentMethod: req.body.paymentMethod || String(req.body.paymentMode || req.body.fMode || '').toLowerCase() || undefined,
    semester: parseSemester(req.body.semester || req.body.sem),
    academicYear: req.body.academicYear, remarks: req.body.remarks,
    department: req.body.department, batch: req.body.batch,
    lateFeeEnabled: !!req.body.lateFeePerDay, lateFeePerDay: req.body.lateFeePerDay || 0, lateFeeCap: req.body.lateFeeCap || 0,
    discountType: req.body.discountType || 'none', discountValue: req.body.discountValue || 0,
    discountAmount: req.body.discountAmount || 0, discountReason: req.body.discountReason,
  });

  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'fees', action: 'created' });
  logAudit(req, 'create', 'fee', { resourceId: fee._id, description: `Created fee record`, metadata: { studentId, feeType: fee.feeType, amount: fee.amount } });
  res.status(201).json({ success: true, message: 'Fee record created', fee });
});

const getFees = asyncHandler(async (req, res) => {
  const { studentId, status, semester, feeType, department, academicYear, overdue } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (studentId) query.studentId = studentId;
  if (status) query.status = status;
  if (semester) query.semester = parseInt(semester);
  if (feeType) query.feeType = feeType;
  if (department) query.department = department;
  if (academicYear) query.academicYear = academicYear;

  if (req.user.role === 'student') query.studentId = req.user._id;
  if (req.user.role === 'parent') {
    const parent = await User.findById(req.user._id);
    query.studentId = { $in: parent.children || [] };
  }

  if (overdue === 'true') {
    query.status = { $in: ['pending', 'partial', 'overdue'] };
    query.dueDate = { $lt: new Date() };
  }

  const fees = await Fee.find(query).populate('studentId', 'name rollNo department semester').populate('feeStructureId', 'name').sort({ dueDate: 1 });

  fees.forEach((fee) => {
    calculateLateFees(fee);
    recalcFeeStatus(fee);
  });

  if (overdue === 'true') {
    await Fee.updateMany({ _id: { $in: fees.filter((f) => f.status === 'overdue').map((f) => f._id) } }, { $set: { status: 'overdue' } });
  }

  res.json({ success: true, fees });
});

const getFeeById = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('studentId', 'name rollNo department semester email phone')
    .populate('feeStructureId', 'name components');
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  if (!(await canAccessFee(req, fee))) return res.status(403).json({ success: false, message: 'Access denied' });
  calculateLateFees(fee);
  res.json({ success: true, fee });
});

const payFee = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, paymentMethod, receiptNo, installmentId } = req.body;
  const paymentAmount = Number(amount);
  const fee = await Fee.findOne({ _id: id, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  if (!(await canAccessFee(req, fee))) return res.status(403).json({ success: false, message: 'Access denied' });
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) return res.status(400).json({ success: false, message: 'Valid amount required' });

  if (fee.installmentEnabled && installmentId) {
    const installment = fee.installments.id(installmentId);
    if (!installment) return res.status(404).json({ success: false, message: 'Installment not found' });
    const pending = Math.max(Number(installment.amount || 0) - Number(installment.paidAmount || 0), 0);
    if (paymentAmount > pending) return res.status(400).json({ success: false, message: `Installment pending: ₹${pending}` });
    installment.paidAmount = Number(installment.paidAmount || 0) + paymentAmount;
    installment.paidDate = new Date();
    installment.paymentMethod = paymentMethod;
    installment.receiptNo = receiptNo || `INS-${Date.now()}`;
    installment.status = installment.paidAmount >= installment.amount ? 'paid' : 'partial';
  } else {
    const pendingAmount = getPendingAmount(fee);
    if (pendingAmount <= 0) return res.status(400).json({ success: false, message: 'Fee already paid' });
    if (paymentAmount > pendingAmount) return res.status(400).json({ success: false, message: 'Amount exceeds pending' });
    fee.paidAmount = Number(fee.paidAmount || 0) + paymentAmount;
    fee.paymentMethod = paymentMethod;
    fee.paidDate = new Date();
    fee.receiptNo = receiptNo || `RCPT-${Date.now()}`;
  }

  fee.paymentHistory = fee.paymentHistory || [];
  fee.paymentHistory.push({ amount: paymentAmount, date: new Date(), method: paymentMethod, receiptNo: fee.receiptNo, recordedBy: req.user._id });
  recalcFeeStatus(fee);
  await fee.save();

  logAudit(req, 'fee_payment', 'fee', { resourceId: fee._id, description: `Payment of ₹${paymentAmount}`, metadata: { studentId: fee.studentId, amount: paymentAmount } });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'fees', action: 'paid' });
  res.json({ success: true, message: 'Payment recorded', fee });
});

const createBulkFees = asyncHandler(async (req, res) => {
  const { fees } = req.body;
  if (!fees?.length) return res.status(400).json({ success: false, message: 'Fees array required' });
  const records = fees.map((f) => ({
    collegeId: req.user.collegeId, studentId: f.studentId, feeType: f.feeType || 'tuition',
    amount: f.amount, dueDate: f.dueDate, semester: f.semester, academicYear: f.academicYear,
    department: f.department, batch: f.batch,
    lateFeePerDay: f.lateFeePerDay || 0, lateFeeCap: f.lateFeeCap || 0, lateFeeEnabled: !!f.lateFeePerDay,
  }));
  const result = await Fee.insertMany(records, { ordered: false }).catch((err) => err.insertedDocs || []);
  logAudit(req, 'bulk_create', 'fee', { description: `Bulk created ${result.length} fees` });
  res.status(201).json({ success: true, count: result.length, fees: result });
});

// ═══════════════════════════════════════════
// RAZORPAY INTEGRATION
// ═══════════════════════════════════════════

const createFeeOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const fee = await Fee.findOne({ _id: id, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  if (!(await canAccessFee(req, fee))) return res.status(403).json({ success: false, message: 'Access denied' });
  const pendingAmount = getPendingAmount(fee);
  if (pendingAmount <= 0) return res.status(400).json({ success: false, message: 'Fee already paid' });

  const amountInPaise = Math.round(pendingAmount * 100);
  const razorpayInstance = getRazorpay();
  const order = await razorpayInstance.orders.create({
    amount: amountInPaise, currency: 'INR',
    receipt: `fee_${Date.now()}_${String(fee._id).slice(-8)}`,
    notes: { feeId: String(fee._id), collegeId: String(req.user.collegeId) },
  });

  await Payment.create({
    collegeId: req.user.collegeId, userId: req.user._id, type: 'fee', referenceId: fee._id,
    razorpayOrderId: order.id, amount: pendingAmount, currency: 'INR', status: 'created',
    description: `Fee payment - ${fee.feeType}`, metadata: { feeType: fee.feeType, semester: fee.semester },
  });

  logAudit(req, 'create', 'fee-order', { resourceId: fee._id, description: `Razorpay order for ₹${pendingAmount}` });
  res.status(201).json({ success: true, order: { id: order.id, amount: amountInPaise, currency: 'INR' }, feeId: fee._id, pendingAmount, key: getRazorpayKeyId() });
});

const verifyFeePayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, feeId } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !feeId) {
    return res.status(400).json({ success: false, message: 'Missing payment details' });
  }
  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return res.status(400).json({ success: false, message: 'Invalid payment signature' });
  }
  const fee = await Fee.findOne({ _id: feeId, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  if (!(await canAccessFee(req, fee))) return res.status(403).json({ success: false, message: 'Access denied' });

  let payment = await Payment.findOne({ collegeId: req.user.collegeId, type: 'fee', referenceId: fee._id, razorpayOrderId, status: 'created' });
  if (!payment) {
    const existing = await Payment.findOne({ collegeId: req.user.collegeId, type: 'fee', referenceId: fee._id, razorpayOrderId, razorpayPaymentId, status: 'captured' });
    if (existing) return res.json({ success: true, message: 'Payment already verified', fee, receiptNo: fee.receiptNo });
    return res.status(404).json({ success: false, message: 'Payment order not found' });
  }

  const paidAmount = Number(payment.amount || 0);
  const { order, payment: razorpayPayment } = await confirmRazorpayPayment({ orderId: razorpayOrderId, paymentId: razorpayPaymentId, expectedAmount: paidAmount, currency: payment.currency || 'INR' });
  if (razorpayPayment.status !== 'captured') {
    await markFeePaymentFailed(req, fee, payment, 'Not captured', razorpayPaymentId);
    return res.status(400).json({ success: false, message: 'Payment not captured by Razorpay' });
  }

  await captureFeePayment(req, fee, payment, { razorpayPaymentId, razorpaySignature, orderStatus: order?.status, paymentStatus: razorpayPayment.status, paymentMethod: razorpayPayment.method, email: razorpayPayment.email, contact: razorpayPayment.contact });
  res.json({ success: true, message: 'Payment verified', fee, receiptNo: fee.receiptNo });
});

const getFeePaymentStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const fee = await Fee.findOne({ _id: id, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  if (!(await canAccessFee(req, fee))) return res.status(403).json({ success: false, message: 'Access denied' });

  const payment = await Payment.findOne({ collegeId: req.user.collegeId, type: 'fee', referenceId: fee._id, razorpayOrderId: req.query.orderId }).sort({ createdAt: -1 });
  if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

  let razorpayOrder = null, razorpayPayment = null;
  const lookupPaymentId = payment.razorpayPaymentId || req.query.razorpayPaymentId;
  try {
    if (lookupPaymentId && payment.status !== 'captured') {
      const confirmation = await confirmRazorpayPayment({ orderId: payment.razorpayOrderId, paymentId: lookupPaymentId, expectedAmount: payment.amount, currency: payment.currency || 'INR' });
      razorpayOrder = confirmation.order; razorpayPayment = confirmation.payment;
      if (confirmation.localStatus === 'captured') {
        await captureFeePayment(req, fee, payment, { razorpayPaymentId: razorpayPayment.id, razorpaySignature: payment.razorpaySignature, orderStatus: razorpayOrder?.status, paymentStatus: razorpayPayment.status, paymentMethod: razorpayPayment.method, email: razorpayPayment.email, contact: razorpayPayment.contact });
      } else if (confirmation.localStatus === 'failed') {
        await markFeePaymentFailed(req, fee, payment, 'Failed at gateway', razorpayPayment.id);
      }
    }
  } catch (e) { if (e.statusCode && e.statusCode < 500) throw e; }

  const refreshedPayment = await Payment.findById(payment._id);
  const refreshedFee = await Fee.findById(fee._id);
  res.json({ success: true, fee: refreshedFee, payment: refreshedPayment ? { id: String(refreshedPayment._id), status: refreshedPayment.status, orderId: refreshedPayment.razorpayOrderId, paymentId: refreshedPayment.razorpayPaymentId, receiptNo: refreshedPayment.receiptNo, amount: refreshedPayment.amount } : null, razorpay: { orderStatus: razorpayOrder?.status, paymentStatus: razorpayPayment?.status } });
});

// ═══════════════════════════════════════════
// INSTALLMENT MANAGEMENT
// ═══════════════════════════════════════════

const getInstallments = asyncHandler(async (req, res) => {
  const { studentId } = req.query;
  const query = { collegeId: req.user.collegeId, installmentEnabled: true };
  if (studentId) query.studentId = studentId;
  if (req.user.role === 'student') query.studentId = req.user._id;
  if (req.user.role === 'parent') {
    const parent = await User.findById(req.user._id);
    query.studentId = { $in: parent.children || [] };
  }
  const fees = await Fee.find(query).populate('studentId', 'name rollNo department').sort({ dueDate: 1 });
  fees.forEach((f) => { calculateLateFees(f); recalcFeeStatus(f); });
  res.json({ success: true, fees });
});

const updateInstallment = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  const installment = fee.installments.id(req.params.installmentId);
  if (!installment) return res.status(404).json({ success: false, message: 'Installment not found' });
  if (req.body.status) installment.status = req.body.status;
  if (req.body.dueDate) installment.dueDate = req.body.dueDate;
  if (req.body.amount) installment.amount = req.body.amount;
  recalcFeeStatus(fee);
  await fee.save();
  res.json({ success: true, fee });
});

const createInstallmentOrder = asyncHandler(async (req, res) => {
  const { id, installmentId } = req.params;
  const fee = await Fee.findOne({ _id: id, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  if (!(await canAccessFee(req, fee))) return res.status(403).json({ success: false, message: 'Access denied' });

  const installment = fee.installments.id(installmentId);
  if (!installment) return res.status(404).json({ success: false, message: 'Installment not found' });
  const pending = Math.max(Number(installment.amount || 0) - Number(installment.paidAmount || 0), 0);
  if (pending <= 0) return res.status(400).json({ success: false, message: 'Installment already paid' });

  const amountInPaise = Math.round(pending * 100);
  const razorpayInstance = getRazorpay();
  const order = await razorpayInstance.orders.create({
    amount: amountInPaise, currency: 'INR',
    receipt: `inst_${Date.now()}_${String(fee._id).slice(-8)}_${installment.installmentNumber}`,
    notes: { feeId: String(fee._id), installmentId: String(installment._id), installmentNumber: installment.installmentNumber },
  });

  await Payment.create({
    collegeId: req.user.collegeId, userId: req.user._id, type: 'fee', referenceId: fee._id,
    razorpayOrderId: order.id, amount: pending, currency: 'INR', status: 'created',
    description: `Installment ${installment.installmentNumber} - ${fee.feeType}`,
    metadata: { installmentId: String(installment._id), installmentNumber: installment.installmentNumber },
  });

  res.status(201).json({ success: true, order: { id: order.id, amount: amountInPaise, currency: 'INR' }, feeId: fee._id, installmentId, pendingAmount: pending, key: getRazorpayKeyId() });
});

// ═══════════════════════════════════════════
// LATE FEE MANAGEMENT
// ═══════════════════════════════════════════

const applyLateFees = asyncHandler(async (req, res) => {
  const fees = await Fee.find({ collegeId: req.user.collegeId, lateFeeEnabled: true, status: { $in: ['pending', 'partial', 'overdue'] } });
  let updated = 0;
  for (const fee of fees) {
    calculateLateFees(fee);
    await fee.save();
    updated++;
  }
  logAudit(req, 'bulk_update', 'fee', { description: `Applied late fees to ${updated} records` });
  res.json({ success: true, message: `Late fees applied to ${updated} records`, updated });
});

const waiveFee = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  fee.status = 'waived';
  fee.remarks = req.body.reason || 'Waived by admin';
  fee.paidAmount = fee.amount;
  recalcFeeStatus(fee);
  await fee.save();
  logAudit(req, 'fee_waive', 'fee', { resourceId: fee._id, description: `Fee waived: ${fee.remarks}` });
  res.json({ success: true, message: 'Fee waived', fee });
});

const applyDiscount = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  const { discountType, discountValue, discountReason, scholarshipName } = req.body;
  const discountAmount = discountType === 'percentage' ? Math.round(fee.amount * (discountValue / 100)) : discountType === 'fixed' ? discountValue : 0;
  fee.discountType = discountType || 'none';
  fee.discountValue = discountValue || 0;
  fee.discountAmount = discountAmount;
  fee.discountReason = discountReason;
  fee.scholarshipName = discountType === 'scholarship' ? scholarshipName : undefined;
  if (discountAmount > 0) fee.amount = Math.max(fee.amount - discountAmount, 0);
  recalcFeeStatus(fee);
  await fee.save();
  logAudit(req, 'fee_discount', 'fee', { resourceId: fee._id, description: `Discount of ₹${discountAmount} applied` });
  res.json({ success: true, message: 'Discount applied', fee });
});

// ═══════════════════════════════════════════
// ANALYTICS & REPORTS
// ═══════════════════════════════════════════

const getFeeAnalytics = asyncHandler(async (req, res) => {
  const { academicYear, department } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (academicYear) query.academicYear = academicYear;
  if (department) query.department = department;

  const fees = await Fee.find(query).populate('studentId', 'name rollNo department');
  const totalFees = fees.length;
  const paid = fees.filter((f) => f.status === 'paid');
  const partial = fees.filter((f) => f.status === 'partial');
  const pending = fees.filter((f) => f.status === 'pending');
  const overdue = fees.filter((f) => f.status === 'overdue' || (f.status !== 'paid' && f.status !== 'waived' && new Date(f.dueDate) < new Date()));
  const waived = fees.filter((f) => f.status === 'waived');

  const totalAmount = fees.reduce((s, f) => s + Number(f.amount || 0), 0);
  const collectedAmount = paid.reduce((s, f) => s + Number(f.amount || 0), 0) + partial.reduce((s, f) => s + Number(f.paidAmount || 0), 0);
  const pendingAmount = pending.reduce((s, f) => s + Math.max(Number(f.amount || 0) - Number(f.paidAmount || 0), 0), 0)
    + partial.reduce((s, f) => s + Math.max(Number(f.amount || 0) - Number(f.paidAmount || 0), 0), 0)
    + overdue.reduce((s, f) => s + Math.max(Number(f.amount || 0) - Number(f.paidAmount || 0), 0), 0);
  const overdueAmount = overdue.reduce((s, f) => s + Math.max(Number(f.amount || 0) - Number(f.paidAmount || 0), 0), 0);
  const totalLateFees = fees.reduce((s, f) => s + Number(f.totalLateFee || 0), 0);
  const totalDiscounts = fees.reduce((s, f) => s + Number(f.discountAmount || 0), 0);

  const byType = {};
  fees.forEach((f) => { byType[f.feeType] = (byType[f.feeType] || 0) + Number(f.amount || 0); });

  const byDepartment = {};
  fees.forEach((f) => { const dept = f.department || f.studentId?.department || 'Unknown'; byDepartment[dept] = (byDepartment[dept] || 0) + Number(f.amount || 0); });

  const byMonth = {};
  fees.forEach((f) => {
    const month = new Date(f.paidDate || f.dueDate).toISOString().slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { collected: 0, pending: 0 };
    if (f.status === 'paid' || f.status === 'partial') byMonth[month].collected += Number(f.paidAmount || 0);
    else byMonth[month].pending += Math.max(Number(f.amount || 0) - Number(f.paidAmount || 0), 0);
  });

  const installmentStats = { total: 0, paid: 0, pending: 0, overdue: 0 };
  fees.filter((f) => f.installmentEnabled).forEach((f) => {
    f.installments.forEach((i) => {
      installmentStats.total++;
      if (i.status === 'paid') installmentStats.paid++;
      else if (i.status === 'overdue') installmentStats.overdue++;
      else installmentStats.pending++;
    });
  });

  res.json({
    success: true,
    analytics: {
      totalFees, paidCount: paid.length, partialCount: partial.length, pendingCount: pending.length, overdueCount: overdue.length, waivedCount: waived.length,
      totalAmount, collectedAmount, pendingAmount, overdueAmount, totalLateFees, totalDiscounts,
      collectionRate: totalAmount > 0 ? Math.round((collectedAmount / totalAmount) * 100) : 0,
      byType, byDepartment, byMonth,
      installmentStats,
    },
  });
});

const getFeeSummary = asyncHandler(async (req, res) => {
  const fees = await Fee.find({ collegeId: req.user.collegeId });
  const total = fees.length;
  const paid = fees.filter((f) => f.status === 'paid').length;
  const pending = fees.filter((f) => f.status === 'pending').length;
  const partial = fees.filter((f) => f.status === 'partial').length;
  const overdue = fees.filter((f) => f.status === 'overdue').length;
  const totalAmount = fees.reduce((s, f) => s + Number(f.amount || 0), 0);
  const collected = fees.reduce((s, f) => s + Number(f.paidAmount || 0), 0);
  const pendingAmt = fees.reduce((s, f) => s + Math.max(Number(f.amount || 0) - Number(f.paidAmount || 0), 0), 0);
  res.json({ success: true, summary: { total, paid, pending, partial, overdue, totalAmount, collected, pendingAmt, collectionRate: totalAmount > 0 ? Math.round((collected / totalAmount) * 100) : 0 } });
});

// ═══════════════════════════════════════════
// ASSIGNABLE STUDENTS
// ═══════════════════════════════════════════

const getAssignableStudents = asyncHandler(async (req, res) => {
  const { department, semester, structureId, search } = req.query;
  const query = { collegeId: req.user.collegeId, role: 'student', isActive: true };
  if (department) query.department = department;
  if (semester) query.semester = parseInt(semester);
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { rollNo: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const students = await User.find(query).select('name rollNo email department semester phone').sort({ name: 1 }).limit(500);

  let assignedSet = new Set();
  if (structureId) {
    const academicYear = req.query.academicYear;
    const existingQuery = { collegeId: req.user.collegeId, feeStructureId: structureId };
    if (academicYear) existingQuery.academicYear = academicYear;
    const existingFees = await Fee.find(existingQuery).select('studentId');
    assignedSet = new Set(existingFees.map((f) => String(f.studentId)));
  }

  const result = students.map((s) => ({
    _id: s._id,
    name: s.name,
    rollNo: s.rollNo,
    email: s.email,
    department: s.department,
    semester: s.semester,
    phone: s.phone,
    alreadyAssigned: assignedSet.has(String(s._id)),
  }));

  res.json({ success: true, students: result, total: result.length });
});

module.exports = {
  createFeeStructure, getFeeStructures, updateFeeStructure, deleteFeeStructure,
  assignFeeStructure,
  createFee, getFees, getFeeById, payFee, createBulkFees,
  createFeeOrder, verifyFeePayment, getFeePaymentStatus,
  getInstallments, updateInstallment, createInstallmentOrder,
  applyLateFees, waiveFee, applyDiscount,
  getFeeAnalytics, getFeeSummary,
  getAssignableStudents,
};
