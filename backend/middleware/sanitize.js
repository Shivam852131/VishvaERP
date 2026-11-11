/**
 * Global input sanitizer.
 *
 * Protections:
 *  1. NoSQL operator injection - strips any key starting with `$` (e.g. `$ne`,
 *     `$gt`, `$where`) from body/query/params at any depth.
 *  2. Prototype pollution - strips `__proto__`, `constructor` and `prototype`
 *     keys. `JSON.parse()` turns `{"__proto__":{...}}` into an *own* enumerable
 *     property, so assigning it back onto a plain object would replace that
 *     object's prototype and let an attacker inject values into fields the
 *     application reads as if they were its own (e.g. `req.body.role`).
 *  3. Depth/width caps so a deeply nested or extremely wide payload cannot be
 *     used to exhaust CPU or memory.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 20;
const MAX_ARRAY_LENGTH = 10000;

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeValue = (value, depth = 0) => {
  if (depth > MAX_DEPTH) return undefined;

  if (typeof value === 'string') {
    // Strip HTML tags (blocks stored-XSS through text fields) and trim.
    return value.replace(/<[^>]*>/g, '').trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    const capped = value.length > MAX_ARRAY_LENGTH ? value.slice(0, MAX_ARRAY_LENGTH) : value;
    return capped.map((entry) => sanitizeValue(entry, depth + 1)).filter((entry) => entry !== undefined);
  }

  if (isPlainObject(value)) {
    const cleaned = {};
    for (const [key, val] of Object.entries(value)) {
      // Prototype pollution vectors - never copied through.
      if (DANGEROUS_KEYS.has(key)) continue;
      // MongoDB operator injection - never copied through.
      if (key.startsWith('$') || key.includes('.')) continue;
      const sanitized = sanitizeValue(val, depth + 1);
      if (sanitized !== undefined) {
        cleaned[key] = sanitized;
      }
    }
    return cleaned;
  }

  return value;
};

const sanitize = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query);
  }

  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeValue(req.params);
  }

  next();
};

module.exports = sanitize;
module.exports.sanitizeValue = sanitizeValue;
module.exports.DANGEROUS_KEYS = DANGEROUS_KEYS;
