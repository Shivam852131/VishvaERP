const sanitize = (req, res, next) => {
  // Strip dangerous NoSQL operator injection keys ($where, $gt, $ne, etc.) and sanitize strings
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      return value.replace(/<[^>]*>/g, '').trim();
    }
    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }
    if (value && typeof value === 'object') {
      const cleaned = {};
      for (const [key, val] of Object.entries(value)) {
        // Drop any keys starting with $ or containing dots to prevent MongoDB operator injection
        if (key.startsWith('$') || key.includes('.')) {
          continue;
        }
        cleaned[key] = sanitizeValue(val);
      }
      return cleaned;
    }
    return value;
  };

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
