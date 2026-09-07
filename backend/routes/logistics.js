const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  addHostel, addRoom, allocateRoom, getHostels, updateHostel, deleteHostel, deleteRoom, deallocateRoom, updateRoom,
  addRoute, getRoutes, deleteRoute, updateRoute, enrollStudent, unenrollStudent,
} = require('../controllers/logisticsController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

router.route('/hostels')
  .get(authorize('collegeAdmin', 'superadmin'), getHostels)
  .post(authorize('collegeAdmin', 'superadmin'), addHostel);

router.put('/hostels/:id', authorize('collegeAdmin', 'superadmin'), updateHostel);
router.delete('/hostels/:id', authorize('collegeAdmin', 'superadmin'), deleteHostel);
router.post('/hostels/rooms', authorize('collegeAdmin', 'superadmin'), addRoom);
router.put('/hostels/rooms/:id', authorize('collegeAdmin', 'superadmin'), updateRoom);
router.delete('/hostels/rooms/:id', authorize('collegeAdmin', 'superadmin'), deleteRoom);
router.post('/hostels/allocate', authorize('collegeAdmin', 'superadmin'), allocateRoom);
router.post('/hostels/deallocate', authorize('collegeAdmin', 'superadmin'), deallocateRoom);

router.route('/transport')
  .get(authorize('collegeAdmin', 'superadmin'), getRoutes)
  .post(authorize('collegeAdmin', 'superadmin'), addRoute);

router.route('/transport/:id')
  .put(authorize('collegeAdmin', 'superadmin'), updateRoute)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteRoute);

router.post('/transport/:id/enroll', authorize('collegeAdmin', 'superadmin'), enrollStudent);
router.post('/transport/:id/unenroll', authorize('collegeAdmin', 'superadmin'), unenrollStudent);

// Student-facing: see their own hostel/transport info
router.get('/my-hostel', authorize('student'), async (req, res) => {
  const { Room } = require('../models/Hostel');
  const room = await Room.findOne({ occupants: req.user._id, collegeId: req.user.collegeId })
    .populate('hostelId', 'name type warden');
  res.json({ success: true, room });
});

router.get('/my-transport', authorize('student'), async (req, res) => {
  const TransportRoute = require('../models/Transport');
  const route = await TransportRoute.findOne({ enrolledStudents: req.user._id, collegeId: req.user.collegeId });
  res.json({ success: true, route });
});

module.exports = router;
