const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
const MAX_IMAGE_DIMENSION = 2048;
const AVATAR_SIZE = 400;
const JPEG_QUALITY = 85;

const dirs = {
  avatars: path.join(UPLOAD_DIR, 'avatars'),
  assignments: path.join(UPLOAD_DIR, 'assignments'),
  notices: path.join(UPLOAD_DIR, 'notices'),
  messages: path.join(UPLOAD_DIR, 'messages'),
  library: path.join(UPLOAD_DIR, 'library'),
  notes: path.join(UPLOAD_DIR, 'notes'),
  resumes: path.join(UPLOAD_DIR, 'resumes'),
  temp: path.join(UPLOAD_DIR, 'temp'),
};

function ensureDirectories() {
  Object.values(dirs).forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

ensureDirectories();

async function processImage(inputBuffer, options = {}) {
  const {
    maxWidth = MAX_IMAGE_DIMENSION,
    maxHeight = MAX_IMAGE_DIMENSION,
    fit = 'inside',
    quality = JPEG_QUALITY,
    format = 'jpeg',
  } = options;

  return sharp(inputBuffer)
    .resize(maxWidth, maxHeight, { fit, withoutEnlargement: true })
    .toFormat(format, { quality })
    .toBuffer();
}

async function createAvatar(inputBuffer) {
  return sharp(inputBuffer)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
    .toFormat('jpeg', { quality: JPEG_QUALITY })
    .toBuffer();
}

function getFileUrl(filename, subdir = 'temp') {
  return `/uploads/${subdir}/${filename}`;
}

/**
 * Resolve a client supplied sub-directory to a real, allow-listed directory.
 * Anything unknown falls back to the scratch directory so a caller can never
 * escape the upload root with `../` or an absolute path.
 */
function resolveSubdir(subdir) {
  const normalized = String(subdir || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(dirs, normalized)) return dirs.temp;
  return dirs[normalized];
}

/**
 * Validate a file name before it is joined onto a directory.
 * Only a safe basename is accepted - no separators, no traversal, no null bytes.
 */
function safeFileName(filename) {
  const name = String(filename || '');
  if (!name || name.includes('\0') || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid file name');
  }
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(name)) {
    throw new Error('Invalid file name');
  }
  return name;
}

async function saveFile(buffer, subdir, filename) {
  const dir = resolveSubdir(subdir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const safeName = safeFileName(filename);
  const filePath = path.join(dir, safeName);
  // Defence in depth: the resolved path must still be inside the upload root.
  if (!path.resolve(filePath).startsWith(path.resolve(UPLOAD_DIR))) {
    throw new Error('Access denied: target path is outside upload directory');
  }
  await fs.promises.writeFile(filePath, buffer);
  return `/uploads/${path.basename(dir)}/${safeName}`;
}

async function deleteFile(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return false;
  
  // Prohibit null bytes and directory traversal sequences
  if (fileUrl.includes('\0') || fileUrl.includes('..')) {
    throw new Error('Invalid file path: path traversal sequence detected');
  }

  const relativePath = fileUrl.replace(/^\/?uploads\//, '');
  const filePath = path.resolve(UPLOAD_DIR, relativePath);

  // Strict boundary check: filePath must strictly start with UPLOAD_DIR
  if (!filePath.startsWith(UPLOAD_DIR) || filePath === UPLOAD_DIR) {
    throw new Error('Access denied: target path is outside upload directory');
  }

  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return true;
    }
  } catch (err) {
    console.error('deleteFile error:', err.message);
  }
  return false;
}

function getDir(subdir) {
  return resolveSubdir(subdir);
}

module.exports = {
  dirs,
  UPLOAD_DIR,
  processImage,
  createAvatar,
  getFileUrl,
  saveFile,
  deleteFile,
  getDir,
  ensureDirectories,
  resolveSubdir,
  safeFileName,
};
