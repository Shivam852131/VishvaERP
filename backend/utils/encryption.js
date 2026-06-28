const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function deriveKey(secret) {
  return crypto.scryptSync(secret, 'vishva-erp-salt', 32);
}

function encrypt(text, secret) {
  if (!text) return '';
  const key = deriveKey(secret || process.env.JWT_SECRET);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText, secret) {
  if (!encryptedText) return '';
  try {
    const key = deriveKey(secret || process.env.JWT_SECRET);
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedText;
  }
}

function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  const parts = text.split(':');
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === TAG_LENGTH * 2;
}

module.exports = { encrypt, decrypt, isEncrypted };
