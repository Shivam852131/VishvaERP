/**
 * Schema-aware payload helpers.
 *
 * Passing `req.body` straight into `Model.create()` / `Model.findOneAndUpdate()`
 * is a mass-assignment vulnerability: the caller can write fields that must be
 * controlled by the server (`collegeId` -> cross-tenant write, `role`,
 * `isActive`, `status` -> forged financial/audit state, `organizer` -> forged
 * audit trail).
 *
 * These helpers derive the writable field list from the mongoose schema
 * itself, so they stay correct as models evolve, and they always apply the
 * protected fields last / not at all.
 */

/** Fields that are never writable through a client payload. */
const ALWAYS_PROTECTED = ['_id', 'id', '__v', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'];

/**
 * Fields that belong to the server and must never be set by a client.
 *
 * `collegeId` would allow a cross-tenant write, `role` a privilege
 * escalation and `tokenVersion` a session-revocation bypass. Endpoints that
 * legitimately need to change them must opt in explicitly through
 * `extraProtected` / `serverFields`.
 */
const DEFAULT_PROTECTED = ['collegeId', 'role', 'tokenVersion'];

/**
 * Build a plain object containing only the schema-known, writable fields of a
 * client payload.
 *
 * Mongoose exposes a nested object literal (`currentLocation: { lat, lng }`)
 * as the *dotted* paths `currentLocation.lat`, `currentLocation.lng` - there is
 * no top level `currentLocation` entry. Those roots are collected separately so
 * that a whole nested object can still be written.
 *
 * @param {import('mongoose').Model} Model
 * @param {object} body untrusted payload
 * @param {string[]} [extraProtected] additional fields to lock down
 */
const pickWritable = (Model, body, extraProtected = []) => {
  const output = {};
  if (!body || typeof body !== 'object') return output;

  const protectedFields = new Set([...ALWAYS_PROTECTED, ...DEFAULT_PROTECTED, ...extraProtected]);
  const paths = Model?.schema?.paths || {};

  // Direct schema paths (top level, no dot).
  const directPaths = Object.keys(paths).filter((path) => !path.includes('.'));

  // Roots of nested object literals, e.g. `currentLocation` for
  // `currentLocation.lat`.
  const nestedRoots = new Set();
  for (const path of Object.keys(paths)) {
    if (!path.includes('.')) continue;
    const root = path.split('.')[0];
    if (!protectedFields.has(root)) nestedRoots.add(root);
  }

  for (const path of directPaths) {
    if (protectedFields.has(path)) continue;
    if (body[path] !== undefined) {
      output[path] = body[path];
    }
  }

  for (const root of nestedRoots) {
    if (protectedFields.has(root)) continue;
    if (body[root] !== undefined) {
      output[root] = body[root];
    }
  }

  // If the model has no schema information (should not happen), fall back to an
  // empty payload rather than trusting the client.
  return output;
};

/**
 * Build a `$set` update document for `findOneAndUpdate` / `updateOne`.
 */
const buildUpdate = (Model, body, extraProtected = []) => ({
  $set: pickWritable(Model, body, extraProtected),
});

/**
 * Build the document for `Model.create(...)`, re-applying the protected
 * server-owned fields last so they always win.
 */
const buildDocument = (Model, body, { extraProtected = [], serverFields = {} } = {}) => ({
  ...pickWritable(Model, body, extraProtected),
  ...serverFields,
});

module.exports = {
  ALWAYS_PROTECTED,
  DEFAULT_PROTECTED,
  pickWritable,
  buildUpdate,
  buildDocument,
};
