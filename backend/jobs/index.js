const { startFeeScheduler, stopFeeScheduler } = require('./feeScheduler');
const { logger } = require('../config/logger');

function startAllJobs() {
  logger.info('Starting background jobs...');
  startFeeScheduler();
  logger.info('Background jobs started');
}

function stopAllJobs() {
  logger.info('Stopping background jobs...');
  stopFeeScheduler();
  logger.info('Background jobs stopped');
}

module.exports = { startAllJobs, stopAllJobs };
