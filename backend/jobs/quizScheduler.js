const QuizAttempt = require('../models/QuizAttempt');
const Quiz = require('../models/Quiz');

const SWEEP_INTERVAL = 5 * 60 * 1000; // every 5 minutes

/**
 * Finalize any in_progress quiz attempts whose server-side deadline has passed.
 * This keeps timer enforcement authoritative even if a student closes the browser
 * without submitting (their autosaved answers are graded at the deadline).
 */
async function sweepOverdueAttempts() {
  try {
    const { finalizeAttempt } = require('../controllers/quizController');
    const overdue = await QuizAttempt.find({ status: 'in_progress', deadlineAt: { $lt: new Date() } }).limit(500);
    if (!overdue.length) return;

    let done = 0;
    for (const attempt of overdue) {
      const quiz = await Quiz.findById(attempt.quizId);
      if (!quiz) {
        attempt.status = 'timed_out';
        await attempt.save();
        done += 1;
        continue;
      }
      await finalizeAttempt(attempt, quiz, { autoSubmitted: true });
      done += 1;
    }
    if (done) {
      const { logger } = require('../config/logger');
      logger.info(`Quiz scheduler: finalized ${done} overdue attempt(s)`);
    }
  } catch (error) {
    const { logger } = require('../config/logger');
    logger.error('Quiz scheduler error', { error: error.message });
  }
}

let sweepInterval = null;

function startQuizScheduler() {
  sweepOverdueAttempts();
  sweepInterval = setInterval(sweepOverdueAttempts, SWEEP_INTERVAL);
}

function stopQuizScheduler() {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

module.exports = { startQuizScheduler, stopQuizScheduler, sweepOverdueAttempts };
