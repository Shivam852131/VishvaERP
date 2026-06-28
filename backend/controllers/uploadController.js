const path = require('path');
const fs = require('fs');
const asyncHandler = require('../middleware/asyncHandler');
const { createAvatar, processImage, saveFile, deleteFile, getDir } = require('../services/fileService');

const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const processed = await createAvatar(req.file.buffer || fs.readFileSync(req.file.path));
  const url = await saveFile(processed, 'avatars', req.file.filename);

  if (req.file.path && req.file.path !== path.join(getDir('avatars'), req.file.filename)) {
    fs.unlink(req.file.path).catch(() => {});
  }

  res.json({ success: true, message: 'Avatar uploaded', url });
});

const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const processed = await processImage(req.file.buffer || fs.readFileSync(req.file.path));
  const url = await saveFile(processed, req.body.subdir || 'temp', req.file.filename);

  if (req.file.path && req.file.path !== path.join(getDir(req.body.subdir || 'temp'), req.file.filename)) {
    fs.unlink(req.file.path).catch(() => {});
  }

  res.json({ success: true, message: 'Image uploaded', url });
});

const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const subdir = req.body.subdir || req.query.subdir || 'temp';
  const url = `/${path.posix.join('uploads', subdir, req.file.filename)}`;

  res.json({ success: true, message: 'File uploaded', url, filename: req.file.filename });
});

const uploadMultiple = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files uploaded' });
  }

  const subdir = req.body.subdir || req.query.subdir || 'temp';
  const urls = req.files.map((file) => ({
    url: `/${path.posix.join('uploads', subdir, file.filename)}`,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
  }));

  res.json({ success: true, message: 'Files uploaded', files: urls });
});

const deleteUpload = asyncHandler(async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, message: 'File URL is required' });
  }

  await deleteFile(url);
  res.json({ success: true, message: 'File deleted' });
});

module.exports = { uploadAvatar, uploadImage, uploadFile, uploadMultiple, deleteUpload };
