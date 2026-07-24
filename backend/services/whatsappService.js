const twilio = require('twilio');

let client = null;

function initTwilio() {
  if (client) return client;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  client = twilio(accountSid, authToken);
  return client;
}

function isWhatsAppConfigured() {
  return Boolean(initTwilio());
}

async function sendWhatsApp(to, body, mediaUrl) {
  const twilioClient = initTwilio();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!twilioClient || !from) {
    return { success: false, skipped: true, message: 'WhatsApp not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM.' };
  }

  const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  try {
    const msgOpts = { from, to: toNumber, body };
    if (mediaUrl) msgOpts.mediaUrl = [mediaUrl];
    const message = await twilioClient.messages.create(msgOpts);
    return { success: true, sid: message.sid };
  } catch (error) {
    return { success: false, error: error.message, message: 'WhatsApp delivery failed.' };
  }
}

async function sendBulkWhatsApp(recipients, body, mediaUrl) {
  const results = await Promise.allSettled(
    recipients.map((to) => sendWhatsApp(to, body, mediaUrl))
  );
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - sent;
  return { success: true, sent, failed, total: results.length };
}

module.exports = { isWhatsAppConfigured, sendWhatsApp, sendBulkWhatsApp };
