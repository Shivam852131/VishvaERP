const express = require('express');
const { protect } = require('../middleware/auth');
const { authorize, sameCollege } = require('../middleware/rbac');
const {
  listLiveClasses,
  getLiveClassDetails,
  startLiveClass,
  endLiveClass,
  joinLiveClass,
  leaveLiveClass,
  raiseHand,
  syncAttendance,
  saveWhiteboard,
  postChatMessage,
  createOrVotePoll,
  updateRecording,
  addMaterial,
  listRecordings,
} = require('../controllers/liveClassController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);

// ── General queries ──
router.get('/', authorize('faculty', 'student', 'parent', 'collegeAdmin', 'superadmin'), listLiveClasses);
router.get('/recordings', authorize('faculty', 'student', 'parent', 'collegeAdmin', 'superadmin'), listRecordings);
router.get('/:id', authorize('faculty', 'student', 'parent', 'collegeAdmin', 'superadmin'), getLiveClassDetails);

// ── Faculty / Host actions ──
router.post('/', authorize('faculty', 'collegeAdmin', 'superadmin'), startLiveClass);
router.put('/:id/end', authorize('faculty', 'collegeAdmin', 'superadmin'), endLiveClass);
router.post('/:id/sync-attendance', authorize('faculty', 'collegeAdmin', 'superadmin'), syncAttendance);
router.post('/:id/whiteboard', authorize('faculty', 'collegeAdmin', 'superadmin'), saveWhiteboard);
router.post('/:id/recording', authorize('faculty', 'collegeAdmin', 'superadmin'), updateRecording);
router.post('/:id/materials', authorize('faculty', 'collegeAdmin', 'superadmin'), addMaterial);

// ── In-session interactive features (Faculty & Students) ──
router.post('/:id/join', authorize('student', 'faculty'), joinLiveClass);
router.post('/:id/leave', authorize('student', 'faculty'), leaveLiveClass);
router.post('/:id/raise-hand', authorize('student'), raiseHand);
router.post('/:id/chat', authorize('faculty', 'student', 'collegeAdmin'), postChatMessage);
router.post('/:id/poll', authorize('faculty', 'student', 'collegeAdmin'), createOrVotePoll);

module.exports = router;
