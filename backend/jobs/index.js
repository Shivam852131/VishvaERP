const { startFeeScheduler, stopFeeScheduler } = require('./feeScheduler');
const { startScheduledJobs, stopScheduledJobs } = require('../services/scheduledNotificationService');
const { logger } = require('../config/logger');

function startAllJobs() {
  logger.info('Starting background jobs...');
  startFeeScheduler();
  startScheduledJobs();
  logger.info('Background jobs started');
}

function stopAllJobs() {
  logger.info('Stopping background jobs...');
  stopFeeScheduler();
  stopScheduledJobs();
  logger.info('Background jobs stopped');
}

module.exports = { startAllJobs, stopAllJobs };
