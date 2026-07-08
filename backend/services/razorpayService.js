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

module.exports = {
  getRazorpay,
  getRazorpayKeyId,
  verifyRazorpaySignature,
};
