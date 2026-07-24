const asyncHandler = require('../middleware/asyncHandler');
const { getPreferences, updatePreferences, TEMPLATES } = require('../services/parentNotificationService');
const pushService = require('../services/pushNotificationService');
const emailService = require('../services/emailService');
const whatsappService = require('../services/whatsappService');

const getMyPreferences = asyncHandler(async (req, res) => {
  const prefs = await getPreferences(req.user._id);
  res.json({ success: true, prefs });
});

const updateMyPreferences = asyncHandler(async (req, res) => {
  const prefs = await updatePreferences(req.user._id, req.body);
  res.json({ success: true, prefs, message: 'Preferences updated' });
});

const getChannelStatus = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    channels: {
      push: { configured: pushService.isPushConfigured(), enabled: (req.user.deviceTokens || []).length > 0, deviceCount: (req.user.deviceTokens || []).length },
      email: { configured: emailService.isEmailConfigured() },
      whatsapp: { configured: whatsappService.isWhatsAppConfigured() },
    },
    eventTypes: Object.keys(TEMPLATES),
  });
});

const sendTestNotification = asyncHandler(async (req, res) => {
  const { channel, eventType = 'info' } = req.body;
  const data = {
    studentName: 'Test Student',
    date: new Date().toLocaleDateString(),
    status: 'Present',
    percentage: 85,
    subject: 'Test Subject',
  };

  let result;
  if (channel === 'push') {
    result = await pushService.sendToUser(req.user._id, { title: 'Test Push Notification', body: 'This is a test push notification from VishvaERP.', url: '/', type: 'test' });
  } else if (channel === 'email') {
    result = await emailService.sendMail({ to: req.user.email, subject: 'Test Email - VishvaERP', html: '<h2>Test Email</h2><p>This is a test email from VishvaERP parent notification system.</p>' });
  } else if (channel === 'whatsapp') {
    const prefs = await getPreferences(req.user._id);
    const phone = prefs?.whatsappPhone || req.user.phone;
    if (!phone) return res.status(400).json({ success: false, message: 'No phone number found. Please add WhatsApp phone in preferences.' });
    result = await whatsappService.sendWhatsApp(phone, '🔔 *Test Notification*\n\nThis is a test WhatsApp notification from VishvaERP.\n\n- VishvaERP Team');
  } else {
    return res.status(400).json({ success: false, message: 'Invalid channel. Use push, email, or whatsapp.' });
  }

  res.json({ success: true, result });
});

module.exports = { getMyPreferences, updateMyPreferences, getChannelStatus, sendTestNotification };
