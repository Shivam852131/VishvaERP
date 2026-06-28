const Fee = require('../models/Fee');

const OVERDUE_CHECK_INTERVAL = 60 * 60 * 1000;

async function updateOverdueFees() {
  try {
    const result = await Fee.updateMany(
      {
        status: { $in: ['pending', 'partial'] },
        dueDate: { $lt: new Date() },
      },
      { $set: { status: 'overdue' } }
    );

    if (result.modifiedCount > 0) {
      const { logger } = require('../config/logger');
      logger.info(`Fee scheduler: updated ${result.modifiedCount} fees to overdue`);
    }
  } catch (error) {
    const { logger } = require('../config/logger');
    logger.error('Fee scheduler error', { error: error.message });
  }
}

let overdueInterval = null;

function startFeeScheduler() {
  updateOverdueFees();
  overdueInterval = setInterval(updateOverdueFees, OVERDUE_CHECK_INTERVAL);
}

function stopFeeScheduler() {
  if (overdueInterval) {
    clearInterval(overdueInterval);
    overdueInterval = null;
  }
}

module.exports = { startFeeScheduler, stopFeeScheduler, updateOverdueFees };
