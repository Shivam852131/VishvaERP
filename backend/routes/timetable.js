const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  getTimetable,
  createTimetableSlot,
  updateTimetableSlot,
  deleteTimetableSlot,
  detectClashes,
  getTodayQueue,
  exportICS,
} = require('../controllers/timetableController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

// Specialized endpoints first
router.get('/today', getTodayQueue);
router.get('/clashes', authorize('collegeAdmin', 'faculty'), detectClashes);
router.get('/export/ics', exportICS);

// Core CRUD
router.route('/')
  .get(getTimetable)
  .post(authorize('collegeAdmin', 'faculty'), createTimetableSlot);

router.route('/:id')
  .put(authorize('collegeAdmin', 'faculty'), updateTimetableSlot)
  .delete(authorize('collegeAdmin', 'faculty'), deleteTimetableSlot);

module.exports = router;
