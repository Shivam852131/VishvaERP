const { startFeeScheduler, stopFeeScheduler } = require('./feeScheduler');
const { startQuizScheduler, stopQuizScheduler } = require('./quizScheduler');
const { startScheduledJobs, stopScheduledJobs } = require('../services/scheduledNotificationService');
const { logger } = require('../config/logger');

function startAllJobs() {
  logger.info('Starting background jobs...');
  startFeeScheduler();
  startQuizScheduler();
  startScheduledJobs();
  logger.info('Background jobs started');
}

function stopAllJobs() {
  logger.info('Stopping background jobs...');
  stopFeeScheduler();
  stopQuizScheduler();
  stopScheduledJobs();
  logger.info('Background jobs stopped');
}

module.exports = { startAllJobs, stopAllJobs };
