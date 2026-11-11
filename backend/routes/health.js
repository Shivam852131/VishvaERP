const express = require('express');
const { getDbHealth } = require('../config/db');
const pushService = require('../services/pushNotificationService');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

/**
 * The health endpoint is deliberately minimal in public responses.
 *
 * Runtime details (Node version, memory usage, uptime, which third-party
 * providers are configured) are useful to an attacker for fingerprinting the
 * deployment, so they are only exposed to authenticated administrators.
 */
router.get('/', async (req, res) => {
  const db = await getDbHealth();
  const ok = db.status === 'healthy';

  res.status(ok ? 200 : 503).json({
    success: ok,
    service: 'Vishva ERP API',
    status: ok ? 'healthy' : 'degraded',
    version: require('../../package.json').version,
    timestamp: new Date().toISOString(),
  });
});

router.get('/db', async (req, res) => {
  const db = await getDbHealth();
  res.status(db.status === 'healthy' ? 200 : 503).json({
    success: db.status === 'healthy',
    db: { status: db.status },
    timestamp: new Date().toISOString(),
  });
});

// Detailed diagnostics - administrators only.
router.get('/deep', protect, authorize('superadmin', 'collegeAdmin'), async (req, res) => {
  const checks = {};

  // DB check
  checks.database = await getDbHealth();

  // Memory check
  const memUsage = process.memoryUsage();
  const heapUsedPercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
  checks.memory = {
    status: heapUsedPercent < 90 ? 'healthy' : 'degraded',
    heapUsedPercent,
    rssMB: (memUsage.rss / 1024 / 1024).toFixed(1),
  };

  // Push notification check
  checks.push = {
    status: pushService.isPushConfigured() ? 'configured' : 'not_configured',
    configured: pushService.isPushConfigured(),
  };

  // Email check
  const emailConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
  checks.email = {
    status: emailConfigured ? 'configured' : 'not_configured',
    configured: emailConfigured,
  };

  // AI check
  checks.ai = {
    status: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
    configured: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY),
  };

  const allHealthy = Object.values(checks).every(c => c.status === 'healthy' || c.status === 'configured');

  res.status(200).json({
    success: true,
    status: allHealthy ? 'healthy' : 'degraded',
    service: 'Vishva ERP API',
    version: require('../../package.json').version,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    checks,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
