const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  addHostel,
  getHostels,
  getHostelById,
  updateHostel,
  deleteHostel,
  addRoom,
  getRooms,
  updateRoom,
  deleteRoom,
  allocateRoom,
  deallocateRoom,
  transferRoom,
  addRoomMaintenance,
  getMyHostel,
} = require('../controllers/logisticsController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

// Student self-service
router.get('/my-hostel', authorize('student'), getMyHostel);

// Allocation and transfer operations
router.post('/allocate', authorize('collegeAdmin', 'superadmin'), allocateRoom);
router.post('/deallocate', authorize('collegeAdmin', 'superadmin'), deallocateRoom);
router.post('/transfer', authorize('collegeAdmin', 'superadmin'), transferRoom);

// Rooms management
router.route('/rooms')
  .get(authorize('collegeAdmin', 'superadmin', 'student', 'faculty'), getRooms)
  .post(authorize('collegeAdmin', 'superadmin'), addRoom);

router.route('/rooms/:id')
  .put(authorize('collegeAdmin', 'superadmin'), updateRoom)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteRoom);

router.post('/rooms/:id/maintenance', authorize('collegeAdmin', 'superadmin', 'student', 'faculty'), addRoomMaintenance);

// Hostel collection
router.route('/')
  .get(authorize('collegeAdmin', 'superadmin', 'student', 'faculty', 'parent'), getHostels)
  .post(authorize('collegeAdmin', 'superadmin'), addHostel);

// Single hostel operations
router.route('/:id')
  .get(authorize('collegeAdmin', 'superadmin', 'student', 'faculty'), getHostelById)
  .put(authorize('collegeAdmin', 'superadmin'), updateHostel)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteHostel);

module.exports = router;
