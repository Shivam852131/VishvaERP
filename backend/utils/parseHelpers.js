const parseSemester = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = parseInt(String(value).replace(/[^\d]/g, ''), 10);
  return Number.isNaN(numeric) ? undefined : numeric;
};

const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { parseSemester, escapeRegex };
