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
const { verifyToken } = require('./config/jwt');
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
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const renderExternalUrl = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
const configuredOrigins = Array.from(new Set([
  ...allowedOrigins,
  ...(renderExternalUrl ? [renderExternalUrl] : []),
]));
const isProduction = process.env.NODE_ENV === 'production';
const reactBuildDir = path.resolve(__dirname, '../frontend-react/dist');
const legacyFrontendDir = path.resolve(__dirname, '../frontend');
const frontendDir = fs.existsSync(path.join(reactBuildDir, 'index.html')) ? reactBuildDir : legacyFrontendDir;
const frontendIndex = path.join(frontendDir, 'index.html');
const localAllowedOrigins = [
  'http://localhost:5000',
  'https://localhost:5000',
  'http://127.0.0.1:5000',
  'https://127.0.0.1:5000',
  `http://localhost:${process.env.PORT || 5000}`,
  `https://localhost:${process.env.PORT || 5000}`,
  `http://127.0.0.1:${process.env.PORT || 5000}`,
  `https://127.0.0.1:${process.env.PORT || 5000}`,
];
const effectiveAllowedOrigins = Array.from(new Set([...configuredOrigins, ...localAllowedOrigins]));

const corsOptions = {
  origin(origin, callback) {
    // Non-browser clients (curl, mobile apps, server-to-server) send no
    // Origin header - those are not subject to CORS at all.
    if (!origin) {
      callback(null, true);
      return;
    }

    // In production the allow-list is mandatory. Falling back to "allow
    // everything" would let any website issue credentialed cross-origin
    // requests against the API and read the responses.
    if (!isProduction) {
      callback(null, true);
      return;
    }

    if (configuredOrigins.length === 0) {
      logger.error('CORS: FRONTEND_URL / RENDER_EXTERNAL_URL are not configured - rejecting cross-origin requests');
      callback(null, false);
      return;
    }

    if (effectiveAllowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    logger.warn(`CORS: rejected cross-origin request from ${origin}`);
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Correlation-Id'],
  maxAge: 600,
};

// Socket.io Setup
const io = new Server(server, {
  cors: {
    origin: isProduction && configuredOrigins.length > 0 ? configuredOrigins : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
  // Bound the size of a single socket payload (a socket is an unauthenticated
  // attack surface until the handshake token is validated).
  maxHttpBufferSize: 1e6,
  pingTimeout: 20000,
  pingInterval: 25000,
});

const { setIO } = require('./utils/realtime');
setIO(io);

// Authenticate socket connections if token provided
io.use((socket, next) => {
  const token = socket.handshake.auth?.token ||
    (socket.handshake.headers?.authorization && socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')) ||
    socket.handshake.query?.token;

  if (!token) {
    // In production every socket must be authenticated - an anonymous socket
    // is a free, unmonitored channel into the realtime layer.
    if (isProduction) {
      logger.warn('Socket connection rejected: no auth token supplied');
      return next(new Error('Authentication required'));
    }
    return next();
  }

  try {
    const decoded = verifyToken(token);
    socket.user = decoded;
  } catch (err) {
    logger.warn('Socket connection rejected: invalid auth token', { error: err.message });
    return next(new Error('Authentication failed: invalid token'));
  }
  next();
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
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://checkout.razorpay.com", "https://meet.jit.si", "https://8x8.vc"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", "https://api.razorpay.com", "https://meet.jit.si", "https://8x8.vc"],
      frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com", "https://meet.jit.si", "https://8x8.vc"],
      mediaSrc: ["'self'", "blob:", "data:", "https:"],
      workerSrc: ["'self'", "blob:"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      // Clickjacking defence at the CSP layer (belt-and-braces with X-Frame-Options).
      frameAncestors: ["'self'"],
      // Blocks form-action hijacking (a page cannot silently POST our forms elsewhere).
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));

// Razorpay webhooks need the untouched raw body for signature verification.
app.post(
  '/api/razorpay/webhook',
  express.raw({ type: 'application/json', limit: '2mb' }),
  require('./controllers/razorpayWebhookController').handleRazorpayWebhook
);

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

// Only these types are safe to render inline in the browser. Everything else is
// forced to download so an uploaded document can never be interpreted as active
// content (HTML / SVG / JS) on our own origin.
const INLINE_SAFE_UPLOAD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf']);

app.use('/uploads', express.static(uploadsDir, {
  maxAge: isProduction ? '7d' : 0,
  etag: true,
  lastModified: true,
  dotfiles: 'deny',
  setHeaders(res, filePath) {
    // Never let a browser sniff the content type of an uploaded file.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const ext = path.extname(filePath).toLowerCase();
    if (!INLINE_SAFE_UPLOAD_EXTENSIONS.has(ext)) {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    }
  },
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
app.use('/api/public', require('./routes/public'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/super-admin', require('./routes/superAdmin'));
app.use('/api/college-admin', require('./routes/collegeAdmin'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/exams', require('./routes/exam'));
app.use('/api/assignments', require('./routes/assignment'));
app.use('/api/timetable', require('./routes/timetable'));
app.use('/api/fees', require('./routes/fee'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/leave', require('./routes/leave'));
app.use('/api/hr', require('./routes/leave'));
app.use('/api/logistics', require('./routes/logistics'));
app.use('/api/transport', require('./routes/transport'));
app.use('/api/hostel', require('./routes/hostel'));
app.use('/api/hostels', require('./routes/hostel'));
app.use('/api/complaints', require('./routes/grievance'));
app.use('/api/live-classes', require('./routes/liveClasses'));
app.use('/api/academics', require('./modules/academicsRoutes'));
app.use('/api/notices', require('./modules/noticesRoutes'));
app.use('/api/communications', require('./modules/communicationsRoutes'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/notification-preferences', require('./routes/notificationPreferences'));
app.use('/api/config', require('./routes/config'));
app.use('/api/health', require('./routes/health'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/subscriptions', require('./routes/subscription'));
app.use('/api/exam-generator', require('./routes/examGenerator'));
app.use('/api/grievances', require('./routes/grievance'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/visitors', require('./routes/visitor'));
app.use('/api/library', require('./routes/library'));
app.use('/api/books', require('./routes/library'));
app.use('/api/verification', require('./routes/verification'));
app.use('/api/placements', require('./routes/placement'));
app.use('/api/placement', require('./routes/placement'));
app.use('/api/career', require('./modules/careerRoutes'));
app.use('/api/assessments', require('./modules/assessmentRoutes'));
app.use('/api/quizzes', require('./modules/quizRoutes'));
app.use('/api/placement-drives', require('./modules/placementDriveRoutes'));
app.use('/api/mentorship', require('./modules/mentorshipRoutes'));
app.use('/api/intelligence', require('./modules/intelligenceRoutes'));
app.use('/api/alumni', require('./routes/alumni'));
app.use('/api/events', require('./routes/event'));
app.use('/api/face', require('./routes/face'));
app.use('/api/campus', require('./modules/campusRoutes'));
app.use('/api/energy', require('./modules/energyRoutes'));

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
  logger.info('Client connected', { socketId: socket.id, authenticated: Boolean(socket.user) });

  if (socket.user && (socket.user.id || socket.user._id)) {
    const authUserId = String(socket.user.id || socket.user._id);
    socket.join(`user:${authUserId}`);
    if (socket.user.role) socket.join(`role:${socket.user.role}`);
    if (socket.user.collegeId) socket.join(`college:${socket.user.collegeId}`);
    logger.debug('Authenticated socket auto-joined rooms', { socketId: socket.id, userId: authUserId, role: socket.user.role });
  }

  socket.on('join_room', (roomId) => {
    if (!roomId || typeof roomId !== 'string' || roomId.length > 100) return;
    const sanitizedRoom = roomId.replace(/[^a-zA-Z0-9_\-:]/g, '');
    if (sanitizedRoom.startsWith('user:')) {
      const targetUser = sanitizedRoom.replace(/^user:/, '');
      const authUserId = socket.user ? String(socket.user.id || socket.user._id) : null;
      // Private user rooms are never joinable by anybody but their owner -
      // this must hold in every environment, not only in production.
      if (!authUserId) {
        logger.warn('Socket attempted to subscribe to a private user room without authentication', { socketId: socket.id, target: sanitizedRoom });
        return;
      }
      if (authUserId !== targetUser) {
        logger.warn('Socket attempted to subscribe to another user room', { socketId: socket.id, target: sanitizedRoom });
        return;
      }
    }
    if (sanitizedRoom.startsWith('college:') || sanitizedRoom.startsWith('role:')) {
      const authUserId = socket.user ? String(socket.user.id || socket.user._id) : null;
      if (!authUserId) {
        logger.warn('Socket attempted to subscribe to an institutional room without authentication', { socketId: socket.id, room: sanitizedRoom });
        return;
      }
      // A user may only join the college room of the college they belong to.
      if (sanitizedRoom.startsWith('college:')) {
        const targetCollege = sanitizedRoom.replace(/^college:/, '');
        const ownCollege = socket.user.collegeId ? String(socket.user.collegeId) : null;
        if (!ownCollege || ownCollege !== targetCollege) {
          logger.warn('Socket attempted to subscribe to another college room', { socketId: socket.id, room: sanitizedRoom });
          return;
        }
      }
      // A user may only join the role room of the role they actually hold.
      if (sanitizedRoom.startsWith('role:')) {
        const targetRole = sanitizedRoom.replace(/^role:/, '');
        if (!socket.user.role || socket.user.role !== targetRole) {
          logger.warn('Socket attempted to subscribe to another role room', { socketId: socket.id, room: sanitizedRoom });
          return;
        }
      }
    }
    socket.join(sanitizedRoom);
    logger.debug('User joined room', { socketId: socket.id, roomId: sanitizedRoom });
  });

  socket.on('send_message', (data) => {
    if (!data || !data.roomId || typeof data.roomId !== 'string') return;
    const sanitizedRoom = data.roomId.replace(/[^a-zA-Z0-9_\-:]/g, '');
    // Messages may only be broadcast to rooms the sender has actually joined.
    if (!socket.rooms.has(sanitizedRoom)) {
      logger.warn('Socket attempted to broadcast to a room it has not joined', { socketId: socket.id, roomId: sanitizedRoom });
      return;
    }
    const payload = {
      ...data,
      roomId: sanitizedRoom,
      senderId: socket.user ? (socket.user.id || socket.user._id) : (data.senderId || 'anonymous'),
      timestamp: new Date().toISOString(),
    };
    io.to(sanitizedRoom).emit('receive_message', payload);
  });

  socket.on('join_user', (userId) => {
    if (socket.user && (socket.user.id || socket.user._id)) {
      const authUserId = String(socket.user.id || socket.user._id);
      socket.join(`user:${authUserId}`);
      logger.debug('Authenticated user joined personal room', { socketId: socket.id, userId: authUserId });
    } else {
      // Never allow a socket to subscribe to somebody else's private channel.
      logger.warn('Unauthenticated socket attempted to subscribe to a private user channel', { socketId: socket.id });
    }
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
