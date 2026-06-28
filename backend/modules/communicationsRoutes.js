const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege } = require('../middleware/rbac');
const {
  getContactUsers,
  getConversations,
  getMessages,
  sendMessage,
} = require('./communicationController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

router.get('/users', getContactUsers);
router.get('/conversations', getConversations);
router.get('/messages/:userId', getMessages);
router.post('/messages', sendMessage);

module.exports = router;
