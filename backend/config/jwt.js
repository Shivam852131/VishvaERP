const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable is missing in production!');
    }
    return 'fallback_dev_jwt_secret_change_in_production_2024';
  }
  return secret;
};

const getRefreshSecret = () => {
  return process.env.JWT_REFRESH_SECRET || (getJwtSecret() + '-refresh');
};

const generateToken = (payload) => {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, getRefreshSecret(), {
    expiresIn: '30d',
  });
};

const verifyToken = (token) => {
  return jwt.verify(token, getJwtSecret());
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, getRefreshSecret());
};

const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const hashResetToken = (token) => {
  if (!token) return '';
  return crypto.createHash('sha256').update(String(token)).digest('hex');
};

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
  generateResetToken,
  hashResetToken,
};
