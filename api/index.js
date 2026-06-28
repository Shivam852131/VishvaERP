require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const { connectDB } = require('../backend/config/db');
const { logger, requestLogger } = require('../backend/config/logger');
const { generalLimiter } = require('../backend/middleware/rateLimiter');
const errorHandler = require('../backend/middleware/errorMiddleware');
const correlationId = require('../backend/middleware/correlationId');
const sanitize = require('../backend/middleware/sanitize');

let isConnected = false;
let connectionError = null;

async function ensureConnection() {
  if (isConnected) return;
  if (connectionError) throw connectionError;

  if (!process.env.MONGO_URI) {
    const err = new Error('MONGO_URI environment variable is not set. Please configure it in Vercel project settings.');
    err.status = 503;
    connectionError = err;
    throw err;
  }

  try {
    await connectDB();
    isConnected = true;

    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (email && password) {
      const User = require('../backend/models/User');
      const existing = await User.findOne({ email });
      if (!existing) {
        await User.create({ name: 'Super Admin', email, password, role: 'superadmin', isActive: true });
      }
    }
  } catch (error) {
    connectionError = error;
    throw error;
  }
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(compression());
app.use(correlationId);
app.use(cors({ origin: '*', credentials: true }));
app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(sanitize);
app.use(requestLogger);
app.use(generalLimiter);

// Health check (no DB required)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Vishva ERP API is running',
    env: {
      MONGO_URI: process.env.MONGO_URI ? 'configured' : 'MISSING',
      JWT_SECRET: process.env.JWT_SECRET ? 'configured' : 'MISSING',
    },
  });
});

// Ensure DB connection before handling API requests
app.use('/api', async (req, res, next) => {
  if (req.path === '/health') return next();
  try {
    await ensureConnection();
    next();
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Service unavailable',
    });
  }
});

// Deprecation header for legacy /api/ routes
app.use('/api', (req, res, next) => {
  res.setHeader('X-API-Deprecated', 'true');
  res.setHeader('X-API-Deprecation-Info', 'Use /api/v1/ instead');
  next();
});

// ── API v1 (preferred)
app.use('/api/v1', require('../backend/routes/v1'));

// ── Legacy /api/ routes
app.use('/api/auth', require('../backend/routes/auth'));
app.use('/api/super-admin', require('../backend/routes/superAdmin'));
app.use('/api/college-admin', require('../backend/routes/collegeAdmin'));
app.use('/api/attendance', require('../backend/routes/attendance'));
app.use('/api/exams', require('../backend/routes/exam'));
app.use('/api/fees', require('../backend/routes/fee'));
app.use('/api/ai', require('../backend/routes/ai'));
app.use('/api/leave', require('../backend/routes/leave'));
app.use('/api/logistics', require('../backend/routes/logistics'));
app.use('/api/live-classes', require('../backend/routes/liveClasses'));
app.use('/api/academics', require('../backend/modules/academicsRoutes'));
app.use('/api/notices', require('../backend/modules/noticesRoutes'));
app.use('/api/communications', require('../backend/modules/communicationsRoutes'));
app.use('/api/notifications', require('../backend/routes/notifications'));
app.use('/api/config', require('../backend/routes/config'));
app.use('/api/upload', require('../backend/routes/upload'));
app.use('/api/reports', require('../backend/routes/reports'));

// Fallback for API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

// Global Error Handler
app.use(errorHandler);

module.exports = app;
