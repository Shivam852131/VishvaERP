const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const {
  getCollegeDashboard,
  getStudents,
  getFaculty,
  createUser,
  updateUser,
  toggleUser
} = require('../controllers/collegeAdminController');

const router = express.Router();

// Require auth and collegeAdmin role
router.use(protect);
router.use(authorize('collegeAdmin'));

router.get('/dashboard', getCollegeDashboard);

router.route('/students')
  .get(getStudents)
  .post(createUser);

router.post('/add-student', createUser);

router.route('/faculty')
  .get(getFaculty)
  .post(createUser);

router.post('/add-faculty', createUser);

router.route('/users/:id')
  .put(updateUser);

router.patch('/users/:id/toggle', toggleUser);

module.exports = router;
