const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { createItem, getItems, getItemById, updateItem, deleteItem, assignItem, addMaintenanceLog, getInventoryStats } = require('../controllers/inventoryController');

const router = express.Router();
router.use(protect, sameCollege, requireSubscription);

router.route('/')
  .post(authorize('collegeAdmin', 'superadmin'), createItem)
  .get(getItems);

router.get('/stats', authorize('collegeAdmin', 'superadmin'), getInventoryStats);
router.route('/:id')
  .get(getItemById)
  .put(authorize('collegeAdmin', 'superadmin'), updateItem)
  .delete(authorize('collegeAdmin', 'superadmin'), deleteItem);

router.post('/:id/assign', authorize('collegeAdmin', 'superadmin'), assignItem);
router.post('/:id/maintenance', authorize('collegeAdmin', 'superadmin'), addMaintenanceLog);

module.exports = router;
