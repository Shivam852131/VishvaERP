const asyncHandler = require('../middleware/asyncHandler');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const College = require('../models/College');
const { generateSubscriptionReceipt } = require('../services/pdfService');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');

const PLAN_DETAILS = {
  basic: {
    name: 'Basic',
    price: { monthly: 999, quarterly: 2997, yearly: 11988 },
    features: ['Up to 500 students', 'Core modules', 'Email support', '5 GB storage'],
  },
  pro: {
    name: 'Pro',
    price: { monthly: 2999, quarterly: 8997, yearly: 35988 },
    features: ['Up to 2000 students', 'All modules', 'Priority support', '50 GB storage', 'Advanced analytics', 'API access'],
  },
  enterprise: {
    name: 'Enterprise',
    price: { monthly: 7999, quarterly: 23997, yearly: 95988 },
    features: ['Unlimited students', 'All modules', 'Dedicated support', 'Unlimited storage', 'Custom integrations', 'White-label options', 'SLA guarantee'],
  },
};

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

async function getFallbackCollegeSubscription(collegeId) {
  const college = await College.findById(collegeId).select('plan planExpiry').lean();
  if (!college?.planExpiry || college.planExpiry <= new Date()) {
    return null;
  }

  return {
    id: null,
    plan: college.plan || 'basic',
    status: 'active',
    startDate: null,
    endDate: college.planExpiry,
    billingCycle: 'monthly',
    amount: 0,
    isActive: true,
  };
}

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

// @desc    Get available plans and pricing
const getPlans = asyncHandler(async (req, res) => {
  const plans = Object.entries(PLAN_DETAILS).map(([key, plan]) => ({
    id: key,
    name: plan.name,
    pricing: plan.price,
    features: plan.features,
  }));
  res.json({ success: true, plans });
});

// @desc    Create Razorpay order for subscription
const createOrder = asyncHandler(async (req, res) => {
  const { plan, billingCycle } = req.body;

  if (!plan || !PLAN_DETAILS[plan]) {
    return res.status(400).json({ success: false, message: 'Invalid plan' });
  }
  if (!billingCycle || !CYCLE_MONTHS[billingCycle]) {
    return res.status(400).json({ success: false, message: 'Invalid billing cycle' });
  }

  const planDetail = PLAN_DETAILS[plan];
  const amount = planDetail.price[billingCycle];
  const receipt = `sub_${req.user.collegeId}_${Date.now()}`;

  const razorpayInstance = getRazorpay();
  const order = await razorpayInstance.orders.create({
    amount: amount * 100,
    currency: 'INR',
    receipt,
    notes: { collegeId: String(req.user.collegeId), plan, billingCycle },
  });

  const subscription = await Subscription.create({
    collegeId: req.user.collegeId,
    plan,
    amount,
    billingCycle,
    razorpayOrderId: order.id,
    status: 'created',
  });

  logAudit(req, 'create', 'subscription', {
    resourceId: subscription._id,
    description: `Created ${plan} subscription order`,
    metadata: { plan, billingCycle, amount, orderId: order.id },
  });

  res.status(201).json({
    success: true,
    message: 'Order created',
    order: {
      id: order.id,
      amount: amount * 100,
      currency: 'INR',
    },
    subscriptionId: subscription._id,
    key: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
  });
});

// @desc    Verify payment and activate subscription
const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, subscriptionId } = req.body;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return res.status(400).json({ success: false, message: 'Missing payment verification details' });
  }

  const isValid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!isValid) {
    return res.status(400).json({ success: false, message: 'Invalid payment signature' });
  }

  const subscription = await Subscription.findOne({
    _id: subscriptionId,
    collegeId: req.user.collegeId,
    razorpayOrderId,
  });

  if (!subscription) {
    return res.status(404).json({ success: false, message: 'Subscription not found' });
  }

  const now = new Date();
  const months = CYCLE_MONTHS[subscription.billingCycle];
  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + months);

  subscription.razorpayPaymentId = razorpayPaymentId;
  subscription.razorpaySignature = razorpaySignature;
  subscription.status = 'active';
  subscription.startDate = now;
  subscription.endDate = endDate;
  subscription.paymentHistory.push({
    razorpayOrderId,
    razorpayPaymentId,
    amount: subscription.amount,
    status: 'captured',
    date: now,
  });
  await subscription.save();

  await Payment.create({
    collegeId: req.user.collegeId,
    userId: req.user._id,
    type: 'subscription',
    referenceId: subscription._id,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    amount: subscription.amount,
    currency: subscription.currency,
    status: 'captured',
    receiptNo: `PAY-SUB-${Date.now()}`,
    description: `${PLAN_DETAILS[subscription.plan]?.name || subscription.plan} subscription (${subscription.billingCycle})`,
    metadata: { plan: subscription.plan, billingCycle: subscription.billingCycle },
  });

  await College.findByIdAndUpdate(req.user.collegeId, {
    plan: subscription.plan,
    planExpiry: endDate,
  });

  logAudit(req, 'activate', 'subscription', {
    resourceId: subscription._id,
    description: `Activated ${subscription.plan} subscription`,
    metadata: { plan: subscription.plan, endDate },
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'subscriptions',
    action: 'activated',
  });

  res.json({
    success: true,
    message: 'Subscription activated',
    subscription: {
      id: subscription._id,
      plan: subscription.plan,
      status: subscription.status,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      billingCycle: subscription.billingCycle,
      amount: subscription.amount,
    },
  });
});

// @desc    Get current active subscription for college
const getSubscription = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({
    collegeId: req.user.collegeId,
    status: { $in: ['active', 'created'] },
  }).sort({ createdAt: -1 });

  if (!subscription) {
    const fallbackSubscription = await getFallbackCollegeSubscription(req.user.collegeId);
    return res.json({ success: true, subscription: fallbackSubscription, isActive: Boolean(fallbackSubscription?.isActive) });
  }

  res.json({
    success: true,
    subscription: {
      id: subscription._id,
      plan: subscription.plan,
      status: subscription.status,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      billingCycle: subscription.billingCycle,
      amount: subscription.amount,
      isActive: subscription.isActive(),
    },
  });
});

// @desc    Get payment history for college
const getPaymentHistory = asyncHandler(async (req, res) => {
  const payments = await Payment.find({
    collegeId: req.user.collegeId,
    type: 'subscription',
  }).sort({ createdAt: -1 }).lean();

  const subscriptionIds = payments.map((payment) => payment.referenceId).filter(Boolean);
  const subscriptions = await Subscription.find({ _id: { $in: subscriptionIds } })
    .select('plan billingCycle startDate endDate')
    .lean();
  const subscriptionById = new Map(subscriptions.map((subscription) => [String(subscription._id), subscription]));

  const normalizedPayments = payments.map((payment) => {
    const subscription = payment.referenceId ? subscriptionById.get(String(payment.referenceId)) : null;
    const status = payment.status === 'captured' ? 'success' : payment.status;

    return {
      id: String(payment._id),
      date: payment.createdAt,
      plan: payment.metadata?.plan || subscription?.plan || 'subscription',
      billingCycle: payment.metadata?.billingCycle || subscription?.billingCycle || '',
      amount: payment.amount,
      currency: payment.currency,
      paymentId: payment.razorpayPaymentId || payment.receiptNo || String(payment._id),
      receiptNo: payment.receiptNo,
      status,
      description: payment.description,
    };
  });

  res.json({ success: true, payments: normalizedPayments });
});

// @desc    Download subscription receipt
const getSubscriptionReceipt = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const paymentLookup = [{ razorpayPaymentId: paymentId }, { receiptNo: paymentId }];
  if (mongoose.Types.ObjectId.isValid(paymentId)) {
    paymentLookup.push({ _id: paymentId });
  }

  const payment = await Payment.findOne({
    collegeId: req.user.collegeId,
    type: 'subscription',
    $or: paymentLookup,
  }).lean();

  if (!payment) {
    return res.status(404).json({ success: false, message: 'Receipt not found' });
  }

  const [college, subscription] = await Promise.all([
    College.findById(payment.collegeId).lean(),
    payment.referenceId ? Subscription.findById(payment.referenceId).lean() : null,
  ]);

  const pdfBuffer = await generateSubscriptionReceipt(payment, req.user, college, subscription);
  const fileName = `subscription-receipt-${payment.receiptNo || payment._id}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
  res.send(pdfBuffer);
});

// @desc    Quick subscription status check
const getSubscriptionStatus = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({
    collegeId: req.user.collegeId,
    status: 'active',
    endDate: { $gt: new Date() },
  }).select('plan endDate billingCycle status');

  const isActive = !!subscription;
  const fallbackSubscription = !isActive ? await getFallbackCollegeSubscription(req.user.collegeId) : null;

  res.json({
    success: true,
    isActive: isActive || Boolean(fallbackSubscription?.isActive),
    subscription: isActive
      ? { plan: subscription.plan, endDate: subscription.endDate, billingCycle: subscription.billingCycle }
      : fallbackSubscription
        ? { plan: fallbackSubscription.plan, endDate: fallbackSubscription.endDate, billingCycle: fallbackSubscription.billingCycle }
        : null,
  });
});

module.exports = {
  getPlans,
  createOrder,
  verifyPayment,
  getSubscription,
  getPaymentHistory,
  getSubscriptionStatus,
  getSubscriptionReceipt,
};
