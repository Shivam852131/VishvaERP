const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const College = require('../models/College');
const {
  getCollegeDashboard,
  getStudents,
  getFaculty,
  createUser,
  updateUser,
  toggleUser
} = require('../controllers/collegeAdminController');

const router = express.Router();

// Require auth and collegeAdmin role
router.use(protect);
router.use(authorize('collegeAdmin'));

// Dashboard is always accessible (shows subscription status)
router.get('/dashboard', getCollegeDashboard);

// ── Portal branding (per-college theming, no subscription gate) ──
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const pickTheme = (body = {}) => {
  const theme = {};
  const strings = { portalName: 80, tagline: 120, logoUrl: 500 };
  Object.entries(strings).forEach(([key, max]) => {
    if (body[key] !== undefined) theme[key] = String(body[key] || '').slice(0, max);
  });
  ['primaryColor', 'accentColor'].forEach((key) => {
    if (body[key] !== undefined) {
      const value = String(body[key] || '').trim();
      if (value && !HEX_COLOR.test(value)) {
        const err = new Error(`${key} must be a hex color like #8B5CF6`);
        err.statusCode = 400;
        throw err;
      }
      theme[key] = value;
    }
  });
  return theme;
};

router.get('/branding', async (req, res) => {
  try {
    const college = await College.findById(req.user.collegeId).select('name code logo theme').lean();
    res.json({
      success: true,
      branding: college ? { name: college.name, code: college.code, logo: college.logo || '', theme: college.theme || {} } : null,
    });
  } catch (error) {
    console.error('GET /college-admin/branding failed:', error);
    res.status(500).json({ success: false, message: 'Failed to load branding' });
  }
});

router.put('/branding', async (req, res) => {
  try {
    const college = await College.findById(req.user.collegeId);
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });
    college.theme = { ...pickTheme(req.body) };
    await college.save();
    res.json({ success: true, message: 'Portal branding updated', branding: { name: college.name, code: college.code, logo: college.logo || '', theme: college.theme } });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ success: false, message: error.message });
    console.error('PUT /college-admin/branding failed:', error);
    res.status(500).json({ success: false, message: 'Failed to update branding' });
  }
});

// Apply subscription gate to all other college-admin routes
router.use(requireSubscription);

router.route('/students')
  .get(getStudents)
  .post(createUser);

router.post('/add-student', createUser);

router.route('/faculty')
  .get(getFaculty)
  .post(createUser);

router.post('/add-faculty', createUser);

router.route('/users/:id')
  .put(updateUser);

router.patch('/users/:id/toggle', toggleUser);

module.exports = router;
