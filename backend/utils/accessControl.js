const User = require('../models/User');

/**
 * Centralised student-visibility rules.
 *
 * Historically every controller implemented its own `if (role === 'student')`
 * narrowing, and the `parent` branch was repeatedly forgotten - which allowed
 * parents (and students) to read other students' records. All student-scoped
 * endpoints now resolve their target through this module so the rules are
 * applied consistently.
 */

const STAFF_ROLES = new Set(['faculty', 'collegeAdmin', 'superadmin']);
const ADMIN_ROLES = new Set(['collegeAdmin', 'superadmin']);

/**
 * Sentinel used as an "empty" id list.
 *
 * `null` must not be used for this: mongo casts it to a real `null` and would
 * happily match documents whose reference field is empty.
 */
const NO_MATCH = '000000000000000000000000';

const isStaff = (req) => STAFF_ROLES.has(req.user?.role);
const isAdmin = (req) => ADMIN_ROLES.has(req.user?.role);

/**
 * The student ids a parent is allowed to see (their linked children).
 * @returns {Promise<string[]>}
 */
const getChildStudentIds = async (req) => {
  if (req.user?.role !== 'parent') return [];

  let children = (req.user.children || []).map((child) => String(child?._id || child)).filter(Boolean);
  if (!children.length) {
    const parent = await User.findById(req.user._id).select('children');
    children = (parent?.children || []).map(String).filter(Boolean);
  }
  if (!children.length) {
    const linked = await User.find({
      collegeId: req.user.collegeId,
      role: 'student',
      parentId: req.user._id,
    }).select('_id');
    children = linked.map((student) => String(student._id));
  }

  return children;
};

/**
 * Resolve the single student whose data the caller is allowed to access.
 *
 * - students  -> always themselves
 * - parents   -> one of their linked children (403 otherwise)
 * - staff     -> any student of the caller's college (superadmin: any tenant)
 *
 * @returns {Promise<string|null>}
 */
const resolveAuthorizedStudentId = async (req, rawId) => {
  const role = req.user?.role;

  if (role === 'student') {
    return String(req.user._id);
  }

  if (role === 'parent') {
    const children = await getChildStudentIds(req);
    const requested = rawId || req.query?.studentId || req.body?.studentId;
    if (requested) {
      if (!children.includes(String(requested))) {
        const error = new Error('Access denied: You are only authorized to view records for your linked child');
        error.statusCode = 403;
        throw error;
      }
      return String(requested);
    }
    return children[0] || null;
  }

  // Staff
  const requested = rawId || req.query?.studentId || req.body?.studentId;
  if (!requested) return null;

  // A staff member may only reach a student inside their own college.
  const scope = req.user.role === 'superadmin'
    ? { _id: requested }
    : { _id: requested, collegeId: req.user.collegeId };

  const student = await User.findOne(scope).select('_id').lean();
  if (!student) {
    const error = new Error('Access denied: student not found in your college');
    error.statusCode = 403;
    throw error;
  }

  return String(student._id);
};

/**
 * Filter a caller-supplied list of student ids down to the ones the caller is
 * allowed to act upon. Staff keep everything (within the college); students
 * keep only themselves; parents keep only their children.
 */
const filterAuthorizedStudentIds = async (req, rawIds) => {
  const ids = (rawIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];

  const role = req.user?.role;

  if (role === 'student') {
    return ids.includes(String(req.user._id)) ? [String(req.user._id)] : [];
  }

  if (role === 'parent') {
    const children = await getChildStudentIds(req);
    return ids.filter((id) => children.includes(id));
  }

  return ids;
};

/**
 * Guard used by list endpoints: returns the mongo filter that limits results
 * to what the caller may see.
 *
 * @returns {object} mongo filter fragment
 */
const studentScopeFilter = async (req) => {
  const role = req.user?.role;

  if (role === 'student') {
    return { studentId: req.user._id };
  }

  if (role === 'parent') {
    const children = await getChildStudentIds(req);
    return { studentId: { $in: children.length ? children : [NO_MATCH] } };
  }

  if (role === 'superadmin') {
    return {};
  }

  return {};
};

module.exports = {
  STAFF_ROLES,
  ADMIN_ROLES,
  NO_MATCH,
  isStaff,
  isAdmin,
  getChildStudentIds,
  resolveAuthorizedStudentId,
  filterAuthorizedStudentIds,
  studentScopeFilter,
};
