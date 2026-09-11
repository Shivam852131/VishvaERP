const asyncHandler = require('../middleware/asyncHandler');
const LiveClassSession = require('../models/LiveClassSession');
const Subject = require('../models/Subject');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
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

  const parent = await User.findById(user._id).populate('children', 'department semester collegeId name rollNo');
  return parent?.children?.[0] || null;
}

// @desc    List live class sessions (active, scheduled, or past)
// @route   GET /api/live-classes
// @access  Private (All roles)
const listLiveClasses = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };

  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  } else if (req.user.role === 'student' || req.user.role === 'parent') {
    const student = await getStudentContext(req.user);
    if (!student) {
      return res.json({ success: true, sessions: [], count: 0 });
    }

    query.department = student.department;
    query.semester = student.semester;
  }

  if (req.query.status && req.query.status !== 'all') {
    query.status = req.query.status;
  } else if (!req.query.status && (req.user.role === 'student' || req.user.role === 'parent')) {
    query.status = { $in: ['active', 'scheduled', 'ended'] };
  }

  if (req.query.subjectId) {
    query.subjectId = req.query.subjectId;
  }

  const sessions = await LiveClassSession.find(query)
    .populate('facultyId', 'name email designation department')
    .populate('subjectId', 'name code semester')
    .populate('courseId', 'name code department')
    .sort({ startedAt: -1, createdAt: -1 })
    .limit(50);

  // Augment with attendee count for lightweight response
  const sanitized = sessions.map(s => {
    const obj = s.toObject();
    obj.attendeesCount = obj.attendees ? obj.attendees.length : 0;
    obj.materialsCount = obj.materials ? obj.materials.length : 0;
    return obj;
  });

  res.json({ success: true, sessions: sanitized, count: sanitized.length });
});

// @desc    Get detailed live class session by ID
// @route   GET /api/live-classes/:id
// @access  Private (All roles)
const getLiveClassDetails = asyncHandler(async (req, res) => {
  const session = await LiveClassSession.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  })
    .populate('facultyId', 'name email designation department')
    .populate('subjectId', 'name code semester')
    .populate('courseId', 'name code department')
    .populate('attendees.studentId', 'name rollNo email avatar');

  if (!session) {
    return res.status(404).json({ success: false, message: 'Live class session not found' });
  }

  res.json({ success: true, session });
});

// @desc    Start or Schedule a Live Class
// @route   POST /api/live-classes
// @access  Private (Faculty, CollegeAdmin)
const startLiveClass = asyncHandler(async (req, res) => {
  const subjectQuery = {
    _id: req.body.subjectId,
    collegeId: req.user.collegeId,
  };
  if (req.user.role === 'faculty') {
    subjectQuery.facultyId = req.user._id;
  }

  const subject = await Subject.findOne(subjectQuery).populate('courseId', 'department');
  if (!subject) {
    return res.status(400).json({ success: false, message: 'Valid assigned subject is required' });
  }

  const isScheduled = req.body.status === 'scheduled' || Boolean(req.body.scheduledStartTime && new Date(req.body.scheduledStartTime) > new Date());
  const status = isScheduled ? 'scheduled' : 'active';

  // If launching active immediately, conclude existing active sessions for this subject/faculty
  if (status === 'active') {
    await LiveClassSession.updateMany(
      { collegeId: req.user.collegeId, facultyId: req.user._id, subjectId: subject._id, status: 'active' },
      { status: 'ended', endedAt: new Date() }
    );
  }

  const roomName = req.body.roomName?.trim() || buildRoomName(subject);
  const title = req.body.title?.trim() || `${subject.name} - Lecture Session`;
  const description = req.body.description?.trim() || '';

  const session = await LiveClassSession.create({
    collegeId: req.user.collegeId,
    facultyId: req.user._id,
    subjectId: subject._id,
    courseId: subject.courseId?._id || subject.courseId,
    semester: subject.semester,
    department: subject.courseId?.department || req.body.department || 'General',
    title,
    description,
    roomName,
    status,
    scheduledStartTime: req.body.scheduledStartTime ? new Date(req.body.scheduledStartTime) : undefined,
    startedAt: status === 'active' ? new Date() : undefined,
    tags: Array.isArray(req.body.tags) ? req.body.tags : [],
  });

  const populated = await session.populate([
    { path: 'facultyId', select: 'name email designation department' },
    { path: 'subjectId', select: 'name code semester' },
    { path: 'courseId', select: 'name code department' },
  ]);

  logAudit(req, 'create', 'live_class', {
    resourceId: session._id,
    description: `${status === 'active' ? 'Started' : 'Scheduled'} live class: ${title}`,
    metadata: { subjectId: subject._id, roomName },
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['faculty', 'student', 'collegeAdmin'],
    resource: 'live-classes',
    action: status === 'active' ? 'started' : 'scheduled',
  });

  res.status(201).json({ success: true, session: populated });
});

// @desc    End an active live class session
// @route   PUT /api/live-classes/:id/end
// @access  Private (Faculty, CollegeAdmin)
const endLiveClass = asyncHandler(async (req, res) => {
  const query = {
    _id: req.params.id,
    collegeId: req.user.collegeId,
  };
  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  }

  const session = await LiveClassSession.findOne(query);
  if (!session) {
    return res.status(404).json({ success: false, message: 'Live session not found' });
  }

  const now = new Date();
  session.status = 'ended';
  session.endedAt = now;

  // Finalize any currently open attendee durations
  if (session.attendees && session.attendees.length > 0) {
    session.attendees.forEach(att => {
      if (!att.leftAt) {
        att.leftAt = now;
        const joined = new Date(att.joinedAt || session.startedAt || now);
        att.durationMinutes = Math.max(1, Math.round((now - joined) / 60000));
      }
    });
  }

  await session.save();

  logAudit(req, 'update', 'live_class', {
    resourceId: session._id,
    description: `Ended live class: ${session.title}`,
    metadata: { subjectId: session.subjectId, attendeeCount: session.attendees.length },
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['faculty', 'student', 'collegeAdmin'],
    resource: 'live-classes',
    action: 'ended',
  });

  res.json({ success: true, session });
});

// @desc    Student joins live class session (logs presence)
// @route   POST /api/live-classes/:id/join
// @access  Private (Student, Faculty)
const joinLiveClass = asyncHandler(async (req, res) => {
  const session = await LiveClassSession.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
    status: 'active',
  });

  if (!session) {
    return res.status(404).json({ success: false, message: 'Active live class session not found' });
  }

  const now = new Date();
  let attendee = session.attendees.find(a => String(a.studentId) === String(req.user._id));

  if (!attendee) {
    session.attendees.push({
      studentId: req.user._id,
      name: req.user.name || 'Student',
      rollNumber: req.user.rollNo || '',
      joinedAt: now,
      leftAt: null,
      durationMinutes: 0,
      handRaised: false,
    });
    attendee = session.attendees[session.attendees.length - 1];
  } else {
    // Re-joining student
    attendee.leftAt = null;
    if (!attendee.joinedAt) attendee.joinedAt = now;
  }

  await session.save();

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['faculty'],
    resource: 'live-classes',
    action: 'participant-joined',
  });

  res.json({
    success: true,
    message: 'Joined live class session',
    attendee,
    roomName: session.roomName,
    title: session.title,
  });
});

// @desc    Student leaves live class session (records exit & duration)
// @route   POST /api/live-classes/:id/leave
// @access  Private (Student, Faculty)
const leaveLiveClass = asyncHandler(async (req, res) => {
  const session = await LiveClassSession.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });

  if (!session) {
    return res.status(404).json({ success: false, message: 'Live class session not found' });
  }

  const now = new Date();
  const attendee = session.attendees.find(a => String(a.studentId) === String(req.user._id));

  if (attendee) {
    attendee.leftAt = now;
    const joined = new Date(attendee.joinedAt || now);
    attendee.durationMinutes = Math.max(1, Math.round((now - joined) / 60000));
    await session.save();
  }

  res.json({ success: true, message: 'Left live class session', attendee });
});

// @desc    Toggle raise hand status
// @route   POST /api/live-classes/:id/raise-hand
// @access  Private (Student)
const raiseHand = asyncHandler(async (req, res) => {
  const session = await LiveClassSession.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
    status: 'active',
  });

  if (!session) {
    return res.status(404).json({ success: false, message: 'Active live class session not found' });
  }

  const attendee = session.attendees.find(a => String(a.studentId) === String(req.user._id));
  if (!attendee) {
    return res.status(400).json({ success: false, message: 'You must join the class first' });
  }

  attendee.handRaised = !attendee.handRaised;
  await session.save();

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['faculty'],
    resource: 'live-classes',
    action: 'hand-raised',
  });

  res.json({ success: true, handRaised: attendee.handRaised });
});

// @desc    Sync session participants to official ERP attendance
// @route   POST /api/live-classes/:id/sync-attendance
// @access  Private (Faculty, CollegeAdmin)
const syncAttendance = asyncHandler(async (req, res) => {
  const query = {
    _id: req.params.id,
    collegeId: req.user.collegeId,
  };
  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  }

  const session = await LiveClassSession.findOne(query).populate('subjectId');
  if (!session) {
    return res.status(404).json({ success: false, message: 'Live class session not found' });
  }

  // Calculate session duration
  const startTime = session.startedAt || session.createdAt;
  const endTime = session.endedAt || new Date();
  const sessionTotalMinutes = Math.max(10, Math.round((endTime - startTime) / 60000));

  // Minimum duration to qualify for present status (default 40% of class or specified in body)
  const minDuration = Number(req.body.minDurationMinutes) || Math.max(5, Math.round(sessionTotalMinutes * 0.4));

  // Find all students enrolled in this batch (matching college, department, semester)
  const enrolledStudents = await User.find({
    collegeId: req.user.collegeId,
    role: 'student',
    department: session.department,
    semester: session.semester,
    isActive: true,
  }).select('_id name rollNo email');

  const attendeeMap = new Map();
  (session.attendees || []).forEach(att => {
    // If attendee is still active in class, update duration
    const duration = att.durationMinutes || (att.leftAt ? Math.round((new Date(att.leftAt) - new Date(att.joinedAt)) / 60000) : Math.round((new Date() - new Date(att.joinedAt)) / 60000));
    attendeeMap.set(String(att.studentId), Math.max(1, duration));
  });

  const sessionDate = new Date(startTime);
  sessionDate.setHours(0, 0, 0, 0);

  let presentCount = 0;
  let absentCount = 0;

  for (const student of enrolledStudents) {
    const studentIdStr = String(student._id);
    const attendedMinutes = attendeeMap.get(studentIdStr) || 0;
    const isPresent = attendedMinutes >= minDuration;

    const status = isPresent ? 'present' : 'absent';
    if (isPresent) presentCount++;
    else absentCount++;

    await Attendance.findOneAndUpdate(
      {
        collegeId: req.user.collegeId,
        studentId: student._id,
        subjectId: session.subjectId._id || session.subjectId,
        date: sessionDate,
      },
      {
        $set: {
          facultyId: session.facultyId,
          status,
          source: 'live-class',
          verificationMethod: 'live-class',
          remarks: isPresent
            ? `Attended Live Classroom (${attendedMinutes} mins / ${sessionTotalMinutes} mins)`
            : `Absent from Live Classroom (Attended ${attendedMinutes} mins, min required ${minDuration} mins)`,
          lastSeenAt: isPresent ? new Date() : undefined,
          confidence: isPresent ? 95 : 0,
        },
        $setOnInsert: {
          firstSeenAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  session.attendanceSynced = true;
  session.syncedAttendanceCount = presentCount;
  session.syncedAt = new Date();
  await session.save();

  logAudit(req, 'create', 'attendance', {
    resourceId: session._id,
    description: `Synced live class attendance for ${session.title}: ${presentCount} present, ${absentCount} absent`,
    metadata: { subjectId: session.subjectId._id, presentCount, absentCount },
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['faculty', 'student', 'parent', 'collegeAdmin'],
    resource: 'attendance',
    action: 'synced-from-live-class',
  });

  res.json({
    success: true,
    message: `Attendance synchronized successfully: ${presentCount} marked present, ${absentCount} absent.`,
    presentCount,
    absentCount,
    totalEnrolled: enrolledStudents.length,
    minDurationRequired: minDuration,
  });
});

// @desc    Save whiteboard drawing / snapshot
// @route   POST /api/live-classes/:id/whiteboard
// @access  Private (Faculty, CollegeAdmin)
const saveWhiteboard = asyncHandler(async (req, res) => {
  const session = await LiveClassSession.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });

  if (!session) {
    return res.status(404).json({ success: false, message: 'Live class session not found' });
  }

  session.whiteboardData = req.body.whiteboardData || '';
  await session.save();

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['student'],
    resource: 'live-classes',
    action: 'whiteboard-updated',
  });

  res.json({ success: true, message: 'Whiteboard data saved' });
});

// @desc    Post in-class chat message
// @route   POST /api/live-classes/:id/chat
// @access  Private (All roles)
const postChatMessage = asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Message content is required' });
  }

  const session = await LiveClassSession.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });

  if (!session) {
    return res.status(404).json({ success: false, message: 'Live class session not found' });
  }

  const chatEntry = {
    senderId: req.user._id,
    senderName: req.user.name || 'User',
    role: req.user.role || 'student',
    message: message.trim(),
    timestamp: new Date(),
  };

  session.chatMessages.push(chatEntry);
  if (session.chatMessages.length > 200) {
    session.chatMessages = session.chatMessages.slice(-200);
  }

  await session.save();

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['faculty', 'student'],
    resource: 'live-classes',
    action: 'chat-message',
  });

  res.status(201).json({ success: true, chatEntry });
});

// @desc    Create poll or cast vote
// @route   POST /api/live-classes/:id/poll
// @access  Private (Faculty creates, Students vote)
const createOrVotePoll = asyncHandler(async (req, res) => {
  const session = await LiveClassSession.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });

  if (!session) {
    return res.status(404).json({ success: false, message: 'Live class session not found' });
  }

  // Faculty launches new poll
  if (req.user.role === 'faculty' || req.user.role === 'collegeAdmin') {
    if (req.body.action === 'close') {
      if (session.activePoll) {
        session.activePoll.isOpen = false;
        await session.save();
      }
      return res.json({ success: true, message: 'Poll closed', poll: session.activePoll });
    }

    const { question, options } = req.body;
    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ success: false, message: 'Question and at least 2 options required' });
    }

    session.activePoll = {
      question: question.trim(),
      options: options.map((opt, idx) => ({
        id: `opt_${idx + 1}`,
        text: String(opt).trim(),
        votes: 0,
      })),
      isOpen: true,
      createdAt: new Date(),
      voters: [],
    };

    await session.save();

    emitDataChange(req, {
      collegeId: String(req.user.collegeId),
      roles: ['student'],
      resource: 'live-classes',
      action: 'poll-created',
    });

    return res.status(201).json({ success: true, poll: session.activePoll });
  }

  // Student voting
  if (!session.activePoll || !session.activePoll.isOpen) {
    return res.status(400).json({ success: false, message: 'No open poll available to vote' });
  }

  const hasVoted = session.activePoll.voters.some(vId => String(vId) === String(req.user._id));
  if (hasVoted) {
    return res.status(400).json({ success: false, message: 'You have already voted in this poll' });
  }

  const option = session.activePoll.options.find(o => o.id === req.body.optionId);
  if (!option) {
    return res.status(400).json({ success: false, message: 'Invalid option selected' });
  }

  option.votes = (option.votes || 0) + 1;
  session.activePoll.voters.push(req.user._id);
  await session.save();

  res.json({ success: true, message: 'Vote recorded', poll: session.activePoll });
});

// @desc    Update recording URL and notes
// @route   POST /api/live-classes/:id/recording
// @access  Private (Faculty, CollegeAdmin)
const updateRecording = asyncHandler(async (req, res) => {
  const query = {
    _id: req.params.id,
    collegeId: req.user.collegeId,
  };
  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  }

  const session = await LiveClassSession.findOne(query);
  if (!session) {
    return res.status(404).json({ success: false, message: 'Live class session not found' });
  }

  if (req.body.recordingUrl !== undefined) session.recordingUrl = req.body.recordingUrl.trim();
  if (req.body.recordingDuration !== undefined) session.recordingDuration = Number(req.body.recordingDuration) || 0;
  if (req.body.description !== undefined) session.description = req.body.description.trim();

  await session.save();

  res.json({ success: true, message: 'Recording details updated', session });
});

// @desc    Add study material / lecture notes
// @route   POST /api/live-classes/:id/materials
// @access  Private (Faculty, CollegeAdmin)
const addMaterial = asyncHandler(async (req, res) => {
  const query = {
    _id: req.params.id,
    collegeId: req.user.collegeId,
  };
  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  }

  const session = await LiveClassSession.findOne(query);
  if (!session) {
    return res.status(404).json({ success: false, message: 'Live class session not found' });
  }

  const { title, url, type = 'link', size = '' } = req.body;
  if (!title || !url) {
    return res.status(400).json({ success: false, message: 'Title and URL are required' });
  }

  session.materials.push({
    title: title.trim(),
    url: url.trim(),
    type,
    size,
    uploadedAt: new Date(),
  });

  await session.save();

  res.status(201).json({ success: true, materials: session.materials });
});

// @desc    List recorded lectures archive for revision
// @route   GET /api/live-classes/recordings
// @access  Private (All roles)
const listRecordings = asyncHandler(async (req, res) => {
  const query = {
    collegeId: req.user.collegeId,
    $or: [
      { recordingUrl: { $exists: true, $ne: '' } },
      { 'materials.0': { $exists: true } },
      { whiteboardData: { $exists: true, $ne: '' } },
    ],
  };

  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  } else if (req.user.role === 'student' || req.user.role === 'parent') {
    const student = await getStudentContext(req.user);
    if (student) {
      query.department = student.department;
      query.semester = student.semester;
    }
  }

  const recordings = await LiveClassSession.find(query)
    .populate('facultyId', 'name email designation')
    .populate('subjectId', 'name code semester')
    .sort({ endedAt: -1, createdAt: -1 })
    .limit(50);

  res.json({ success: true, recordings, count: recordings.length });
});

module.exports = {
  listLiveClasses,
  getLiveClassDetails,
  startLiveClass,
  endLiveClass,
  joinLiveClass,
  leaveLiveClass,
  raiseHand,
  syncAttendance,
  saveWhiteboard,
  postChatMessage,
  createOrVotePoll,
  updateRecording,
  addMaterial,
  listRecordings,
};
