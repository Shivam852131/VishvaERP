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

router.get('/sensors', getSensors);
router.post('/sensors', authorize('collegeAdmin'), createSensor);
router.put('/sensors/:id', authorize('collegeAdmin'), updateSensor);
router.delete('/sensors/:id', authorize('collegeAdmin'), deleteSensor);
router.post('/sensors/reading', recordReading);
router.get('/sensors/readings', getSensorReadings);
router.get('/sensors/dashboard', getSensorDashboard);

router.get('/resources', getResources);
router.post('/resources', authorize('collegeAdmin'), createResource);
router.put('/resources/:id', authorize('collegeAdmin'), updateResource);
router.delete('/resources/:id', authorize('collegeAdmin'), deleteResource);
router.get('/resources/stats', getResourceStats);

module.exports = router;
