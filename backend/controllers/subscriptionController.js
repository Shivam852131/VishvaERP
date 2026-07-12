const asyncHandler = require('../middleware/asyncHandler');
const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const College = require('../models/College');
const { generateSubscriptionReceipt } = require('../services/pdfService');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');
const {
  confirmRazorpayPayment,
  getRazorpay,
  getRazorpayKeyId,
  verifyRazorpaySignature,
} = require('../services/razorpayService');

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

function serializeSubscription(subscription) {
  if (!subscription) return null;
  return {
    id: subscription._id,
    plan: subscription.plan,
    status: subscription.status,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
    billingCycle: subscription.billingCycle,
    amount: subscription.amount,
    isActive: typeof subscription.isActive === 'function' ? subscription.isActive() : Boolean(subscription.isActive),
  };
}

async function markSubscriptionPaymentFailed(req, subscription, message, details) {
  if (!subscription || subscription.status === 'active' || subscription.status === 'failed') return;

  subscription.status = 'failed';
  if (details?.razorpayPaymentId) {
    subscription.razorpayPaymentId = details.razorpayPaymentId;
  }
  await subscription.save();

  const existingPayment = await Payment.findOne({
    collegeId: req.user.collegeId,
    type: 'subscription',
    razorpayOrderId: subscription.razorpayOrderId,
  });

  if (existingPayment) {
    existingPayment.status = 'failed';
    if (details?.razorpayPaymentId) {
      existingPayment.razorpayPaymentId = details.razorpayPaymentId;
    }
    if (message) {
      existingPayment.metadata = { ...(existingPayment.metadata || {}), failureReason: message };
    }
    await existingPayment.save();
  }
}

async function activateSubscriptionPayment(req, subscription, payload) {
  const now = new Date();
  const months = CYCLE_MONTHS[subscription.billingCycle];
  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + months);

  subscription.razorpayPaymentId = payload.razorpayPaymentId;
  subscription.razorpaySignature = payload.razorpaySignature || subscription.razorpaySignature;
  subscription.status = 'active';
  subscription.startDate = subscription.startDate || now;
  subscription.endDate = endDate;

  const historyExists = subscription.paymentHistory.some(
    (entry) => entry.razorpayPaymentId === payload.razorpayPaymentId
  );
  if (!historyExists) {
    subscription.paymentHistory.push({
      razorpayOrderId: subscription.razorpayOrderId,
      razorpayPaymentId: payload.razorpayPaymentId,
      amount: subscription.amount,
      status: 'captured',
      date: now,
    });
  }
  await subscription.save();

  const paymentDescription = `${PLAN_DETAILS[subscription.plan]?.name || subscription.plan} subscription (${subscription.billingCycle})`;
  const payment = await Payment.findOneAndUpdate(
    {
      collegeId: req.user.collegeId,
      type: 'subscription',
      razorpayOrderId: subscription.razorpayOrderId,
    },
    {
      $set: {
        userId: req.user._id,
        referenceId: subscription._id,
        razorpayPaymentId: payload.razorpayPaymentId,
        razorpaySignature: payload.razorpaySignature,
        amount: subscription.amount,
        currency: subscription.currency,
        status: 'captured',
        receiptNo: payload.receiptNo || `PAY-SUB-${Date.now()}`,
        description: paymentDescription,
        metadata: {
          plan: subscription.plan,
          billingCycle: subscription.billingCycle,
          orderStatus: payload.orderStatus,
          paymentStatus: payload.paymentStatus,
          paymentMethod: payload.paymentMethod,
          email: payload.email,
          contact: payload.contact,
        },
      },
      $setOnInsert: {
        collegeId: req.user.collegeId,
        userId: req.user._id,
        type: 'subscription',
      },
    },
    { new: true, upsert: true }
  );

  await College.findByIdAndUpdate(req.user.collegeId, {
    plan: subscription.plan,
    planExpiry: endDate,
  });

  logAudit(req, 'activate', 'subscription', {
    resourceId: subscription._id,
    description: `Activated ${subscription.plan} subscription`,
    metadata: { plan: subscription.plan, endDate, paymentId: payload.razorpayPaymentId },
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin', 'collegeAdmin'],
    resource: 'subscriptions',
    action: 'activated',
  });

  return { payment, subscription };
}

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
  const amountInPaise = Math.round(amount * 100);
  const receipt = `sub_${Date.now()}_${String(req.user.collegeId).slice(-8)}`;

  const razorpayInstance = getRazorpay();
  const order = await razorpayInstance.orders.create({
    amount: amountInPaise,
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

  await Payment.create({
    collegeId: req.user.collegeId,
    userId: req.user._id,
    type: 'subscription',
    referenceId: subscription._id,
    razorpayOrderId: order.id,
    amount,
    currency: 'INR',
    status: 'created',
    description: `${planDetail.name} subscription (${billingCycle})`,
    metadata: { plan, billingCycle },
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
      amount: amountInPaise,
      currency: 'INR',
    },
    subscriptionId: subscription._id,
    key: getRazorpayKeyId(),
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

  if (subscription.status === 'active' && subscription.razorpayPaymentId === razorpayPaymentId) {
    return res.json({
      success: true,
      message: 'Subscription already activated',
      subscription: serializeSubscription(subscription),
    });
  }

  if (subscription.status !== 'created') {
    return res.status(400).json({ success: false, message: 'Subscription order already processed' });
  }

  const { order, payment } = await confirmRazorpayPayment({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    expectedAmount: subscription.amount,
    currency: subscription.currency,
  });

  if (payment.status !== 'captured') {
    await markSubscriptionPaymentFailed(req, subscription, 'Payment could not be captured', { razorpayPaymentId });
    return res.status(400).json({ success: false, message: 'Payment is not captured by Razorpay yet' });
  }

  await activateSubscriptionPayment(req, subscription, {
    razorpayPaymentId,
    razorpaySignature,
    receiptNo: `PAY-SUB-${Date.now()}`,
    orderStatus: order?.status,
    paymentStatus: payment.status,
    paymentMethod: payment.method,
    email: payment.email,
    contact: payment.contact,
  });

  res.json({
    success: true,
    message: 'Subscription activated',
    subscription: serializeSubscription(subscription),
  });
});

// @desc    Get live Razorpay payment status for a subscription order
const getSubscriptionPaymentStatus = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({
    _id: req.params.subscriptionId,
    collegeId: req.user.collegeId,
  });

  if (!subscription) {
    return res.status(404).json({ success: false, message: 'Subscription not found' });
  }

  let payment = subscription.razorpayPaymentId
    ? await Payment.findOne({
      collegeId: req.user.collegeId,
      type: 'subscription',
      referenceId: subscription._id,
      razorpayPaymentId: subscription.razorpayPaymentId,
    })
    : await Payment.findOne({
      collegeId: req.user.collegeId,
      type: 'subscription',
      referenceId: subscription._id,
      razorpayOrderId: subscription.razorpayOrderId,
    });

  let razorpayOrder = null;
  let razorpayPayment = null;

  try {
    const lookupPaymentId = payment?.razorpayPaymentId || req.query.razorpayPaymentId;
    if (subscription.razorpayOrderId && lookupPaymentId && payment?.status !== 'captured') {
      const confirmation = await confirmRazorpayPayment({
        orderId: subscription.razorpayOrderId,
        paymentId: lookupPaymentId,
        expectedAmount: subscription.amount,
        currency: subscription.currency,
      });
      razorpayOrder = confirmation.order;
      razorpayPayment = confirmation.payment;

      if (confirmation.localStatus === 'captured') {
        await activateSubscriptionPayment(req, subscription, {
          razorpayPaymentId: razorpayPayment.id,
          razorpaySignature: subscription.razorpaySignature,
          receiptNo: payment?.receiptNo || `PAY-SUB-${Date.now()}`,
          orderStatus: razorpayOrder?.status,
          paymentStatus: razorpayPayment.status,
          paymentMethod: razorpayPayment.method,
          email: razorpayPayment.email,
          contact: razorpayPayment.contact,
        });
      } else if (confirmation.localStatus === 'failed') {
        await markSubscriptionPaymentFailed(req, subscription, 'Razorpay marked the payment as failed', {
          razorpayPaymentId: razorpayPayment.id,
        });
      }

      payment = await Payment.findOne({
        collegeId: req.user.collegeId,
        type: 'subscription',
        razorpayOrderId: subscription.razorpayOrderId,
      });
    }
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      throw error;
    }
  }

  res.json({
    success: true,
    subscription: serializeSubscription(subscription),
    payment: payment
      ? {
        id: String(payment._id),
        status: payment.status,
        paymentId: payment.razorpayPaymentId,
        orderId: payment.razorpayOrderId,
        receiptNo: payment.receiptNo,
        amount: payment.amount,
      }
      : null,
    razorpay: {
      orderStatus: razorpayOrder?.status || null,
      paymentStatus: razorpayPayment?.status || null,
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
    subscription: serializeSubscription(subscription),
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
  getSubscriptionPaymentStatus,
  getSubscription,
  getPaymentHistory,
  getSubscriptionStatus,
  getSubscriptionReceipt,
};
