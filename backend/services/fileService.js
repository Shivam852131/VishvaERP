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

async function saveFile(buffer, subdir, filename) {
  const dir = dirs[subdir] || dirs.temp;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, filename);
  await fs.promises.writeFile(filePath, buffer);
  return `/uploads/${subdir}/${filename}`;
}

async function deleteFile(fileUrl) {
  if (!fileUrl) return;
  const relativePath = fileUrl.replace(/^\/uploads\//, '');
  const filePath = path.join(UPLOAD_DIR, relativePath);
  try {
    await fs.promises.unlink(filePath);
  } catch {
  }
}

function getDir(subdir) {
  return dirs[subdir] || dirs.temp;
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
};
