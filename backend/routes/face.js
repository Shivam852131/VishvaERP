const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege } = require('../middleware/rbac');
const {
  registerFace,
  verifyFace,
  checkFaceRegistered,
  deleteFaceData,
  faceCheckIn,
} = require('../controllers/faceController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

router.get('/status', checkFaceRegistered);
router.post('/register', registerFace);
router.post('/verify', verifyFace);
router.post('/checkin', faceCheckIn);
router.delete('/', deleteFaceData);

module.exports = router;
