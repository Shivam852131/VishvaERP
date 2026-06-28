const express = require('express');
const router = express.Router();

router.get('/public', (req, res) => {
  res.json({
    success: true,
    appName: 'Vishva ERP',
    pushEnabled: Boolean(process.env.FIREBASE_PROJECT_ID),
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    platforms: {
      web: true,
      android: true,
      ios: true,
    },
  });
});

module.exports = router;
