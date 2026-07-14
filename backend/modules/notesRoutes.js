const express = require('express');
const { protect } = require('../middleware/auth');
const { sameCollege } = require('../middleware/rbac');
const { requireSubscription } = require('../middleware/subscription');
const { uploadAny, handleMulterError } = require('../middleware/upload');
const { getNotes, createNote, deleteNote, incrementDownload, toggleVote, toggleBookmark, rateNote, addComment, updateComment, deleteComment, voteComment } = require('../controllers/notesController');

const router = express.Router();

router.use(protect);
router.use(sameCollege);
router.use(requireSubscription);

router.route('/')
  .get(getNotes)
  .post(uploadAny.array('files', 10), handleMulterError, createNote);

router.route('/:id')
  .delete(deleteNote);

router.post('/:id/download', incrementDownload);
router.post('/:id/vote', toggleVote);
router.post('/:id/bookmark', toggleBookmark);
router.post('/:id/rate', rateNote);
router.post('/:id/comments', addComment);
router.put('/:id/comments', updateComment);
router.delete('/:id/comments', deleteComment);
router.post('/:id/comments/vote', voteComment);

module.exports = router;
