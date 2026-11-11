const parseSemester = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = parseInt(String(value).replace(/[^\d]/g, ''), 10);
  return Number.isNaN(numeric) ? undefined : numeric;
};

const escapeRegex = (string) => String(string ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Hard cap on any user-supplied search term. Keeps a hostile input from being
// used to build an enormous pattern (and keeps the ReDoS surface small).
const MAX_SEARCH_LENGTH = 120;

/**
 * Build a MongoDB `$regex` filter from untrusted user input.
 *
 * Security properties:
 *  - Escapes every regex metacharacter, so the attacker cannot inject a
 *    pattern (`.*`, `^`, `|`, `(a+)+`) to widen the match or trigger
 *    catastrophic backtracking (ReDoS).
 *  - Truncates the input so the generated pattern stays small.
 *
 * @param {*} value untrusted input
 * @param {string} options mongo regex options (default case-insensitive)
 * @param {number} maxLength optional override for the length cap
 */
const regexFilter = (value, options = 'i', maxLength = MAX_SEARCH_LENGTH) => {
  const safe = escapeRegex(String(value ?? '').slice(0, maxLength));
  return { $regex: safe, $options: options };
};

/**
 * Same as `regexFilter` but anchored, for "exact match" lookups.
 */
const anchoredRegexFilter = (value, options = 'i', maxLength = MAX_SEARCH_LENGTH) => {
  const safe = escapeRegex(String(value ?? '').slice(0, maxLength));
  return { $regex: `^${safe}$`, $options: options };
};

module.exports = { parseSemester, escapeRegex, regexFilter, anchoredRegexFilter, MAX_SEARCH_LENGTH };
