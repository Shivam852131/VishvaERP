const sanitize = (req, res, next) => {
  const stripHtml = (value) => {
    if (typeof value === 'string') {
      return value.replace(/<[^>]*>/g, '').trim();
    }
    if (Array.isArray(value)) {
      return value.map(stripHtml);
    }
    if (value && typeof value === 'object') {
      const cleaned = {};
      for (const [key, val] of Object.entries(value)) {
        cleaned[key] = stripHtml(val);
      }
      return cleaned;
    }
    return value;
  };

  if (req.body && typeof req.body === 'object') {
    req.body = stripHtml(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    for (const [key, val] of Object.entries(req.query)) {
      if (typeof val === 'string') {
        req.query[key] = val.replace(/<[^>]*>/g, '').trim();
      }
    }
  }

  next();
};

module.exports = sanitize;
