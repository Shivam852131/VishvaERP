const crypto = require('crypto');

let razorpay;

function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    const error = new Error('Razorpay payment gateway is not configured');
    error.statusCode = 503;
    throw error;
  }

  return { keyId, keySecret };
}

function getRazorpayKeyId() {
  return getRazorpayConfig().keyId;
}

function getRazorpay() {
  if (!razorpay) {
    const Razorpay = require('razorpay');
    const { keyId, keySecret } = getRazorpayConfig();
    razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return razorpay;
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
  const { keySecret } = getRazorpayConfig();
  if (!orderId || !paymentId || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const expected = Buffer.from(expectedSignature, 'hex');
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function getRazorpayWebhookSecret() {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    const error = new Error('Razorpay webhook secret is not configured');
    error.statusCode = 503;
    throw error;
  }
  return secret;
}

function verifyRazorpayWebhookSignature(rawBody, signature) {
  const webhookSecret = getRazorpayWebhookSecret();
  if (!rawBody || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expected = Buffer.from(expectedSignature, 'hex');
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function fetchRazorpayOrder(orderId) {
  if (!orderId) return null;
  return getRazorpay().orders.fetch(orderId);
}

async function fetchRazorpayPayment(paymentId) {
  if (!paymentId) return null;
  return getRazorpay().payments.fetch(paymentId);
}

async function captureRazorpayPayment(paymentId, amountInPaise, currency) {
  if (!paymentId) return null;
  return getRazorpay().payments.capture(paymentId, amountInPaise, currency || 'INR');
}

function toLocalPaymentStatus(status) {
  if (status === 'captured') return 'captured';
  if (status === 'failed') return 'failed';
  if (status === 'refunded') return 'refunded';
  return 'created';
}

async function confirmRazorpayPayment(options) {
  const {
    orderId,
    paymentId,
    expectedAmount,
    currency = 'INR',
  } = options || {};

  const [order, fetchedPayment] = await Promise.all([
    fetchRazorpayOrder(orderId),
    fetchRazorpayPayment(paymentId),
  ]);

  if (!fetchedPayment) {
    const error = new Error('Unable to fetch Razorpay payment');
    error.statusCode = 502;
    throw error;
  }

  if (orderId && fetchedPayment.order_id && fetchedPayment.order_id !== orderId) {
    const error = new Error('Razorpay payment does not match the order');
    error.statusCode = 400;
    throw error;
  }

  const expectedAmountInPaise = Math.round(Number(expectedAmount || 0) * 100);
  if (expectedAmountInPaise > 0) {
    if (order && Number(order.amount || 0) !== expectedAmountInPaise) {
      const error = new Error('Razorpay order amount does not match the expected amount');
      error.statusCode = 400;
      throw error;
    }

    if (Number(fetchedPayment.amount || 0) !== expectedAmountInPaise) {
      const error = new Error('Razorpay payment amount does not match the expected amount');
      error.statusCode = 400;
      throw error;
    }
  }

  let payment = fetchedPayment;
  if (payment.status === 'authorized') {
    payment = await captureRazorpayPayment(paymentId, expectedAmountInPaise || Number(payment.amount || 0), currency);
  }

  return {
    order,
    payment,
    localStatus: toLocalPaymentStatus(payment.status),
  };
}

module.exports = {
  captureRazorpayPayment,
  confirmRazorpayPayment,
  fetchRazorpayOrder,
  fetchRazorpayPayment,
  getRazorpay,
  getRazorpayKeyId,
  toLocalPaymentStatus,
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
};
