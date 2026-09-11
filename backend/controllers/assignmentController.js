const asyncHandler = require('../middleware/asyncHandler');
const { Assignment, Submission } = require('../models/Assignment');
const Subject = require('../models/Subject');
const Course = require('../models/Course');
const User = require('../models/User');
const { Notification } = require('../models/Communication');
const { emitDataChange } = require('../utils/realtime');
const { parseSemester } = require('../utils/parseHelpers');
const { logAudit } = require('../services/auditService');

/**
 * Helper: Resolve subject by ID or name
 */
async function resolveSubject(collegeId, payload) {
  if (payload.subjectId) {
    return Subject.findOne({ _id: payload.subjectId, collegeId });
  }

  const search = payload.subject || payload.subjectName;
  if (!search) return null;

  return Subject.findOne({
    collegeId,
    $or: [
      { name: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } },
    ],
    ...(parseSemester(payload.semester || payload.batch) ? { semester: parseSemester(payload.semester || payload.batch) } : {}),
  });
}

// @desc    Create new assignment
// @route   POST /api/assignments
// @access  Faculty, CollegeAdmin
const createAssignment = asyncHandler(async (req, res) => {
  const { title, description, dueDate, totalMarks, maxMarks, attachments, isPublished, batch } = req.body;

  if (!title || !dueDate) {
    return res.status(400).json({ success: false, message: 'Assignment title and due date are required' });
  }

  const subject = await resolveSubject(req.user.collegeId, req.body);
  const subjectId = subject?._id || req.body.subjectId;
  const courseId = subject?.courseId || req.body.courseId;
  const semester = parseSemester(req.body.semester || batch) || subject?.semester || 1;

  if (!subjectId) {
    return res.status(400).json({ success: false, message: 'A valid subject is required for creating an assignment' });
  }

  // Parse attachments
  let attachmentList = [];
  if (Array.isArray(attachments)) {
    attachmentList = attachments.filter(Boolean);
  } else if (typeof attachments === 'string' && attachments.trim()) {
    attachmentList = [attachments.trim()];
  } else if (req.body.fileUrl) {
    attachmentList = [req.body.fileUrl];
  }

  const assignment = await Assignment.create({
    collegeId: req.user.collegeId,
    subjectId,
    facultyId: req.user._id,
    courseId: courseId || subject?.courseId,
    semester,
    title: title.trim(),
    description: description || '',
    dueDate: new Date(dueDate),
    totalMarks: Number(totalMarks || maxMarks || 20),
    attachments: attachmentList,
    isPublished: isPublished !== undefined ? isPublished : true,
  });

  // Notify students in that semester
  const students = await User.find({
    collegeId: req.user.collegeId,
    role: 'student',
    isActive: true,
    semester,
  }).select('_id').lean();

  if (students.length > 0) {
    const studentIds = students.map((s) => s._id);
    const notifications = studentIds.map((studentId) => ({
      userId: studentId,
      collegeId: req.user.collegeId,
      title: 'New Assignment Published',
      body: `"${title}" has been posted. Due: ${new Date(dueDate).toLocaleDateString()}`,
      type: 'assignment',
      link: '/frontend/pages/student/assignments.html',
    }));

    try {
      await Notification.insertMany(notifications, { ordered: false });
    } catch {
      // Non-blocking notification error
    }

    emitDataChange(req, {
      collegeId: req.user.collegeId,
      userIds: studentIds,
      roles: ['student'],
      type: 'assignment:new',
      assignmentId: assignment._id,
    });
  }

  await logAudit(req, 'create', 'assignment', {
    resourceId: assignment._id,
    description: `Created assignment "${title}" for semester ${semester}`,
  });

  const populated = await Assignment.findById(assignment._id)
    .populate('subjectId', 'name code semester credits')
    .populate('courseId', 'name code department');

  res.status(201).json({
    success: true,
    message: 'Assignment created successfully',
    data: populated,
  });
});

// @desc    Get assignments for faculty with live submission statistics
// @route   GET /api/assignments/faculty
// @access  Faculty, CollegeAdmin
const getFacultyAssignments = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };

  // If faculty, show their assignments unless specifically overridden
  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  } else if (req.query.facultyId) {
    query.facultyId = req.query.facultyId;
  }

  if (req.query.subjectId) query.subjectId = req.query.subjectId;
  if (req.query.semester) query.semester = parseSemester(req.query.semester);

  const assignments = await Assignment.find(query)
    .populate('subjectId', 'name code semester credits')
    .populate('courseId', 'name code department')
    .populate('facultyId', 'name email designation')
    .sort({ dueDate: -1, createdAt: -1 })
    .lean();

  // Enhance each assignment with submission stats
  const assignmentIds = assignments.map((a) => a._id);
  const submissions = await Submission.find({ assignmentId: { $in: assignmentIds } }).lean();

  // Group submissions by assignmentId
  const submissionMap = new Map();
  submissions.forEach((sub) => {
    const key = String(sub.assignmentId);
    if (!submissionMap.has(key)) submissionMap.set(key, []);
    submissionMap.get(key).push(sub);
  });

  // Calculate student counts per semester to compute submission rate
  const semesterCounts = await User.aggregate([
    { $match: { collegeId: req.user.collegeId, role: 'student', isActive: true } },
    { $group: { _id: '$semester', count: { $sum: 1 } } },
  ]);
  const semesterStudentMap = new Map(semesterCounts.map((s) => [s._id, s.count]));

  const enriched = assignments.map((a) => {
    const subs = submissionMap.get(String(a._id)) || [];
    const submittedCount = subs.length;
    const gradedCount = subs.filter((s) => s.status === 'graded').length;
    const pendingGradingCount = submittedCount - gradedCount;
    const totalStudents = semesterStudentMap.get(a.semester) || 0;
    const isPastDue = new Date(a.dueDate) < new Date();

    return {
      ...a,
      isPastDue,
      stats: {
        totalStudents,
        submittedCount,
        gradedCount,
        pendingGradingCount,
        submissionPercentage: totalStudents > 0 ? Math.min(100, Math.round((submittedCount / totalStudents) * 100)) : 0,
      },
    };
  });

  res.json({
    success: true,
    count: enriched.length,
    data: enriched,
  });
});

// @desc    Get assignments for student with personal submission statuses & overall metrics
// @route   GET /api/assignments/student
// @access  Student
const getStudentAssignments = asyncHandler(async (req, res) => {
  const student = req.user;
  const query = {
    collegeId: student.collegeId,
    isPublished: true,
  };

  if (student.semester) {
    query.semester = student.semester;
  }

  if (req.query.subjectId) {
    query.subjectId = req.query.subjectId;
  }

  const assignments = await Assignment.find(query)
    .populate('subjectId', 'name code semester credits')
    .populate('courseId', 'name code department')
    .populate('facultyId', 'name email designation avatar')
    .sort({ dueDate: 1, createdAt: -1 })
    .lean();

  const assignmentIds = assignments.map((a) => a._id);
  const mySubmissions = await Submission.find({
    assignmentId: { $in: assignmentIds },
    studentId: student._id,
  }).lean();

  const mySubMap = new Map(mySubmissions.map((s) => [String(s.assignmentId), s]));

  const now = new Date();

  const enriched = assignments.map((a) => {
    const sub = mySubMap.get(String(a._id)) || null;
    const dueDate = new Date(a.dueDate);
    const isOverdue = !sub && now > dueDate;

    let studentStatus = 'pending';
    if (sub) {
      studentStatus = sub.status; // 'submitted', 'graded', 'late'
    } else if (isOverdue) {
      studentStatus = 'overdue';
    }

    // Days remaining / overdue
    const diffTime = dueDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return {
      ...a,
      mySubmission: sub,
      studentStatus,
      isOverdue,
      daysRemaining: diffDays,
      dueFormatted: dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };
  });

  // Calculate summary metrics
  const total = enriched.length;
  const gradedList = enriched.filter((a) => a.studentStatus === 'graded');
  const gradedCount = gradedList.length;
  const submittedCount = enriched.filter((a) => a.mySubmission !== null).length;
  const pendingCount = total - submittedCount;

  let totalScorePct = 0;
  gradedList.forEach((a) => {
    if (a.totalMarks > 0 && typeof a.mySubmission?.marksObtained === 'number') {
      totalScorePct += (a.mySubmission.marksObtained / a.totalMarks) * 100;
    }
  });
  const avgScore = gradedCount > 0 ? Number((totalScorePct / gradedCount).toFixed(1)) : 0;

  // Filter if query passed
  let filtered = enriched;
  if (req.query.tab === 'pending') {
    filtered = enriched.filter((a) => a.studentStatus === 'pending' || a.studentStatus === 'overdue');
  } else if (req.query.tab === 'submitted') {
    filtered = enriched.filter((a) => a.mySubmission !== null && a.studentStatus !== 'graded');
  } else if (req.query.tab === 'graded') {
    filtered = enriched.filter((a) => a.studentStatus === 'graded');
  }

  res.json({
    success: true,
    stats: {
      total,
      pending: pendingCount,
      submitted: submittedCount,
      graded: gradedCount,
      avgScore,
    },
    data: filtered,
  });
});

// @desc    Get submissions for a specific assignment
// @route   GET /api/assignments/:id/submissions
// @access  Faculty, CollegeAdmin
const getAssignmentSubmissions = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  })
    .populate('subjectId', 'name code semester credits')
    .populate('courseId', 'name code department')
    .populate('facultyId', 'name email designation');

  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Assignment not found' });
  }

  const submissions = await Submission.find({ assignmentId: assignment._id })
    .populate('studentId', 'name email rollNo enrollmentNo department semester avatar')
    .sort({ submittedAt: -1 })
    .lean();

  // Find students enrolled who haven't submitted
  const submittedStudentIds = submissions.map((s) => String(s.studentId?._id || s.studentId));
  const missingStudents = await User.find({
    collegeId: req.user.collegeId,
    role: 'student',
    isActive: true,
    semester: assignment.semester,
    _id: { $nin: submittedStudentIds },
  })
    .select('name email rollNo enrollmentNo department avatar')
    .lean();

  res.json({
    success: true,
    assignment,
    submissions,
    missingStudents,
    stats: {
      totalEnrolled: submissions.length + missingStudents.length,
      submittedCount: submissions.length,
      gradedCount: submissions.filter((s) => s.status === 'graded').length,
      missingCount: missingStudents.length,
    },
  });
});

// @desc    Student submit assignment
// @route   POST /api/assignments/:id/submit
// @access  Student
const submitAssignment = asyncHandler(async (req, res) => {
  const { files, content, fileUrl, notes } = req.body;
  const assignment = await Assignment.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
    isPublished: true,
  });

  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Assignment not found or unpublished' });
  }

  // Check if existing submission has already been graded
  let existing = await Submission.findOne({
    assignmentId: assignment._id,
    studentId: req.user._id,
  });

  if (existing && existing.status === 'graded') {
    return res.status(400).json({
      success: false,
      message: 'This assignment has already been evaluated and cannot be resubmitted.',
    });
  }

  // Parse files
  let fileList = [];
  if (Array.isArray(files)) {
    fileList = files.filter(Boolean);
  } else if (typeof files === 'string' && files.trim()) {
    fileList = [files.trim()];
  } else if (fileUrl) {
    fileList = [fileUrl];
  }

  const submissionContent = content || notes || '';

  if (fileList.length === 0 && !submissionContent.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Please provide either a solution file/link or written submission content.',
    });
  }

  const isLate = new Date() > new Date(assignment.dueDate);
  const status = isLate ? 'late' : 'submitted';

  let submission;
  if (existing) {
    existing.files = fileList.length > 0 ? fileList : existing.files;
    existing.content = submissionContent || existing.content;
    existing.submittedAt = new Date();
    existing.status = status;
    submission = await existing.save();
  } else {
    submission = await Submission.create({
      assignmentId: assignment._id,
      studentId: req.user._id,
      collegeId: req.user.collegeId,
      submittedAt: new Date(),
      files: fileList,
      content: submissionContent,
      status,
    });
  }

  // Notify faculty member
  if (assignment.facultyId) {
    try {
      await Notification.create({
        userId: assignment.facultyId,
        collegeId: req.user.collegeId,
        title: 'New Student Submission',
        body: `${req.user.name} submitted "${assignment.title}"${isLate ? ' (Late)' : ''}`,
        type: 'assignment',
        link: '/frontend/pages/faculty/assignments.html',
      });
    } catch {
      // Non-blocking
    }
  }

  emitDataChange(req, {
    collegeId: req.user.collegeId,
    userIds: [assignment.facultyId],
    roles: ['faculty'],
    type: 'assignment:submitted',
    assignmentId: assignment._id,
  });

  await logAudit(req, 'submit', 'assignment', {
    resourceId: assignment._id,
    description: `Submitted work for "${assignment.title}"${isLate ? ' (Late)' : ''}`,
  });

  res.status(200).json({
    success: true,
    message: isLate ? 'Assignment submitted (Recorded as Late due to deadline)' : 'Assignment submitted successfully!',
    data: submission,
  });
});

// @desc    Faculty grades a student submission
// @route   POST /api/assignments/submissions/:submissionId/grade
// @access  Faculty, CollegeAdmin
const gradeSubmission = asyncHandler(async (req, res) => {
  const { marksObtained, feedback } = req.body;

  if (marksObtained === undefined || marksObtained === null || marksObtained === '') {
    return res.status(400).json({ success: false, message: 'Marks obtained is required' });
  }

  const numericMarks = Number(marksObtained);
  if (isNaN(numericMarks) || numericMarks < 0) {
    return res.status(400).json({ success: false, message: 'Marks must be a non-negative number' });
  }

  const submission = await Submission.findOne({
    _id: req.params.submissionId,
    collegeId: req.user.collegeId,
  }).populate('assignmentId');

  if (!submission) {
    return res.status(404).json({ success: false, message: 'Submission record not found' });
  }

  const assignment = submission.assignmentId;
  if (numericMarks > assignment.totalMarks) {
    return res.status(400).json({
      success: false,
      message: `Marks obtained (${numericMarks}) cannot exceed maximum marks (${assignment.totalMarks})`,
    });
  }

  submission.marksObtained = numericMarks;
  submission.feedback = feedback || '';
  submission.status = 'graded';
  await submission.save();

  // Create notification for student
  try {
    await Notification.create({
      userId: submission.studentId,
      collegeId: req.user.collegeId,
      title: 'Assignment Graded',
      body: `Your submission for "${assignment.title}" scored ${numericMarks}/${assignment.totalMarks}`,
      type: 'assignment',
      link: '/frontend/pages/student/assignments.html',
    });
  } catch {
    // Non-blocking
  }

  emitDataChange(req, {
    collegeId: req.user.collegeId,
    userIds: [submission.studentId],
    roles: ['student'],
    type: 'assignment:graded',
    assignmentId: assignment._id,
  });

  await logAudit(req, 'grade', 'assignment_submission', {
    resourceId: submission._id,
    description: `Graded submission for ${assignment.title}: ${numericMarks}/${assignment.totalMarks}`,
  });

  const updated = await Submission.findById(submission._id).populate('studentId', 'name email rollNo');

  res.json({
    success: true,
    message: 'Submission graded successfully',
    data: updated,
  });
});

// @desc    Update assignment details
// @route   PUT /api/assignments/:id
// @access  Faculty, CollegeAdmin
const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });

  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Assignment not found' });
  }

  const { title, description, dueDate, totalMarks, maxMarks, isPublished, attachments } = req.body;

  if (title) assignment.title = title.trim();
  if (description !== undefined) assignment.description = description;
  if (dueDate) assignment.dueDate = new Date(dueDate);
  if (totalMarks || maxMarks) assignment.totalMarks = Number(totalMarks || maxMarks);
  if (isPublished !== undefined) assignment.isPublished = Boolean(isPublished);
  if (attachments) {
    assignment.attachments = Array.isArray(attachments) ? attachments : [attachments];
  }

  await assignment.save();

  await logAudit(req, 'update', 'assignment', {
    resourceId: assignment._id,
    description: `Updated assignment "${assignment.title}"`,
  });

  res.json({
    success: true,
    message: 'Assignment updated successfully',
    data: assignment,
  });
});

// @desc    Delete assignment
// @route   DELETE /api/assignments/:id
// @access  Faculty, CollegeAdmin
const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });

  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Assignment not found' });
  }

  await Submission.deleteMany({ assignmentId: assignment._id });
  await Assignment.deleteOne({ _id: assignment._id });

  await logAudit(req, 'delete', 'assignment', {
    resourceId: assignment._id,
    description: `Deleted assignment "${assignment.title}" and its submissions`,
  });

  res.json({
    success: true,
    message: 'Assignment and associated submissions deleted successfully',
  });
});

module.exports = {
  createAssignment,
  getFacultyAssignments,
  getStudentAssignments,
  getAssignmentSubmissions,
  submitAssignment,
  gradeSubmission,
  updateAssignment,
  deleteAssignment,
};
