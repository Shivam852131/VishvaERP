const asyncHandler = require('../middleware/asyncHandler');
const Note = require('../models/Note');
const Subject = require('../models/Subject');
const Course = require('../models/Course');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');
const { deleteFile } = require('../services/fileService');

const getNotes = asyncHandler(async (req, res) => {
  const { subjectId, courseId, semester, search, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };

  if (subjectId) query.subjectId = subjectId;
  if (courseId) query.courseId = courseId;
  if (semester) query.semester = Number(semester);

  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [notes, total] = await Promise.all([
    Note.find(query)
      .populate('uploadedBy', 'name role avatar')
      .populate('subjectId', 'name code')
      .populate('courseId', 'name code')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Note.countDocuments(query),
  ]);

  res.json({
    success: true,
    notes,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

const createNote = asyncHandler(async (req, res) => {
  const { title, description, subjectId, courseId, semester, department, tags } = req.body;

  if (!title || !subjectId || !courseId || !semester) {
    return res.status(400).json({ success: false, message: 'title, subjectId, courseId, and semester are required' });
  }

  const [subject, course] = await Promise.all([
    Subject.findOne({ _id: subjectId, collegeId: req.user.collegeId }),
    Course.findOne({ _id: courseId, collegeId: req.user.collegeId }),
  ]);

  if (!subject) return res.status(400).json({ success: false, message: 'Invalid subject for this college' });
  if (!course) return res.status(400).json({ success: false, message: 'Invalid course for this college' });

  const attachments = (req.files || []).map(f => `/uploads/notes/${f.filename}`);

  const parsedTags = tags
    ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : tags)
    : [];

  const note = await Note.create({
    collegeId: req.user.collegeId,
    uploadedBy: req.user._id,
    title,
    description,
    subjectId,
    courseId,
    semester: Number(semester),
    department: department || course.department,
    attachments,
    tags: parsedTags,
  });

  logAudit(req, 'create', 'note', { resourceId: note._id, description: `Uploaded note: ${note.title}` });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['student', 'faculty', 'collegeAdmin'],
    resource: 'notes',
    action: 'created',
  });

  const populated = await note.populate([
    { path: 'uploadedBy', select: 'name role avatar' },
    { path: 'subjectId', select: 'name code' },
    { path: 'courseId', select: 'name code' },
  ]);

  res.status(201).json({ success: true, note: populated });
});

const deleteNote = asyncHandler(async (req, res) => {
  const note = await Note.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

  const isOwner = note.uploadedBy.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'collegeAdmin';
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, message: 'You can only delete your own notes' });
  }

  if (note.attachments && note.attachments.length) {
    await Promise.all(note.attachments.map(url => deleteFile(url)));
  }

  await note.deleteOne();

  logAudit(req, 'delete', 'note', { resourceId: note._id, description: `Deleted note: ${note.title}` });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['student', 'faculty', 'collegeAdmin'],
    resource: 'notes',
    action: 'deleted',
  });

  res.json({ success: true, message: 'Note deleted' });
});

const incrementDownload = asyncHandler(async (req, res) => {
  const note = await Note.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId, isActive: true },
    { $inc: { downloads: 1 } },
    { new: true }
  );
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
  res.json({ success: true, downloads: note.downloads });
});

module.exports = { getNotes, createNote, deleteNote, incrementDownload };
