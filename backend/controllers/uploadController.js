const path = require('path');
const fs = require('fs');
const asyncHandler = require('../middleware/asyncHandler');
const { createAvatar, processImage, saveFile, deleteFile, getDir } = require('../services/fileService');
const { verifyMagicBytes, pickSubdir } = require('../middleware/upload');
const Upload = require('../models/Upload');

/** Record who uploaded a file so deletion can be authorised later. */
async function registerUpload(req, { url, filename, originalName, mimetype, size, subdir }) {
  try {
    await Upload.create({
      url,
      filename,
      originalName,
      mimetype,
      size: size || 0,
      subdir,
      uploadedBy: req.user._id,
      uploadedByEmail: req.user.email,
      collegeId: req.user.collegeId,
    });
  } catch {
    // Registry is best-effort: never fail the upload because of it.
  }
}

/** Remove the temporary upload after it has been re-encoded. */
async function cleanupTemp(file, keepDir, keepName) {
  if (!file || !file.path) return;
  if (file.path === path.join(getDir(keepDir), keepName)) return;
  fs.promises.unlink(file.path).catch(() => {});
}

/**
 * The directory a file was actually written to.
 *
 * `req.file.__subdir` is set by the upload middleware while the file is being
 * written. Using it (instead of re-resolving the request) guarantees that the
 * returned URL always points at the file that is on disk - the multipart body
 * may not have been parsed yet when the file part was handled, so resolving
 * the sub-directory a second time could produce a different answer.
 */
const storedSubdir = (req, file) => file?.__subdir || req.__uploadSubdir || pickSubdir(req);

const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const processed = await createAvatar(req.file.buffer || fs.readFileSync(req.file.path));
  const filename = `${path.parse(req.file.filename).name}.jpg`;
  const url = await saveFile(processed, 'avatars', filename);

  await cleanupTemp(req.file, 'avatars', filename);

  await registerUpload(req, {
    url,
    filename,
    originalName: req.file.originalname,
    mimetype: 'image/jpeg',
    size: processed.length,
    subdir: 'avatars',
  });

  res.json({ success: true, message: 'Avatar uploaded', url });
});

const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const subdir = storedSubdir(req, req.file);
  const processed = await processImage(req.file.buffer || fs.readFileSync(req.file.path));
  const filename = `${path.parse(req.file.filename).name}.jpg`;
  const url = await saveFile(processed, subdir, filename);

  await cleanupTemp(req.file, subdir, filename);

  await registerUpload(req, {
    url,
    filename,
    originalName: req.file.originalname,
    mimetype: 'image/jpeg',
    size: processed.length,
    subdir,
  });

  res.json({ success: true, message: 'Image uploaded', url });
});

const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const subdir = storedSubdir(req, req.file);

  // Content must match the announced binary type (blocks HTML/JS smuggled as
  // an "image" or a "PDF").
  const valid = await verifyMagicBytes(req.file.path, req.file.mimetype);
  if (!valid) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ success: false, message: 'File content does not match the declared file type.' });
  }

  const url = `/${path.posix.join('uploads', subdir, req.file.filename)}`;

  await registerUpload(req, {
    url,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    subdir,
  });

  res.json({ success: true, message: 'File uploaded', url, filename: req.file.filename });
});

const uploadMultiple = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files uploaded' });
  }

  const accepted = [];
  const rejected = [];

  for (const file of req.files) {
    // Use the directory this particular file was written to.
    const fileSubdir = storedSubdir(req, file);

    // eslint-disable-next-line no-await-in-loop
    const valid = await verifyMagicBytes(file.path, file.mimetype);
    if (!valid) {
      fs.promises.unlink(file.path).catch(() => {});
      rejected.push({ filename: file.originalname, reason: 'content does not match declared type' });
      continue;
    }

    const url = `/${path.posix.join('uploads', fileSubdir, file.filename)}`;
    accepted.push({
      url,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    });

    // eslint-disable-next-line no-await-in-loop
    await registerUpload(req, {
      url,
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      subdir: fileSubdir,
    });
  }

  res.json({
    success: true,
    message: rejected.length ? `${accepted.length} file(s) uploaded, ${rejected.length} rejected` : 'Files uploaded',
    files: accepted,
    rejected,
  });
});

const deleteUpload = asyncHandler(async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, message: 'File URL is required' });
  }

  if (url.includes('..') || url.includes('\0')) {
    return res.status(400).json({ success: false, message: 'Invalid file URL: path traversal prohibited' });
  }

  try {
    // Ownership check: only the uploader (or a college admin / superadmin) may
    // delete a file. Prevents cross-user file destruction.
    const record = await Upload.findOne({ url: url.replace(/^\/+/, '/') })
      .catch(() => null);

    const isPrivileged = req.user.role === 'superadmin' || req.user.role === 'collegeAdmin';
    if (record && !isPrivileged && String(record.uploadedBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied: you can only delete your own uploads' });
    }
    if (!record && !isPrivileged) {
      return res.status(403).json({ success: false, message: 'Access denied: unknown upload' });
    }

    const deleted = await deleteFile(url);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'File not found or already removed' });
    }

    if (record) {
      await Upload.deleteOne({ _id: record._id }).catch(() => {});
    }

    res.json({ success: true, message: 'File deleted' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = { uploadAvatar, uploadImage, uploadFile, uploadMultiple, deleteUpload };
