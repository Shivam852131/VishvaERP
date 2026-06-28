const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { dirs } = require('../services/fileService');

const ALLOWED_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_DOCUMENTS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];
const ALLOWED_ALL = [...ALLOWED_IMAGES, ...ALLOWED_DOCUMENTS];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const isVercel = !!process.env.VERCEL;
const storage = isVercel ? multer.memoryStorage() : multer.diskStorage({
  destination(req, file, cb) {
    const subdir = req.query.subdir || req.body.subdir || 'temp';
    const target = dirs[subdir] || dirs.temp;
    cb(null, target);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    const name = `${uuidv4()}${ext}`;
    cb(null, name);
  },
});

function fileFilter(allowed) {
  return (req, file, cb) => {
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Allowed: ${allowed.join(', ')}`), false);
    }
  };
}

const uploadImage = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: fileFilter(ALLOWED_IMAGES),
});

const uploadDocument = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: fileFilter(ALLOWED_DOCUMENTS),
});

const uploadAny = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: fileFilter(ALLOWED_ALL),
});

function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
}

module.exports = {
  uploadImage,
  uploadDocument,
  uploadAny,
  handleMulterError,
  ALLOWED_IMAGES,
  ALLOWED_DOCUMENTS,
};
