const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const {
  createCollege, getColleges, getCollegeById, updateCollege, deleteCollege,
  toggleCollege, updateCollegePlan, assignCollegeAdmin,
  getAllUsers, createUser, updateUser, resetUserPassword, toggleUser, deleteUser,
  getDatabaseStats, getCollectionData, deleteCollectionDocument,
  getAuditLogs, getBroadcastHistory, getPlatformSettings, updatePlatformSettings,
  getGlobalAnalytics, getSystemHealth, broadcastNotice, bulkToggleUsers,
} = require('../controllers/superAdminController');

const router = express.Router();

// All routes require authentication and superadmin role
router.use(protect);
router.use(authorize('superadmin'));

// ── Analytics & System ──────────────────────────────
router.get('/analytics', getGlobalAnalytics);
router.get('/system-health', getSystemHealth);
router.post('/broadcast', broadcastNotice);
router.get('/broadcasts', getBroadcastHistory);
router.route('/settings')
  .get(getPlatformSettings)
  .put(updatePlatformSettings);

// ── College Management ───────────────────────────────
router.route('/colleges')
  .post(createCollege)
  .get(getColleges);

router.post('/register-college', createCollege);

router.route('/colleges/:id')
  .get(getCollegeById)
  .put(updateCollege)
  .delete(deleteCollege);

router.patch('/colleges/:id/toggle', toggleCollege);
router.put('/colleges/:id/assign-admin', assignCollegeAdmin);
router.put('/colleges/:id/plan', updateCollegePlan);

// ── User Management ───────────────────────────────
router.route('/users')
  .get(getAllUsers)
  .post(createUser);

router.route('/users/:id')
  .put(updateUser)
  .delete(deleteUser);

router.patch('/users/:id/toggle', toggleUser);
router.post('/users/:id/reset-password', resetUserPassword);
router.post('/users/bulk-toggle', bulkToggleUsers);

// ── Database Management ───────────────────────────────
router.get('/database/stats', getDatabaseStats);
router.get('/database/collection/:collection', getCollectionData);
router.delete('/database/collection/:collection/:docId', deleteCollectionDocument);

// ── Audit Logs ───────────────────────────────────────
router.get('/audit-logs', getAuditLogs);

module.exports = router;
