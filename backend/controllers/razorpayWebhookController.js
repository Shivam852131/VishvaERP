const Fee = require('../models/Fee');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const College = require('../models/College');
const { emitDataChange } = require('../utils/realtime');
const { verifyRazorpayWebhookSignature } = require('../services/razorpayService');

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

function parseWebhookBody(req) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  if (rawBody.length === 0) return { rawBody, payload: null };
  const payload = JSON.parse(rawBody.toString('utf8'));
  return { rawBody, payload };
}

function getPaymentEntity(payload) {
  return payload?.payload?.payment?.entity || null;
}

function getRefundEntity(payload) {
  return payload?.payload?.refund?.entity || null;
}

async function findPaymentRecord(entity) {
  if (!entity) return null;

  return Payment.findOne({
    $or: [
      { razorpayPaymentId: entity.id },
      { razorpayOrderId: entity.order_id },
    ].filter((item) => Object.values(item)[0]),
  });
}

async function findOrCreatePaymentRecord(entity) {
  let payment = await findPaymentRecord(entity);
  if (payment) return payment;

  const feeId = entity?.notes?.feeId;
  const subscriptionId = entity?.notes?.subscriptionId;
  const amount = Number(entity?.amount || 0) / 100;

  if (feeId) {
    const fee = await Fee.findById(feeId);
    if (!fee) return null;
    payment = await Payment.create({
      collegeId: fee.collegeId,
      type: 'fee',
      referenceId: fee._id,
      razorpayOrderId: entity.order_id,
      razorpayPaymentId: entity.id,
      amount,
      currency: entity.currency || 'INR',
      status: 'created',
      description: `Fee payment - ${fee.feeType}`,
      metadata: { feeType: fee.feeType, webhookCreated: true },
    });
    return payment;
  }

  if (subscriptionId) {
    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription) return null;
    payment = await Payment.create({
      collegeId: subscription.collegeId,
      type: 'subscription',
      referenceId: subscription._id,
      razorpayOrderId: entity.order_id,
      razorpayPaymentId: entity.id,
      amount,
      currency: entity.currency || 'INR',
      status: 'created',
      description: `${subscription.plan} subscription (${subscription.billingCycle})`,
      metadata: { plan: subscription.plan, billingCycle: subscription.billingCycle, webhookCreated: true },
    });
  }

  return payment;
}

async function reconcileCapturedFee(req, payment, entity, webhookEvent) {
  const fee = await Fee.findById(payment.referenceId);
  if (!fee) return;

  const amount = Number(payment.amount || Number(entity.amount || 0) / 100);
  if (payment.status !== 'captured') {
    const pendingAmount = Math.max(Number(fee.amount || 0) - Number(fee.paidAmount || 0), 0);
    if (pendingAmount > 0) {
      fee.paidAmount = Number(fee.paidAmount || 0) + Math.min(amount, pendingAmount);
      fee.paymentMethod = 'online';
      fee.paidDate = new Date();
      fee.receiptNo = fee.receiptNo || `FEE-${Date.now()}-${String(fee._id).slice(-6)}`;
      fee.status = fee.paidAmount >= fee.amount ? 'paid' : 'partial';
      await fee.save();
    }
  }

  payment.razorpayPaymentId = entity.id;
  payment.status = 'captured';
  payment.receiptNo = fee.receiptNo || payment.receiptNo;
  payment.metadata = {
    ...(payment.metadata || {}),
    webhookEvent,
    gatewayStatus: entity.status,
    paymentMethod: entity.method,
    email: entity.email,
    contact: entity.contact,
  };
  await payment.save();

  emitDataChange(req, {
    collegeId: String(payment.collegeId),
    roles: ['collegeAdmin', 'superadmin'],
    resource: 'fees',
    action: 'paid',
  });
}

async function reconcileCapturedSubscription(req, payment, entity, webhookEvent) {
  const subscription = await Subscription.findById(payment.referenceId);
  if (!subscription) return;

  const now = new Date();
  if (subscription.status !== 'active') {
    const months = CYCLE_MONTHS[subscription.billingCycle] || 1;
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + months);

    subscription.razorpayPaymentId = entity.id;
    subscription.status = 'active';
    subscription.startDate = subscription.startDate || now;
    subscription.endDate = endDate;
    if (!subscription.paymentHistory.some((entry) => entry.razorpayPaymentId === entity.id)) {
      subscription.paymentHistory.push({
        razorpayOrderId: entity.order_id,
        razorpayPaymentId: entity.id,
        amount: payment.amount,
        status: 'captured',
        date: now,
      });
    }
    await subscription.save();

    await College.findByIdAndUpdate(subscription.collegeId, {
      plan: subscription.plan,
      planExpiry: endDate,
    });
  }

  payment.razorpayPaymentId = entity.id;
  payment.status = 'captured';
  payment.receiptNo = payment.receiptNo || `PAY-SUB-${Date.now()}`;
  payment.metadata = {
    ...(payment.metadata || {}),
    webhookEvent,
    gatewayStatus: entity.status,
    paymentMethod: entity.method,
    email: entity.email,
    contact: entity.contact,
  };
  await payment.save();

  emitDataChange(req, {
    collegeId: String(payment.collegeId),
    roles: ['superadmin', 'collegeAdmin'],
    resource: 'subscriptions',
    action: 'activated',
  });
}

async function reconcileFailedPayment(req, payment, entity, webhookEvent) {
  payment.razorpayPaymentId = entity.id || payment.razorpayPaymentId;
  payment.status = 'failed';
  payment.metadata = {
    ...(payment.metadata || {}),
    webhookEvent,
    gatewayStatus: entity.status,
    failureReason: entity.error_description || entity.error_reason || 'Payment failed',
    failureCode: entity.error_code,
  };
  await payment.save();

  if (payment.type === 'subscription' && payment.referenceId) {
    await Subscription.findOneAndUpdate(
      { _id: payment.referenceId, status: 'created' },
      { status: 'failed', razorpayPaymentId: entity.id }
    );
    emitDataChange(req, {
      collegeId: String(payment.collegeId),
      roles: ['superadmin', 'collegeAdmin'],
      resource: 'subscriptions',
      action: 'failed',
    });
  }

  if (payment.type === 'fee') {
    emitDataChange(req, {
      collegeId: String(payment.collegeId),
      roles: ['collegeAdmin', 'superadmin'],
      resource: 'fees',
      action: 'payment_failed',
    });
  }
}

async function reconcileRefund(req, payment, refund, webhookEvent) {
  payment.status = 'refunded';
  payment.metadata = {
    ...(payment.metadata || {}),
    webhookEvent,
    refundId: refund.id,
    refundAmount: Number(refund.amount || 0) / 100,
    refundStatus: refund.status,
  };
  await payment.save();

  emitDataChange(req, {
    collegeId: String(payment.collegeId),
    roles: ['collegeAdmin', 'superadmin'],
    resource: payment.type === 'subscription' ? 'subscriptions' : 'fees',
    action: 'refunded',
  });
}

const handleRazorpayWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const { rawBody, payload } = parseWebhookBody(req);

    if (!payload || !signature) {
      return res.status(400).json({ success: false, message: 'Missing webhook payload or signature' });
    }

    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid Razorpay webhook signature' });
    }

    const event = payload.event;
    const paymentEntity = getPaymentEntity(payload);
    const refundEntity = getRefundEntity(payload);
    let payment = paymentEntity ? await findOrCreatePaymentRecord(paymentEntity) : null;

    if (!payment && refundEntity?.payment_id) {
      payment = await Payment.findOne({ razorpayPaymentId: refundEntity.payment_id });
    }

    if (!payment) {
      return res.status(202).json({ success: true, message: 'Webhook accepted; no matching payment record' });
    }

    if (event === 'payment.captured') {
      if (payment.type === 'fee') await reconcileCapturedFee(req, payment, paymentEntity, event);
      if (payment.type === 'subscription') await reconcileCapturedSubscription(req, payment, paymentEntity, event);
    } else if (event === 'payment.failed') {
      await reconcileFailedPayment(req, payment, paymentEntity, event);
    } else if (event === 'refund.processed' || event === 'refund.created') {
      await reconcileRefund(req, payment, refundEntity, event);
    }

    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    next(error);
  }
};

module.exports = { handleRazorpayWebhook };
