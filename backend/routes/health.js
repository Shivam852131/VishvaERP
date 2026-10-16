const express = require('express');
const { getDbHealth } = require('../config/db');
const pushService = require('../services/pushNotificationService');

const router = express.Router();

router.get('/', async (req, res) => {
  const db = await getDbHealth();
  const ok = db.status === 'healthy';

  const memUsage = process.memoryUsage();
  const uptime = process.uptime();

  res.status(ok ? 200 : 503).json({
    success: ok,
    service: 'Vishva ERP API',
    status: ok ? 'healthy' : 'degraded',
    version: require('../../package.json').version,
    uptimeSeconds: Math.round(uptime),
    uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    memory: {
      heapUsedMB: (memUsage.heapUsed / 1024 / 1024).toFixed(1),
      heapTotalMB: (memUsage.heapTotal / 1024 / 1024).toFixed(1),
      rssMB: (memUsage.rss / 1024 / 1024).toFixed(1),
    },
    timestamp: new Date().toISOString(),
    db,
  });
});

router.get('/db', async (req, res) => {
  const db = await getDbHealth();
  res.status(db.status === 'healthy' ? 200 : 503).json({
    success: db.status === 'healthy',
    db,
    timestamp: new Date().toISOString(),
  });
});

router.get('/deep', async (req, res) => {
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
    status: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
    configured: Boolean(process.env.OPENAI_API_KEY),
  };

  const allHealthy = Object.values(checks).every(c => c.status === 'healthy' || c.status === 'configured');

  res.status(allHealthy ? 200 : 200).json({
    success: true,
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
