const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { addHostel, addRoom, allocateRoom, getHostels, addRoute, getRoutes, deleteRoute } = require('../controllers/logisticsController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(authorize('collegeAdmin', 'superadmin'));

router.route('/hostels')
  .get(getHostels)
  .post(addHostel);

router.post('/hostels/rooms', addRoom);
router.post('/hostels/allocate', allocateRoom);

router.route('/transport')
  .get(getRoutes)
  .post(addRoute);

router.delete('/transport/:id', deleteRoute);

module.exports = router;
