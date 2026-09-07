const asyncHandler = require('../middleware/asyncHandler');
const LiveClassSession = require('../models/LiveClassSession');
const Subject = require('../models/Subject');
const User = require('../models/User');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

function buildRoomName(subject, date = new Date()) {
  const datePart = date.toISOString().split('T')[0];
  const timePart = `${date.getHours()}${date.getMinutes()}${date.getSeconds()}`;
  const code = String(subject.code || subject.name || 'class')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `VishvaErp-${code}-${datePart}-${timePart}`;
}

async function getStudentContext(user) {
  if (user.role === 'student') {
    return user;
  }

  if (user.role !== 'parent') {
    return null;
  }

  const parent = await User.findById(user._id).populate('children', 'department semester collegeId');
  return parent?.children?.[0] || null;
}

const listLiveClasses = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };

  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  } else if (req.user.role === 'student' || req.user.role === 'parent') {
    const student = await getStudentContext(req.user);
    if (!student) {
      return res.json({ success: true, sessions: [] });
    }

    query.department = student.department;
    query.semester = student.semester;
    query.status = { $in: ['scheduled', 'active'] };
  }

  if (req.query.status) {
    query.status = req.query.status;
  }

  const sessions = await LiveClassSession.find(query)
    .populate('facultyId', 'name email designation')
    .populate('subjectId', 'name code semester')
    .populate('courseId', 'name code department')
    .sort({ startedAt: -1, createdAt: -1 })
    .limit(20);

  res.json({ success: true, sessions });
});

const startLiveClass = asyncHandler(async (req, res) => {
  const subject = await Subject.findOne({
    _id: req.body.subjectId,
    collegeId: req.user.collegeId,
    facultyId: req.user._id,
  }).populate('courseId', 'department');

  if (!subject) {
    return res.status(400).json({ success: false, message: 'Assigned subject is required' });
  }

  await LiveClassSession.updateMany(
    { collegeId: req.user.collegeId, facultyId: req.user._id, subjectId: subject._id, status: 'active' },
    { status: 'ended', endedAt: new Date() }
  );

  const roomName = req.body.roomName || buildRoomName(subject);
  const title = req.body.title?.trim() || `${subject.name} Live Session`;

  const session = await LiveClassSession.create({
    collegeId: req.user.collegeId,
    facultyId: req.user._id,
    subjectId: subject._id,
    courseId: subject.courseId?._id || subject.courseId,
    semester: subject.semester,
    department: subject.courseId?.department || req.body.department || 'General',
    title,
    roomName,
    status: 'active',
    startedAt: new Date(),
  });

  const populated = await session.populate([
    { path: 'facultyId', select: 'name email designation' },
    { path: 'subjectId', select: 'name code semester' },
    { path: 'courseId', select: 'name code department' },
  ]);

  logAudit(req, 'create', 'live_class', { resourceId: session._id, description: `Started live class: ${title}`, metadata: { subjectId: subject._id } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'live-classes',
    action: 'started',
  });

  res.status(201).json({ success: true, session: populated });
});

const endLiveClass = asyncHandler(async (req, res) => {
  const session = await LiveClassSession.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
    facultyId: req.user._id,
  });

  if (!session) {
    return res.status(404).json({ success: false, message: 'Live session not found' });
  }

  session.status = 'ended';
  session.endedAt = new Date();
  await session.save();
  logAudit(req, 'update', 'live_class', { resourceId: session._id, description: `Ended live class: ${session.title}`, metadata: { subjectId: session.subjectId } });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'live-classes',
    action: 'ended',
  });

  res.json({ success: true, session });
});

module.exports = {
  listLiveClasses,
  startLiveClass,
  endLiveClass,
};
