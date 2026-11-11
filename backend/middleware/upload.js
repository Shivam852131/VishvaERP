const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { dirs } = require('../services/fileService');

/**
 * Upload hardening
 * -----------------
 * 1. The stored file extension is derived from the *server side allow-list*
 *    (keyed by MIME type), never from the client supplied file name. A file
 *    called `payload.html` uploaded with `Content-Type: text/plain` is stored
 *    as `<uuid>.txt`, so it can never be served back as active HTML/SVG/JS and
 *    cannot be used for stored XSS.
 * 2. The destination sub-directory is validated against a fixed allow-list so
 *    `subdir=../../etc` can never escape the upload root.
 * 3. Magic-byte verification for binary formats (images / PDF) blocks content
 *    spoofing (e.g. an HTML payload announced as `image/png`).
 * 4. CSV uploads are neutralised against spreadsheet formula injection
 *    (`=`, `+`, `-`, `@`, TAB, CR) so a downloaded file cannot execute
 *    formulas in Excel/LibreOffice.
 */

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

/**
 * Canonical extension per MIME type. The client never controls this mapping.
 */
const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

/** Leading bytes that a legitimate file of each binary type must start with. */
const MAGIC_BYTES = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FIELDS = 20;
const MAX_FILES = 10;
const MAX_PARTS = MAX_FILES + MAX_FIELDS;

/** Only these sub-directories may be targeted by a client. */
const ALLOWED_SUBDIRS = new Set(Object.keys(dirs));

/**
 * Resolve the target sub-directory.
 *
 * The value is resolved exactly ONCE per request and remembered, because the
 * multipart body may not have been parsed yet when the file part is handled
 * (multer processes parts in the order they appear in the form). Resolving it
 * again later - in the controller - could yield a *different* directory and
 * produce a URL that does not point at the file that was actually written.
 *
 * A query parameter (`?subdir=avatars`) is preferred because it is available
 * before the body is parsed.
 */
const pickSubdir = (req) => {
  if (req.__uploadSubdir) return req.__uploadSubdir;

  const requested = (req.query && req.query.subdir) || (req.body && req.body.subdir) || 'temp';
  const normalized = String(requested).trim().toLowerCase();
  const resolved = ALLOWED_SUBDIRS.has(normalized) ? normalized : 'temp';

  req.__uploadSubdir = resolved;
  return resolved;
};

/**
 * Parse a CSV document into rows of cells, honouring RFC4180 quoting.
 *
 * Each cell keeps track of whether it was quoted in the source document so the
 * original structure can be restored after the formula neutralisation (a field
 * such as `"Doe, John"` must not become `Doe, John`, which would shift every
 * following column).
 */
const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let wasQuoted = false;
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push({ value: field, wasQuoted });
    field = '';
    wasQuoted = false;
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      wasQuoted = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      endField();
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  endField();
  rows.push(row);

  // A trailing newline produces one spurious empty row.
  const last = rows[rows.length - 1];
  if (rows.length > 1 && last.length === 1 && last[0].value === '' && !last[0].wasQuoted) {
    rows.pop();
  }

  return rows;
};

/** Escape a single CSV cell so spreadsheet software treats it as text. */
const escapeCsvCell = (cell) => {
  const value = typeof cell === 'string' ? cell : String(cell?.value ?? '');
  const wasQuoted = typeof cell === 'object' && cell !== null && Boolean(cell.wasQuoted);

  // A leading `=`, `+`, `-`, `@`, TAB or CR would be evaluated as a formula.
  const needsFormulaEscape = /^[=+\-@\t\r]/.test(value);
  const mustQuote = wasQuoted || /[",\n\r]/.test(value);

  let out = value;
  if (needsFormulaEscape) out = `'${out}`;
  if (mustQuote) out = `"${out.replace(/"/g, '""')}"`;
  return out;
};

/**
 * Neutralise spreadsheet formula injection in a CSV buffer.
 * The document structure (quoting, delimiters) is preserved.
 */
const neutralizeCsvFormulas = (buffer) => {
  const text = buffer.toString('utf8');
  const rows = parseCsvRows(text);
  const escaped = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(','));
  // Preserve the original line ending style.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return Buffer.from(escaped.join(eol), 'utf8');
};

/**
 * Storage engine: server-controlled filename + validated destination.
 */
const storage = {
  _handleFile(req, file, cb) {
    const subdir = pickSubdir(req);
    // Remember the directory on the file object so the controller builds the
    // URL from exactly the same value that was used to write the file.
    file.__subdir = subdir;
    const dir = dirs[subdir] || dirs.temp;
    const ext = MIME_EXTENSIONS[file.mimetype] || '.bin';
    const filename = `${uuidv4()}${ext}`;
    const dest = path.join(dir, filename);

    fs.mkdir(dir, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) return cb(mkdirErr);

      const write = (payload) => {
        const out = fs.createWriteStream(dest, { flags: 'wx' });
        out.on('error', cb);
        out.on('finish', () => {
          cb(null, {
            destination: dir,
            filename,
            path: dest,
            size: payload ? payload.length : 0,
            mimetype: file.mimetype,
          });
        });
        out.end(payload);
      };

      // CSV needs to be rewritten before it touches the disk.
      if (file.mimetype === 'text/csv') {
        const chunks = [];
        let total = 0;
        file.stream.on('data', (chunk) => {
          total += chunk.length;
          if (total <= MAX_FILE_SIZE) {
            chunks.push(chunk);
          }
        });
        file.stream.on('error', cb);
        file.stream.on('end', () => {
          try {
            write(neutralizeCsvFormulas(Buffer.concat(chunks)));
          } catch (err) {
            cb(err);
          }
        });
        return;
      }

      const out = fs.createWriteStream(dest, { flags: 'wx' });
      out.on('error', cb);
      out.on('finish', () => {
        cb(null, {
          destination: dir,
          filename,
          path: dest,
          // `bytesWritten` is the authoritative byte count - attaching an extra
          // 'data' listener would switch the stream into flowing mode before
          // `pipe()` attaches and could drop the first chunk.
          size: out.bytesWritten,
          mimetype: file.mimetype,
        });
      });
      file.stream.pipe(out);
    });
  },
  _removeFile(req, file, cb) {
    if (file && file.path) {
      fs.unlink(file.path, () => cb(null));
      return;
    }
    cb(null);
  },
};

/** Verify that the uploaded bytes match the announced binary type. */
const verifyMagicBytes = (filePath, mimetype) =>
  new Promise((resolve) => {
    const expected = MAGIC_BYTES[mimetype];
    if (!expected) return resolve(true);

    fs.open(filePath, 'r', (err, fd) => {
      if (err) return resolve(false);
      const buffer = Buffer.alloc(expected.length);
      fs.read(fd, buffer, 0, expected.length, 0, (readErr, bytesRead) => {
        fs.close(fd, () => {
          if (readErr || bytesRead < expected.length) return resolve(false);
          return resolve(expected.every((byte, index) => buffer[index] === byte));
        });
      });
    });
  });

function fileFilter(allowed) {
  return (req, file, cb) => {
    if (!allowed.includes(file.mimetype)) {
      cb(new Error(`File type ${file.mimetype} is not allowed. Allowed: ${allowed.join(', ')}`), false);
      return;
    }
    cb(null, true);
  };
}

const limits = {
  fileSize: MAX_FILE_SIZE,
  files: MAX_FILES,
  fields: MAX_FIELDS,
  parts: MAX_PARTS,
};

const uploadImage = multer({ storage, limits, fileFilter: fileFilter(ALLOWED_IMAGES) });
const uploadDocument = multer({ storage, limits, fileFilter: fileFilter(ALLOWED_DOCUMENTS) });
const uploadAny = multer({ storage, limits, fileFilter: fileFilter(ALLOWED_ALL) });

function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum size is 10MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_PART_COUNT') {
      return res.status(400).json({ success: false, message: 'Too many files uploaded.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
}

/**
 * Accept a single file sent under any of the well-known field names.
 *
 * Different clients in this codebase post the file as `file`, `image` or
 * `photo`. Multer's `.single('file')` silently ignores a mismatching field
 * name, which produced "No file uploaded" errors for some callers.
 */
const singleUpload = (uploader, maxCount = 1) => {
  const fields = ['file', 'image', 'photo', 'document'].map((name) => ({ name, maxCount }));
  const handler = uploader.fields(fields);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (err) return next(err);
      if (req.files && !req.file) {
        const first = Object.values(req.files).find((group) => group && group.length);
        if (first) req.file = first[0];
      }
      next();
    });
  };
};

/**
 * Accept several files sent under any of the well-known field names and
 * normalise them into the `req.files` array the controller expects.
 */
const arrayUpload = (uploader, names = ['files', 'file', 'images'], maxCount = 10) => {
  const fields = names.map((name) => ({ name, maxCount }));
  const handler = uploader.fields(fields);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (err) return next(err);
      if (req.files && !Array.isArray(req.files)) {
        const merged = [];
        Object.values(req.files).forEach((group) => {
          if (Array.isArray(group)) merged.push(...group);
        });
        req.files = merged;
      }
      next();
    });
  };
};

module.exports = {
  uploadImage,
  uploadDocument,
  uploadAny,
  singleUpload,
  arrayUpload,
  handleMulterError,
  verifyMagicBytes,
  pickSubdir,
  neutralizeCsvFormulas,
  ALLOWED_IMAGES,
  ALLOWED_DOCUMENTS,
  MIME_EXTENSIONS,
  MAX_FILE_SIZE,
};
