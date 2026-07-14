const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { createCompany, getCompanies, createJob, getJobs, getJobById, updateJob, applyForJob, getApplications, updateApplication, getPlacementStats, getATSScore, bulkUpdateApplications } = require('../controllers/placementController');

const router = express.Router();
router.use(protect, sameCollege, requireSubscription);

router.post('/companies', authorize('collegeAdmin', 'superadmin'), createCompany);
router.get('/companies', getCompanies);

router.route('/jobs')
  .post(authorize('collegeAdmin', 'superadmin'), createJob)
  .get(getJobs);

router.get('/jobs/:id', getJobById);
router.put('/jobs/:id', authorize('collegeAdmin', 'superadmin'), updateJob);
router.post('/jobs/:id/apply', authorize('student'), applyForJob);

router.route('/applications')
  .get(getApplications);

router.put('/applications/:id', authorize('collegeAdmin', 'superadmin'), updateApplication);
router.get('/stats', authorize('collegeAdmin', 'superadmin'), getPlacementStats);
router.get('/jobs/:id/ats', getATSScore);
router.post('/applications/bulk-update', authorize('collegeAdmin', 'superadmin'), bulkUpdateApplications);

module.exports = router;
