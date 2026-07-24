const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const {
  createVisitor, preRegisterVisitor, getVisitors, getVisitorById,
  checkOutVisitor, cancelVisitor, blacklistVisitor, getVisitorStats, deleteVisitor,
} = require('../controllers/visitorController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.route('/')
  .get(getVisitors)
  .post(createVisitor);

router.post('/pre-register', preRegisterVisitor);
router.get('/stats', getVisitorStats);
router.post('/blacklist', blacklistVisitor);

router.route('/:id')
  .get(getVisitorById)
  .delete(deleteVisitor);

router.post('/:id/checkout', checkOutVisitor);
router.post('/:id/cancel', cancelVisitor);

module.exports = router;
