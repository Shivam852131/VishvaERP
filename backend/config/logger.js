const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || 2;

function formatLog(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  if (process.env.NODE_ENV !== 'production') {
    return JSON.stringify(entry, null, 2);
  }
  return JSON.stringify(entry);
}

const logger = {
  error(message, meta = {}) {
    if (currentLevel >= 0) console.error(formatLog('error', message, meta));
  },
  warn(message, meta = {}) {
    if (currentLevel >= 1) console.warn(formatLog('warn', message, meta));
  },
  info(message, meta = {}) {
    if (currentLevel >= 2) console.log(formatLog('info', message, meta));
  },
  debug(message, meta = {}) {
    if (currentLevel >= 3) console.log(formatLog('debug', message, meta));
  },
};

function requestLogger(req, res, next) {
  const start = Date.now();
  const originalEnd = res.end;

  res.end = function (...args) {
    const duration = Date.now() - start;
    const logData = {
      correlationId: req.correlationId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    if (req.user) {
      logData.userId = req.user._id;
      logData.userRole = req.user.role;
    }

    if (res.statusCode >= 500) {
      logger.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request error', logData);
    } else {
      logger.info('Request completed', logData);
    }

    originalEnd.apply(res, args);
  };

  next();
}

module.exports = { logger, requestLogger };
