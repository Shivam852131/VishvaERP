const express = require('express');
const { protect } = require('../middleware/auth');
const {
  uploadImage: uploadImageMiddleware,
  uploadAny,
  singleUpload,
  arrayUpload,
  handleMulterError,
} = require('../middleware/upload');
const {
  uploadAvatar,
  uploadImage,
  uploadFile,
  uploadMultiple,
  deleteUpload,
} = require('../controllers/uploadController');

const router = express.Router();

// A single file may be posted under `file`, `image`, `photo` or `document`.
router.post('/avatar', protect, singleUpload(uploadImageMiddleware), handleMulterError, uploadAvatar);
router.post('/image', protect, singleUpload(uploadImageMiddleware), handleMulterError, uploadImage);
router.post('/file', protect, singleUpload(uploadAny), handleMulterError, uploadFile);
router.post('/multiple', protect, arrayUpload(uploadAny, ['files', 'file', 'images'], 10), handleMulterError, uploadMultiple);
router.delete('/delete', protect, deleteUpload);

module.exports = router;
