const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * A signing secret must be long and unpredictable. A short or well-known
 * secret lets anybody forge a valid JWT (including a superadmin token).
 */
const assertStrongSecret = (secret, name) => {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error(`FATAL: ${name} must be at least 32 characters long in production!`);
  }
  if (/^(change|replace|your|secret|password|example|test|default)/i.test(secret)) {
    throw new Error(`FATAL: ${name} still looks like a placeholder value!`);
  }
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL: JWT_SECRET environment variable is missing in production! '
        + 'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))" '
        + 'and add it to your deployment environment.'
      );
    }
    return 'fallback_dev_jwt_secret_change_in_production_2024';
  }
  if (process.env.NODE_ENV === 'production') {
    assertStrongSecret(secret, 'JWT_SECRET');
  }
  return secret;
};

const getRefreshSecret = () => {
  const configured = process.env.JWT_REFRESH_SECRET;
  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL: JWT_REFRESH_SECRET environment variable is missing in production! '
        + 'It must be different from JWT_SECRET - otherwise compromising the access '
        + 'secret also compromises every refresh token. '
        + 'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
      );
    }
    return getJwtSecret() + '-refresh';
  }
  if (process.env.NODE_ENV === 'production') {
    assertStrongSecret(configured, 'JWT_REFRESH_SECRET');
  }
  return configured;
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
