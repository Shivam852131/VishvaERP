require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const cluster = require('cluster');

const { connectDB, disconnectDB } = require('./config/db');
const { logger, requestLogger } = require('./config/logger');
const User = require('./models/User');
const { generalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorMiddleware');
const correlationId = require('./middleware/correlationId');
const sanitize = require('./middleware/sanitize');
const { startAllJobs, stopAllJobs } = require('./jobs');

async function ensureSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    return;
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return;
  }

  await User.create({
    name: 'Super Admin',
    email,
    password,
    role: 'superadmin',
    isActive: true,
  });

  logger.info(`Super admin bootstrapped: ${email}`);
}

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';
const reactBuildDir = path.resolve(__dirname, '../frontend-react/dist');
const legacyFrontendDir = path.resolve(__dirname, '../frontend');
const frontendDir = fs.existsSync(path.join(reactBuildDir, 'index.html')) ? reactBuildDir : legacyFrontendDir;
const frontendIndex = path.join(frontendDir, 'index.html');

const corsOptions = {
  origin(origin, callback) {
    if (!origin || !isProduction || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
};

// Socket.io Setup
const io = new Server(server, {
  cors: {
    origin: isProduction && allowedOrigins.length > 0 ? allowedOrigins : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Pass Socket.io to req so routes can use it
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Middleware
app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 2 : 1);
app.use(compression({ level: 6, threshold: 1024 }));
app.use(correlationId);
app.use(cors(corsOptions));
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(sanitize);
app.use(requestLogger);
app.use(generalLimiter);

// Deprecation header for legacy /api/ routes
app.use('/api', (req, res, next) => {
  res.setHeader('X-API-Deprecated', 'true');
  res.setHeader('X-API-Deprecation-Info', 'Use /api/v1/ instead');
  next();
});

// Serve uploaded files at /uploads
const uploadsDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir, {
  maxAge: isProduction ? '7d' : 0,
  etag: true,
  lastModified: true,
}));

// Serve the React build with aggressive caching for static assets
const STATIC_MAX_AGE = isProduction ? '30d' : 0;
app.use(express.static(frontendDir, {
  maxAge: isProduction ? '1d' : 0,
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', `public, max-age=${isProduction ? 31536000 : 0}, immutable`);
    } else if (filePath.match(/\.(js|mjs)$/)) {
      res.setHeader('Cache-Control', `public, max-age=${isProduction ? 31536000 : 0}, immutable`);
    } else if (filePath.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/)) {
      res.setHeader('Cache-Control', `public, max-age=${isProduction ? 604800 : 0}`);
    } else if (filePath.match(/\.(woff2?|ttf|eot)$/)) {
      res.setHeader('Cache-Control', `public, max-age=${isProduction ? 31536000 : 0}, immutable`);
    }
  },
}));

// Serve robots.txt and sitemap.xml from root
const rootPublic = path.resolve(__dirname, '..');
app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(rootPublic, 'robots.txt'));
});
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(rootPublic, 'sitemap.xml'));
});

// ── API v1 (preferred) ───────────────────────────────
app.use('/api/v1', require('./routes/v1'));

// ── Legacy /api/ routes (backward-compatible, with deprecation headers) ──
app.use('/api/auth', require('./routes/auth'));
app.use('/api/super-admin', require('./routes/superAdmin'));
app.use('/api/college-admin', require('./routes/collegeAdmin'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/exams', require('./routes/exam'));
app.use('/api/fees', require('./routes/fee'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/leave', require('./routes/leave'));
app.use('/api/logistics', require('./routes/logistics'));
app.use('/api/live-classes', require('./routes/liveClasses'));
app.use('/api/academics', require('./modules/academicsRoutes'));
app.use('/api/notices', require('./modules/noticesRoutes'));
app.use('/api/communications', require('./modules/communicationsRoutes'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/config', require('./routes/config'));
app.use('/api/health', require('./routes/health'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/reports', require('./routes/reports'));

// Fallback for frontend routing (SPA support)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'API route not found' });
  }

  if (req.path.startsWith('/uploads')) {
    return res.status(404).send('File not found');
  }

  if (!fs.existsSync(frontendIndex)) {
    return res.status(404).send('Frontend build not found. Run npm run frontend:build first.');
  }

  res.sendFile(frontendIndex);
});

// Global Error Handler
app.use(errorHandler);

// Socket.io Logic
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    logger.debug('User joined room', { socketId: socket.id, roomId });
  });

  socket.on('send_message', (data) => {
    io.to(data.roomId).emit('receive_message', data);
  });

  socket.on('join_user', (userId) => {
    socket.join(`user:${userId}`);
  });

  socket.on('disconnect', () => {
    logger.debug('Client disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    await ensureSuperAdmin();
    if (!cluster.isWorker) {
      startAllJobs();
    }
    server.listen(PORT, () => {
      logger.info(`Worker ${cluster.isWorker ? cluster.worker.id : 'master'} running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Server startup failed', { error: error.message });
    process.exit(1);
  }
}

// Graceful Shutdown
async function shutdown(signal) {
  logger.info(`${signal} received. Closing Vishva ERP API...`);
  stopAllJobs();
  server.close(async () => {
    await disconnectDB();
    logger.info('Server closed gracefully');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15000).unref();
}

// Start server only when running directly (not as Vercel serverless)
const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isVercel) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection', { error: error.message, stack: error.stack });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  startServer();
}

// Export for Vercel serverless
module.exports = app;
