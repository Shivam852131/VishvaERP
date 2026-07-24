const twilio = require('twilio');

let client = null;
let verifyServiceSid = null;

function initTwilio() {
  if (client) return client;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken) return null;
  client = twilio(accountSid, authToken);
  return client;
}

function isVerifyConfigured() {
  initTwilio();
  return Boolean(client && verifyServiceSid);
}

const CHANNELS = {
  sms: { to: (to) => to, channel: 'sms' },
  whatsapp: { to: (to) => to.replace(/^whatsapp:/, ''), channel: 'whatsapp' },
  voice: { to: (to) => to, channel: 'call' },
  email: { to: (to) => to, channel: 'email' },
  push: { to: (to) => to, channel: 'push' },
  totp: { to: (to) => to, channel: 'totp' },
  sna: { to: (to) => to, channel: 'sna' },
};

async function sendVerification(to, channel, options = {}) {
  const twilioClient = initTwilio();
  if (!twilioClient || !verifyServiceSid) {
    return { success: false, configured: false, message: 'Twilio Verify not configured.' };
  }

  const channelConfig = CHANNELS[channel];
  if (!channelConfig) {
    return { success: false, message: `Invalid channel: ${channel}` };
  }

  const params = {
    to: channelConfig.to(to),
    channel: channelConfig.channel,
  };

  if (options.locale) params.locale = options.locale;
  if (options.appHash) params.appHash = options.appHash;
  if (options.templateName) params.templateName = options.templateName;
  if (options.templateSid) params.templateSid = options.templateSid;
  if (channel === 'push') {
    params.to = to;
    params.channel = 'push';
  }
  if (channel === 'sna') {
    params.to = to;
    params.channel = 'sna';
    params.amount = options.amount || '0';
  }
  if (channel === 'email') {
    params.to = to;
    params.channel = 'email';
    if (options.templateSid) params.templateSid = options.templateSid;
  }

  try {
    const verification = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verifications.create(params);

    return {
      success: true,
      sid: verification.sid,
      status: verification.status,
      channel,
      to: params.to,
      dateCreated: verification.dateCreated,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      message: `Verification failed: ${error.message}`,
    };
  }
}

async function checkVerification(to, code, channel) {
  const twilioClient = initTwilio();
  if (!twilioClient || !verifyServiceSid) {
    return { success: false, configured: false, message: 'Twilio Verify not configured.' };
  }

  const channelConfig = CHANNELS[channel];
  if (!channelConfig) {
    return { success: false, message: `Invalid channel: ${channel}` };
  }

  try {
    const verificationCheck = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verificationChecks.create({
        to: channelConfig.to(to),
        code: code,
      });

    return {
      success: verificationCheck.status === 'approved',
      status: verificationCheck.status,
      sid: verificationCheck.sid,
      valid: verificationCheck.valid,
      dateChecked: verificationCheck.dateChecked,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      message: `Verification check failed: ${error.message}`,
    };
  }
}

async function getVerificationAttempts(to) {
  const twilioClient = initTwilio();
  if (!twilioClient || !verifyServiceSid) {
    return { success: false, message: 'Twilio Verify not configured.' };
  }

  try {
    const verifications = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verifications.list({ to, limit: 10 });

    return {
      success: true,
      attempts: verifications.map((v) => ({
        sid: v.sid,
        status: v.status,
        channel: v.channel,
        dateCreated: v.dateCreated,
      })),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function createTotpSecret(label) {
  const twilioClient = initTwilio();
  if (!twilioClient || !verifyServiceSid) {
    return { success: false, message: 'Twilio Verify not configured.' };
  }

  try {
    const entity = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .entities.create({ identity: label || `user-${Date.now()}` });

    const totp = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .entities(entity.identity)
      .newFactors.create({
        friendlyName: label || 'VishvaERP Authenticator',
        factorType: 'totp',
      });

    return {
      success: true,
      secret: totp.binding.secret,
      uri: totp.binding.uri,
      friendlyName: totp.friendlyName,
      identity: entity.identity,
      factorSid: totp.sid,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifyTotp(identity, totpCode, factorSid) {
  const twilioClient = initTwilio();
  if (!twilioClient || !verifyServiceSid) {
    return { success: false, message: 'Twilio Verify not configured.' };
  }

  try {
    const challenge = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .entities(identity)
      .factors(factorSid)
      .challenges.create({ authPayload: totpCode });

    return {
      success: challenge.status === 'verified',
      status: challenge.status,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  isVerifyConfigured,
  sendVerification,
  checkVerification,
  getVerificationAttempts,
  createTotpSecret,
  verifyTotp,
  CHANNELS,
};
