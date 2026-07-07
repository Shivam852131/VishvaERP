const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { addAlumni, getAlumni, getAlumniById, updateAlumni, createAlumniEvent, getAlumniEvents, registerForEvent, recordDonation, getDonations, getAlumniStats } = require('../controllers/alumniController');

const router = express.Router();
router.use(protect, sameCollege, requireSubscription);

router.route('/')
  .post(authorize('collegeAdmin', 'superadmin'), addAlumni)
  .get(getAlumni);

router.get('/stats', authorize('collegeAdmin', 'superadmin'), getAlumniStats);
router.route('/:id')
  .get(getAlumniById)
  .put(authorize('collegeAdmin', 'superadmin'), updateAlumni);

router.route('/events')
  .post(authorize('collegeAdmin', 'superadmin'), createAlumniEvent)
  .get(getAlumniEvents);

router.post('/events/:id/register', registerForEvent);

router.route('/donations')
  .post(authorize('collegeAdmin', 'superadmin'), recordDonation)
  .get(getDonations);

module.exports = router;
