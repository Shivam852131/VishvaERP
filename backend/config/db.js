const mongoose = require('mongoose');

const stateNames = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

let listenersRegistered = false;

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function maskMongoUri(uri) {
  return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:@/]+):([^@/]+)@/i, '$1$2:****@');
}

function getMongoUri() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is required. Set it to your local MongoDB or MongoDB Atlas connection string.');
  }
  return uri;
}

function getMongoOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    appName: process.env.MONGO_APP_NAME || 'VishvaERP',
    maxPoolSize: readNumber('MONGO_MAX_POOL_SIZE', 20),
    minPoolSize: readNumber('MONGO_MIN_POOL_SIZE', isProduction ? 2 : 0),
    serverSelectionTimeoutMS: readNumber('MONGO_SERVER_SELECTION_TIMEOUT_MS', 10000),
    socketTimeoutMS: readNumber('MONGO_SOCKET_TIMEOUT_MS', 45000),
    heartbeatFrequencyMS: readNumber('MONGO_HEARTBEAT_MS', 10000),
    retryWrites: process.env.MONGO_RETRY_WRITES !== 'false',
    autoIndex: process.env.MONGO_AUTO_INDEX ? process.env.MONGO_AUTO_INDEX === 'true' : !isProduction,
  };
}

function registerConnectionListeners() {
  if (listenersRegistered) {
    return;
  }

  mongoose.connection.on('connected', () => {
    console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected');
  });

  mongoose.connection.on('error', (error) => {
    console.error(`MongoDB connection error: ${error.message}`);
  });

  listenersRegistered = true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  registerConnectionListeners();

  const uri = getMongoUri();
  const retries = readNumber('MONGO_CONNECT_RETRIES', 5);
  const baseDelay = readNumber('MONGO_RETRY_DELAY_MS', 1000);
  const options = getMongoOptions();

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const startedAt = Date.now();
      const conn = await mongoose.connect(uri, options);
      await conn.connection.db.admin().ping();
      console.log(`MongoDB ready in ${Date.now() - startedAt}ms: ${maskMongoUri(uri)}`);
      return conn.connection;
    } catch (error) {
      const isLastAttempt = attempt === retries;
      console.error(`MongoDB connect attempt ${attempt}/${retries} failed: ${error.message}`);

      if (isLastAttempt) {
        throw error;
      }

      await delay(baseDelay * attempt);
    }
  }

  return mongoose.connection;
}

async function pingDatabase() {
  const startedAt = Date.now();

  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return {
      ok: false,
      latencyMs: null,
      message: 'MongoDB is not connected',
    };
  }

  await mongoose.connection.db.admin().ping();

  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    message: 'MongoDB ping successful',
  };
}

async function getDbHealth() {
  const readyState = mongoose.connection.readyState;
  const ping = await pingDatabase().catch((error) => ({
    ok: false,
    latencyMs: null,
    message: error.message,
  }));

  return {
    status: ping.ok ? 'healthy' : 'unhealthy',
    state: stateNames[readyState] || 'unknown',
    readyState,
    host: mongoose.connection.host || null,
    database: mongoose.connection.name || null,
    models: mongoose.modelNames().length,
    ping,
  };
}

async function disconnectDB() {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.connection.close(false);
  console.log('MongoDB connection closed');
}

module.exports = {
  connectDB,
  disconnectDB,
  getDbHealth,
  pingDatabase,
};
