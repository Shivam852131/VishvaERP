const rateLimit = require('express-rate-limit');

const isDevelopment = process.env.NODE_ENV === 'development';

// Optional env override so CI/E2E runs (which burst far more requests than a
// human) and deployments behind shared NATs can raise the general cap without
// a code change. Falls back to the historical defaults (dev 1000 / prod 100).
const envGeneralMax = parseInt(process.env.RATE_LIMIT_GENERAL || '', 10);

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number.isFinite(envGeneralMax) && envGeneralMax > 0 ? envGeneralMax : (isDevelopment ? 1000 : 100),
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 100 : 10,
  message: { success: false, message: 'Too many login attempts, please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { success: false, message: 'AI request limit exceeded. Please slow down.' },
});

module.exports = { generalLimiter, authLimiter, aiLimiter };
