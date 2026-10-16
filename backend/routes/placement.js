const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { uploadAny } = require('../middleware/upload');
const {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  createJob,
  getJobs,
  getJobById,
  updateJob,
  deleteJob,
  applyForJob,
  getApplications,
  updateApplication,
  acceptOffer,
  declineOffer,
  getPlacementStats,
  getATSScore,
  bulkUpdateApplications,
  getDrives,
  createDrive,
  updateDrive,
  deleteDrive,
  registerForDrive,
  getDriveAttendees,
  updateDriveStudentStatus,
  exportDriveRoster,
  exportPlacementReport,
} = require('../controllers/placementController');

const router = express.Router();
router.use(protect, sameCollege, requireSubscription);

// Companies
router.post('/companies', authorize('collegeAdmin', 'superadmin'), createCompany);
router.get('/companies', getCompanies);
router.route('/companies/:id')
  .get(getCompanyById)
  .put(authorize('collegeAdmin', 'superadmin'), updateCompany)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteCompany);

// Jobs
router.route('/jobs')
  .post(authorize('collegeAdmin', 'superadmin'), createJob)
  .get(getJobs);

router.get('/jobs/:id', getJobById);
router.put('/jobs/:id', authorize('collegeAdmin', 'superadmin'), updateJob);
router.delete('/jobs/:id', authorize('collegeAdmin', 'superadmin'), deleteJob);
router.post('/jobs/:id/apply', authorize('student'), uploadAny.single('resume'), applyForJob);
router.get('/jobs/:id/ats', getATSScore);

// Applications
router.route('/applications')
  .get(getApplications)
  .post(authorize('student'), uploadAny.single('resume'), applyForJob);

router.put('/applications/:id', authorize('collegeAdmin', 'superadmin'), updateApplication);
router.post('/applications/:id/accept', authorize('student'), acceptOffer);
router.post('/applications/:id/decline', authorize('student'), declineOffer);
router.post('/applications/bulk-update', authorize('collegeAdmin', 'superadmin'), bulkUpdateApplications);

// Drives
router.route('/drives')
  .get(getDrives)
  .post(authorize('collegeAdmin', 'superadmin'), createDrive);

router.route('/drives/:id')
  .put(authorize('collegeAdmin', 'superadmin'), updateDrive)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteDrive);

router.post('/drives/:id/register', authorize('student'), registerForDrive);
router.get('/drives/:id/attendees', authorize('collegeAdmin', 'superadmin'), getDriveAttendees);
router.patch('/drives/:id/students/:studentId', authorize('collegeAdmin', 'superadmin'), updateDriveStudentStatus);
router.get('/drives/:id/export', authorize('collegeAdmin', 'superadmin'), exportDriveRoster);

// Stats & Metrics
router.get('/stats', authorize('collegeAdmin', 'superadmin', 'student', 'faculty'), getPlacementStats);

// Export CSV for Accreditation & Governance
router.get('/export', authorize('collegeAdmin', 'superadmin'), exportPlacementReport);

module.exports = router;
