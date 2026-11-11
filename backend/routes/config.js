const express = require('express');
const router = express.Router();

/**
 * Public configuration.
 *
 * `demoAccounts` controls whether the login page may pre-fill seeded demo
 * credentials. Those credentials are published in this repository, so the
 * panel must stay hidden on a production deployment - otherwise the login
 * page hands every visitor the college-admin and super-admin passwords.
 *
 * Set PUBLIC_DEMO_ACCOUNTS=true to re-enable it for a public demo site.
 */
const demoAccountsEnabled = process.env.PUBLIC_DEMO_ACCOUNTS
  ? /^(1|true|yes|on)$/i.test(String(process.env.PUBLIC_DEMO_ACCOUNTS))
  : process.env.NODE_ENV !== 'production';

router.get('/public', (req, res) => {
  res.json({
    success: true,
    appName: 'Vishva ERP',
    pushEnabled: Boolean(process.env.FIREBASE_PROJECT_ID),
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    demoAccounts: demoAccountsEnabled,
    platforms: {
      web: true,
      android: true,
      ios: true,
    },
  });
});

module.exports = router;
