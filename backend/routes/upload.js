const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { uploadImage: uploadImageMiddleware, uploadAny, handleMulterError } = require('../middleware/upload');
const {
  uploadAvatar,
  uploadImage,
  uploadFile,
  uploadMultiple,
  deleteUpload,
} = require('../controllers/uploadController');

router.post('/avatar', protect, uploadImageMiddleware.single('file'), handleMulterError, uploadAvatar);
router.post('/image', protect, uploadImageMiddleware.single('file'), handleMulterError, uploadImage);
router.post('/file', protect, uploadAny.single('file'), handleMulterError, uploadFile);
router.post('/multiple', protect, uploadAny.array('files', 10), handleMulterError, uploadMultiple);
router.delete('/delete', protect, deleteUpload);

module.exports = router;
