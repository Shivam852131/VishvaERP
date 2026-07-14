const asyncHandler = require('../middleware/asyncHandler');
const Note = require('../models/Note');
const Subject = require('../models/Subject');
const Course = require('../models/Course');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');
const { deleteFile } = require('../services/fileService');

const getNotes = asyncHandler(async (req, res) => {
  const { subjectId, courseId, semester, search, sort = 'newest', page = 1, limit = 20 } = req.query;
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

  let sortObj = { createdAt: -1 };
  if (sort === 'popular') sortObj = { voteScore: -1, downloads: -1 };
  else if (sort === 'top_rated') sortObj = { avgRating: -1, ratingCount: -1 };
  else if (sort === 'most_bookmarked') sortObj = { bookmarkCount: -1 };
  else if (sort === 'most_commented') sortObj = { commentCount: -1 };

  const skip = (Number(page) - 1) * Number(limit);
  const [notes, total] = await Promise.all([
    Note.find(query)
      .populate('uploadedBy', 'name role avatar')
      .populate('subjectId', 'name code')
      .populate('courseId', 'name code')
      .sort(sortObj)
      .skip(skip)
      .limit(Number(limit)),
    Note.countDocuments(query),
  ]);

  const enriched = notes.map(n => {
    const obj = n.toObject();
    obj.hasUpvoted = n.upvotes.some(id => id.toString() === req.user._id.toString());
    obj.hasDownvoted = n.downvotes.some(id => id.toString() === req.user._id.toString());
    obj.hasBookmarked = n.bookmarks.some(id => id.toString() === req.user._id.toString());
    obj.myRating = (n.ratings.find(r => r.userId.toString() === req.user._id.toString()) || {}).score || 0;
    obj.comments = (n.comments || []).filter(c => !c.isDeleted).map(c => ({
      ...c,
      hasUpvoted: (c.upvotes || []).some(id => id.toString() === req.user._id.toString()),
      upvoteCount: (c.upvotes || []).length,
      isOwner: c.userId.toString() === req.user._id.toString(),
    }));
    return obj;
  });

  res.json({
    success: true,
    notes: enriched,
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

const toggleVote = asyncHandler(async (req, res) => {
  const { type } = req.body;
  if (!['upvote', 'downvote'].includes(type)) {
    return res.status(400).json({ success: false, message: 'type must be upvote or downvote' });
  }

  const note = await Note.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

  const uid = req.user._id;
  const hadUpvoted = note.upvotes.some(id => id.toString() === uid.toString());
  const hadDownvoted = note.downvotes.some(id => id.toString() === uid.toString());

  if (type === 'upvote') {
    if (hadUpvoted) {
      note.upvotes = note.upvotes.filter(id => id.toString() !== uid.toString());
    } else {
      note.upvotes.push(uid);
      note.downvotes = note.downvotes.filter(id => id.toString() !== uid.toString());
    }
  } else {
    if (hadDownvoted) {
      note.downvotes = note.downvotes.filter(id => id.toString() !== uid.toString());
    } else {
      note.downvotes.push(uid);
      note.upvotes = note.upvotes.filter(id => id.toString() !== uid.toString());
    }
  }

  await note.save();
  res.json({ success: true, voteScore: note.voteScore, hasUpvoted: type === 'upvote' && !hadUpvoted, hasDownvoted: type === 'downvote' && !hadDownvoted });
});

const toggleBookmark = asyncHandler(async (req, res) => {
  const note = await Note.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

  const uid = req.user._id;
  const hadBookmarked = note.bookmarks.some(id => id.toString() === uid.toString());

  if (hadBookmarked) {
    note.bookmarks = note.bookmarks.filter(id => id.toString() !== uid.toString());
  } else {
    note.bookmarks.push(uid);
  }

  await note.save();
  res.json({ success: true, bookmarkCount: note.bookmarkCount, hasBookmarked: !hadBookmarked });
});

const rateNote = asyncHandler(async (req, res) => {
  const { score } = req.body;
  if (!score || score < 1 || score > 5) {
    return res.status(400).json({ success: false, message: 'Score must be between 1 and 5' });
  }

  const note = await Note.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

  const uid = req.user._id;
  const existing = note.ratings.find(r => r.userId.toString() === uid.toString());

  if (existing) {
    existing.score = score;
  } else {
    note.ratings.push({ userId: uid, score });
  }

  await note.save();
  res.json({ success: true, avgRating: note.avgRating, ratingCount: note.ratingCount });
});

const addComment = asyncHandler(async (req, res) => {
  const { text, parentCommentId } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, message: 'Comment text is required' });
  }

  const note = await Note.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

  if (parentCommentId) {
    const parent = note.comments.id(parentCommentId);
    if (!parent) return res.status(404).json({ success: false, message: 'Parent comment not found' });
  }

  const comment = {
    userId: req.user._id,
    text: text.trim(),
    parentCommentId: parentCommentId || undefined,
    upvotes: [],
    isEdited: false,
    isDeleted: false,
  };

  note.comments.push(comment);
  await note.save();

  const newComment = note.comments[note.comments.length - 1];
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    userIds: [String(note.uploadedBy)],
    resource: 'notes',
    action: 'commented',
  });

  res.status(201).json({ success: true, comment: { ...newComment.toObject(), upvoteCount: 0, hasUpvoted: false, isOwner: true }, commentCount: note.commentCount });
});

const updateComment = asyncHandler(async (req, res) => {
  const { commentId, text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, message: 'Comment text is required' });
  }

  const note = await Note.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

  const comment = note.comments.id(commentId);
  if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

  if (comment.userId.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'You can only edit your own comments' });
  }

  comment.text = text.trim();
  comment.isEdited = true;
  await note.save();

  res.json({ success: true, comment });
});

const deleteComment = asyncHandler(async (req, res) => {
  const { commentId } = req.body;

  const note = await Note.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

  const comment = note.comments.id(commentId);
  if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

  const isOwner = comment.userId.toString() === req.user._id.toString();
  const isOwnerOfNote = note.uploadedBy.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'collegeAdmin';
  if (!isOwner && !isOwnerOfNote && !isAdmin) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  if ((comment.comments || []).length > 0) {
    comment.isDeleted = true;
    comment.text = '[deleted]';
  } else {
    note.comments = note.comments.filter(c => c._id.toString() !== commentId);
  }

  await note.save();
  res.json({ success: true, commentCount: note.commentCount });
});

const voteComment = asyncHandler(async (req, res) => {
  const { commentId } = req.body;

  const note = await Note.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

  const comment = note.comments.id(commentId);
  if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

  const uid = req.user._id;
  const hadVoted = (comment.upvotes || []).some(id => id.toString() === uid.toString());

  if (hadVoted) {
    comment.upvotes = comment.upvotes.filter(id => id.toString() !== uid.toString());
  } else {
    comment.upvotes = comment.upvotes || [];
    comment.upvotes.push(uid);
  }

  await note.save();
  res.json({ success: true, upvoteCount: (comment.upvotes || []).length, hasUpvoted: !hadVoted });
});

module.exports = {
  getNotes, createNote, deleteNote, incrementDownload,
  toggleVote, toggleBookmark, rateNote,
  addComment, updateComment, deleteComment, voteComment,
};
