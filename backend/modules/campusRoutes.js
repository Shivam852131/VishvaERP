const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege, authorize } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  getSensors, createSensor, updateSensor, deleteSensor,
  recordReading, getSensorReadings, getSensorDashboard,
  getResources, createResource, updateResource, deleteResource, getResourceStats,
} = require('../controllers/campusController');

const router = express.Router();
router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.get('/sensors', authorize('collegeAdmin', 'superadmin', 'faculty'), getSensors);
router.post('/sensors', authorize('collegeAdmin'), createSensor);
router.put('/sensors/:id', authorize('collegeAdmin'), updateSensor);
router.delete('/sensors/:id', authorize('collegeAdmin'), deleteSensor);
// Sensor readings drive campus-wide safety alerts that are broadcast to every
// connected client - only trusted roles may submit them.
router.post('/sensors/reading', authorize('collegeAdmin', 'superadmin', 'faculty'), recordReading);
router.get('/sensors/readings', authorize('collegeAdmin', 'superadmin', 'faculty'), getSensorReadings);
router.get('/sensors/dashboard', authorize('collegeAdmin', 'superadmin', 'faculty'), getSensorDashboard);

router.get('/resources', authorize('collegeAdmin', 'superadmin', 'faculty'), getResources);
router.post('/resources', authorize('collegeAdmin'), createResource);
router.put('/resources/:id', authorize('collegeAdmin'), updateResource);
router.delete('/resources/:id', authorize('collegeAdmin'), deleteResource);
router.get('/resources/stats', authorize('collegeAdmin', 'superadmin', 'faculty'), getResourceStats);

module.exports = router;
