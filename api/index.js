const serverless = require('serverless-http');

// Set environment
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Import the Express app (server.js won't start listening in Vercel)
const app = require('../backend/server');

const { connectDB } = require('../backend/config/db');

// Track if DB is connected
let dbConnected = false;

// Middleware to ensure DB is connected
const ensureDB = async (req, res, next) => {
  if (!dbConnected) {
    try {
      await connectDB();
      dbConnected = true;
    } catch (error) {
      console.error('Vercel: DB connection failed:', error.message);
      return res.status(503).json({ success: false, message: 'Database connection failed' });
    }
  }
  next();
};

// Apply DB middleware to all routes
app.use(ensureDB);

// Wrap Express app with serverless-http for Vercel
module.exports = app;
module.exports.handler = serverless(app, {
  request: {
    timeout: 30,
  },
});
