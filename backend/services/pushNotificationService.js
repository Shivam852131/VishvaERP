const admin = require('firebase-admin');
const User = require('../models/User');

let firebaseApp = null;

function initFirebase() {
  if (firebaseApp) return firebaseApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });

  return firebaseApp;
}

function isPushConfigured() {
  return Boolean(initFirebase());
}

async function sendToTokens(tokens, payload) {
  const app = initFirebase();
  if (!app || !tokens?.length) {
    return { success: false, skipped: true, message: 'Push notifications are not configured.' };
  }

  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: {
      url: payload.url || '/',
      type: payload.type || 'general',
    },
    tokens,
  };

  const response = await admin.messaging().sendEachForMulticast(message);
  return {
    success: true,
    successCount: response.successCount,
    failureCount: response.failureCount,
  };
}

async function sendToUser(userId, payload) {
  const user = await User.findById(userId).select('deviceTokens');
  if (!user) return { success: false, message: 'User not found' };
  const tokens = (user.deviceTokens || []).map((entry) => entry.token).filter(Boolean);
  return sendToTokens(tokens, payload);
}

async function sendToUsers(userIds, payload) {
  const users = await User.find({ _id: { $in: userIds } }).select('deviceTokens');
  const tokens = users.flatMap((user) => (user.deviceTokens || []).map((entry) => entry.token)).filter(Boolean);
  return sendToTokens(tokens, payload);
}

async function sendToCollege(collegeId, payload, roles = []) {
  const query = { collegeId, isActive: true };
  if (roles.length) query.role = { $in: roles };
  const users = await User.find(query).select('deviceTokens');
  const tokens = users.flatMap((user) => (user.deviceTokens || []).map((entry) => entry.token)).filter(Boolean);
  return sendToTokens(tokens, payload);
}

module.exports = {
  isPushConfigured,
  sendToUser,
  sendToUsers,
  sendToCollege,
  sendToTokens,
};
