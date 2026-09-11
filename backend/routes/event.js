const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  registerForEvent,
  checkInAttendee,
  cancelRegistration,
  getCalendarEvents,
  getEventStats,
  exportAttendees,
} = require('../controllers/eventController');

const router = express.Router();
router.use(protect, sameCollege, requireSubscription);

router.route('/')
  .post(authorize('collegeAdmin', 'superadmin', 'faculty'), createEvent)
  .get(getEvents);

router.get('/calendar', getCalendarEvents);
router.get('/stats', authorize('collegeAdmin', 'superadmin', 'faculty'), getEventStats);

router.route('/:id')
  .get(getEventById)
  .put(authorize('collegeAdmin', 'superadmin', 'faculty'), updateEvent)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteEvent);

router.post('/:id/register', registerForEvent);
router.post('/:id/cancel', cancelRegistration);
router.post('/:id/checkin-attendee', authorize('collegeAdmin', 'superadmin', 'faculty'), checkInAttendee);
router.post('/:id/verify-ticket', authorize('collegeAdmin', 'superadmin', 'faculty'), checkInAttendee);
router.get('/:id/export-attendees', authorize('collegeAdmin', 'superadmin', 'faculty'), exportAttendees);

module.exports = router;
