const asyncHandler = require('../middleware/asyncHandler');
const Course = require('../models/Course');
const Subject = require('../models/Subject');
const Timetable = require('../models/Timetable');
const { Assignment, Submission } = require('../models/Assignment');
const { Book, LibraryRecord } = require('../models/Library');
const { Room } = require('../models/Hostel');
const TransportRoute = require('../models/Transport');
const LiveClassSession = require('../models/LiveClassSession');
const User = require('../models/User');
const { emitDataChange } = require('../utils/realtime');
const { parseSemester, escapeRegex } = require('../utils/parseHelpers');
const { logAudit } = require('../services/auditService');

const toProgramCode = (department = '') => {
  const normalized = String(department).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 20) || `PRG-${Date.now().toString().slice(-6)}`;
};

async function resolveStudentContext(user, requestedStudentId) {
  if (user.role === 'student') {
    return user;
  }

  if (user.role !== 'parent') {
    return null;
  }

  const children = Array.isArray(user.children) ? user.children.map(String) : [];
  const targetChildId = requestedStudentId && children.includes(String(requestedStudentId))
    ? requestedStudentId
    : children[0];

  if (!targetChildId) {
    return null;
  }

  return User.findById(targetChildId).select('name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt');
}

async function resolveAccessibleStudent(user, requestedStudentId) {
  if (user.role === 'student') {
    return User.findOne({ _id: user._id, collegeId: user.collegeId, role: 'student' })
      .select('name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt parentId');
  }

  if (user.role === 'parent') {
    const children = Array.isArray(user.children) ? user.children.map(String) : [];
    const targetChildId = requestedStudentId && children.includes(String(requestedStudentId))
      ? requestedStudentId
      : children[0];

    if (!targetChildId) {
      return null;
    }

    return User.findOne({ _id: targetChildId, collegeId: user.collegeId, role: 'student' })
      .select('name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt parentId');
  }

  if ((user.role === 'collegeAdmin' || user.role === 'faculty') && requestedStudentId) {
    return User.findOne({ _id: requestedStudentId, collegeId: user.collegeId, role: 'student' })
      .select('name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt parentId');
  }

  return null;
}

async function ensureCourseProgram(collegeId, department) {
  if (!department) {
    return null;
  }

  let program = await Course.findOne({ collegeId, department });
  if (!program) {
    program = await Course.create({
      collegeId,
      name: department,
      code: toProgramCode(department),
      department,
    });
  }

  return program;
}

async function resolveCourseIds(collegeId, department) {
  if (!department) {
    return [];
  }

  const courses = await Course.find({ collegeId, department }).select('_id');
  return courses.map((course) => course._id);
}

async function resolveSubject({ collegeId, subjectId, subjectName, department, semester, facultyId }) {
  if (subjectId) {
    return Subject.findOne({ _id: subjectId, collegeId });
  }

  if (!subjectName) {
    return null;
  }

  const query = {
    collegeId,
    $or: [
      { name: { $regex: `^${escapeRegex(subjectName)}$`, $options: 'i' } },
      { code: { $regex: `^${escapeRegex(subjectName)}$`, $options: 'i' } },
      { name: { $regex: escapeRegex(subjectName), $options: 'i' } },
    ],
  };

  const parsedSemester = parseSemester(semester);
  if (parsedSemester) {
    query.semester = parsedSemester;
  }

  if (department) {
    const courseIds = await resolveCourseIds(collegeId, department);
    if (courseIds.length) {
      query.courseId = { $in: courseIds };
    }
  }

  if (facultyId) {
    query.facultyId = facultyId;
  }

  return Subject.findOne(query).sort({ createdAt: 1 });
}

async function resolveFaculty(collegeId, value) {
  if (!value) {
    return null;
  }

  if (/^[a-f\d]{24}$/i.test(String(value))) {
    const byId = await User.findOne({ _id: value, collegeId, role: 'faculty' });
    if (byId) return byId;
  }

  const byEmail = await User.findOne({ email: value, collegeId, role: 'faculty' });
  if (byEmail) return byEmail;

  return User.findOne({
    collegeId,
    role: 'faculty',
    name: { $regex: `^${escapeRegex(value)}$`, $options: 'i' },
  });
}

const getCourses = asyncHandler(async (req, res) => {
  const { department, search = '' } = req.query;
  const query = { collegeId: req.user.collegeId };

  if (department) {
    query.department = department;
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } },
      { department: { $regex: search, $options: 'i' } },
    ];
  }

  const courses = await Course.find(query).sort({ name: 1 });
  res.json({ success: true, courses });
});

const createCourse = asyncHandler(async (req, res) => {
  const payload = {
    collegeId: req.user.collegeId,
    name: req.body.name,
    code: req.body.code || toProgramCode(req.body.department),
    department: req.body.department,
    duration: req.body.duration,
    totalSemesters: req.body.totalSemesters,
    description: req.body.description,
  };

  const existing = await Course.findOne({ collegeId: payload.collegeId, code: payload.code });
  if (existing) {
    return res.status(400).json({ success: false, message: 'Course code already exists' });
  }

  const course = await Course.create(payload);
  logAudit(req, 'create', 'course', { resourceId: course._id, description: `Created course: ${course.name}`, metadata: { code: course.code } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'courses',
    action: 'created',
  });

  res.status(201).json({ success: true, course });
});

const getSubjects = asyncHandler(async (req, res) => {
  const { department, semester, search = '' } = req.query;
  const query = { collegeId: req.user.collegeId };

  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  }

  const studentContext = await resolveStudentContext(req.user, req.query.studentId);
  const effectiveDepartment = department || studentContext?.department;
  const effectiveSemester = parseSemester(semester) || studentContext?.semester;

  if (effectiveSemester) {
    query.semester = effectiveSemester;
  }

  if (effectiveDepartment) {
    const courseIds = await resolveCourseIds(req.user.collegeId, effectiveDepartment);
    if (courseIds.length) {
      query.courseId = { $in: courseIds };
    }
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } },
    ];
  }

  const subjects = await Subject.find(query)
    .populate('facultyId', 'name email designation department')
    .populate('courseId', 'name code department')
    .sort({ semester: 1, name: 1 });

  res.json({ success: true, subjects });
});

const getStudents = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId, role: 'student', isActive: true };
  const semester = parseSemester(req.query.semester || req.query.batch);
  const department = req.query.department || (req.query.batch ? req.query.batch.replace(/\s*Sem\s*\d+/i, '').trim() : undefined);

  if (semester) {
    query.semester = semester;
  }

  if (department) {
    query.department = department;
  }

  if (req.query.search) {
    query.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { rollNo: { $regex: req.query.search, $options: 'i' } },
      { email: { $regex: req.query.search, $options: 'i' } },
    ];
  }

  const students = await User.find(query).select('name email rollNo department semester phone').sort({ name: 1 });
  res.json({ success: true, students });
});

const getStudentProfile = asyncHandler(async (req, res) => {
  const student = await resolveAccessibleStudent(req.user, req.params.studentId || req.query.studentId);
  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found' });
  }

  const populatedStudent = await User.findOne({ _id: student._id, collegeId: req.user.collegeId, role: 'student' })
    .select('name email phone rollNo semester department collegeId dateOfBirth gender bloodGroup admissionDate enrollmentNo section address createdAt parentId')
    .populate('collegeId', 'name code')
    .populate('parentId', 'name email phone');

  const subjectQuery = { collegeId: req.user.collegeId, semester: populatedStudent.semester };
  const courseIds = await resolveCourseIds(req.user.collegeId, populatedStudent.department);
  if (courseIds.length) {
    subjectQuery.courseId = { $in: courseIds };
  }

  const [subjects, room, route, liveClass] = await Promise.all([
    Subject.find(subjectQuery)
      .populate('facultyId', 'name email designation department')
      .sort({ createdAt: 1 }),
    Room.findOne({ collegeId: req.user.collegeId, occupants: populatedStudent._id }).populate('hostelId', 'name type'),
    TransportRoute.findOne({ collegeId: req.user.collegeId, enrolledStudents: populatedStudent._id, isActive: true }),
    LiveClassSession.findOne({
      collegeId: req.user.collegeId,
      department: populatedStudent.department,
      semester: populatedStudent.semester,
      status: 'active',
    })
      .populate('facultyId', 'name email designation')
      .populate('subjectId', 'name code'),
  ]);

  const mentor = subjects.find((item) => item.facultyId)?.facultyId || null;

  res.json({
    success: true,
    profile: {
      student: populatedStudent,
      mentor,
      transportRoute: route ? {
        _id: route._id,
        routeName: route.routeName,
        busNumber: route.busNumber,
        driverName: route.driverName,
        driverPhone: route.driverPhone,
        firstStop: route.stops?.[0]?.stopName || null,
      } : null,
      hostelRoom: room ? {
        _id: room._id,
        roomNumber: room.roomNumber,
        capacity: room.capacity,
        hostel: room.hostelId ? {
          _id: room.hostelId._id,
          name: room.hostelId.name,
          type: room.hostelId.type,
        } : null,
      } : null,
      currentLiveClass: liveClass ? {
        _id: liveClass._id,
        title: liveClass.title,
        roomName: liveClass.roomName,
        startedAt: liveClass.startedAt,
        faculty: liveClass.facultyId,
        subject: liveClass.subjectId,
      } : null,
      assignedSubjects: subjects.map((item) => ({
        _id: item._id,
        name: item.name,
        code: item.code,
        faculty: item.facultyId || null,
      })),
    },
  });
});

const createSubject = asyncHandler(async (req, res) => {
  const department = req.body.department || req.body.branch;
  const semester = parseSemester(req.body.semester || req.body.sem);
  const program = req.body.courseId ? await Course.findOne({ _id: req.body.courseId, collegeId: req.user.collegeId }) : await ensureCourseProgram(req.user.collegeId, department);

  if (!program) {
    return res.status(400).json({ success: false, message: 'Department or course is required' });
  }

  const faculty = await resolveFaculty(req.user.collegeId, req.body.facultyId || req.body.faculty || req.body.assignedFaculty);

  const subject = await Subject.create({
    collegeId: req.user.collegeId,
    courseId: program._id,
    name: req.body.name,
    code: req.body.code,
    semester: semester || 1,
    credits: req.body.credits || 3,
    facultyId: faculty?._id || null,
    type: req.body.type || 'theory',
  });

  logAudit(req, 'create', 'subject', { resourceId: subject._id, description: `Created subject: ${subject.name}`, metadata: { code: subject.code } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'subjects',
    action: 'created',
  });

  const populated = await subject.populate('facultyId', 'name email designation department');
  res.status(201).json({ success: true, subject: populated });
});

const getTimetable = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId, isActive: true };

  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  }

  const studentContext = await resolveStudentContext(req.user, req.query.studentId);
  const effectiveDepartment = req.query.department || studentContext?.department;
  const effectiveSemester = parseSemester(req.query.semester) || studentContext?.semester;

  if (effectiveSemester) {
    query.semester = effectiveSemester;
  }

  if (effectiveDepartment) {
    const courseIds = await resolveCourseIds(req.user.collegeId, effectiveDepartment);
    if (courseIds.length) {
      query.courseId = { $in: courseIds };
    }
  }

  const timetable = await Timetable.find(query)
    .populate('courseId', 'name code department')
    .populate('subjectId', 'name code')
    .populate('facultyId', 'name designation')
    .sort({ dayOfWeek: 1, startTime: 1 });

  res.json({ success: true, timetable });
});

const createTimetable = asyncHandler(async (req, res) => {
  const subject = await resolveSubject({
    collegeId: req.user.collegeId,
    subjectId: req.body.subjectId,
    subjectName: req.body.subject,
    department: req.body.department || req.body.branch,
    semester: req.body.semester || req.body.sem,
  });

  if (!subject) {
    return res.status(400).json({ success: false, message: 'Valid subject is required' });
  }

  const faculty = await resolveFaculty(req.user.collegeId, req.body.facultyId || req.body.faculty);
  if (!faculty) {
    return res.status(400).json({ success: false, message: 'Assigned faculty is required' });
  }

  const entry = await Timetable.create({
    collegeId: req.user.collegeId,
    courseId: subject.courseId,
    subjectId: subject._id,
    facultyId: faculty._id,
    semester: parseSemester(req.body.semester || req.body.sem) || subject.semester,
    dayOfWeek: req.body.dayOfWeek,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    room: req.body.room,
    type: req.body.type || 'lecture',
    academicYear: req.body.academicYear,
  });

  logAudit(req, 'create', 'timetable', { resourceId: entry._id, description: `Created timetable entry for ${entry.dayOfWeek}`, metadata: { subjectId: subject._id, dayOfWeek: entry.dayOfWeek } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'timetable',
    action: 'created',
  });

  res.status(201).json({ success: true, timetable: entry });
});

const getAssignments = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };

  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  }

  const studentContext = await resolveStudentContext(req.user, req.query.studentId);
  if (studentContext) {
    query.semester = studentContext.semester;
    const courseIds = await resolveCourseIds(req.user.collegeId, studentContext.department);
    if (courseIds.length) {
      query.courseId = { $in: courseIds };
    }
  }

  const assignments = await Assignment.find(query)
    .populate('subjectId', 'name code semester')
    .populate('facultyId', 'name')
    .populate('courseId', 'name code department')
    .sort({ dueDate: 1, createdAt: -1 });

  let submissions = [];
  if (studentContext) {
    submissions = await Submission.find({
      assignmentId: { $in: assignments.map((assignment) => assignment._id) },
      studentId: studentContext._id,
    }).sort({ createdAt: -1 });
  }

  const submissionMap = new Map(submissions.map((submission) => [String(submission.assignmentId), submission]));
  const data = assignments.map((assignment) => ({
    ...assignment.toObject(),
    submission: submissionMap.get(String(assignment._id)) || null,
  }));

  res.json({ success: true, assignments: data });
});

const createAssignment = asyncHandler(async (req, res) => {
  const department = req.body.department || (req.body.batch ? req.body.batch.replace(/\s*Sem\s*\d+/i, '').trim() : undefined);
  const semester = parseSemester(req.body.semester || req.body.batch || req.body.sem);
  const subject = await resolveSubject({
    collegeId: req.user.collegeId,
    subjectId: req.body.subjectId,
    subjectName: req.body.subject || req.body.subjectName,
    department,
    semester,
    facultyId: req.user.role === 'faculty' ? req.user._id : undefined,
  });

  if (!subject) {
    return res.status(400).json({ success: false, message: 'Subject not found for this assignment' });
  }

  const assignment = await Assignment.create({
    collegeId: req.user.collegeId,
    subjectId: subject._id,
    facultyId: req.user.role === 'faculty' ? req.user._id : (subject.facultyId || req.user._id),
    courseId: subject.courseId,
    semester: semester || subject.semester,
    title: req.body.title,
    description: req.body.description,
    dueDate: req.body.dueDate || req.body.due,
    totalMarks: req.body.totalMarks || req.body.maxMarks || req.body.marks || 100,
    attachments: req.body.attachments || [],
    isPublished: req.body.isPublished !== false,
  });

  logAudit(req, 'create', 'assignment', { resourceId: assignment._id, description: `Created assignment: ${assignment.title}`, metadata: { subjectId: subject._id } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'assignments',
    action: 'created',
  });

  res.status(201).json({ success: true, assignment });
});

const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Assignment not found' });
  }

  await Submission.deleteMany({ assignmentId: assignment._id, collegeId: req.user.collegeId });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'assignments',
    action: 'deleted',
  });

  res.json({ success: true, message: 'Assignment deleted' });
});

const submitAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Assignment not found' });
  }

  const submission = await Submission.findOneAndUpdate(
    { assignmentId: assignment._id, studentId: req.user._id },
    {
      collegeId: req.user.collegeId,
      submittedAt: new Date(),
      files: req.body.files || [],
      content: req.body.content || req.body.comments || '',
      status: new Date(assignment.dueDate) < new Date() ? 'late' : 'submitted',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logAudit(req, 'create', 'assignment_submission', { resourceId: submission._id, description: `Submitted assignment`, metadata: { assignmentId: assignment._id } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    userIds: [String(assignment.facultyId)],
    roles: ['superadmin'],
    resource: 'assignments',
    action: 'submitted',
  });

  res.json({ success: true, submission });
});

const getAssignmentSubmissions = asyncHandler(async (req, res) => {
  const submissions = await Submission.find({ assignmentId: req.params.id, collegeId: req.user.collegeId })
    .populate('studentId', 'name email rollNo department semester')
    .sort({ submittedAt: -1 });

  res.json({ success: true, submissions });
});

const getLibraryBooks = asyncHandler(async (req, res) => {
  const { search = '', category } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };

  if (category) {
    query.category = category;
  }

  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { author: { $regex: search, $options: 'i' } },
      { isbn: { $regex: search, $options: 'i' } },
      { subject: { $regex: search, $options: 'i' } },
    ];
  }

  const books = await Book.find(query).sort({ title: 1 });
  res.json({ success: true, books });
});

const createBook = asyncHandler(async (req, res) => {
  const book = await Book.create({
    collegeId: req.user.collegeId,
    title: req.body.title,
    author: req.body.author,
    isbn: req.body.isbn,
    publisher: req.body.publisher,
    edition: req.body.edition,
    category: req.body.category,
    subject: req.body.subject,
    totalCopies: req.body.totalCopies || 1,
    availableCopies: req.body.availableCopies || req.body.totalCopies || 1,
    location: req.body.location,
  });

  logAudit(req, 'create', 'book', { resourceId: book._id, description: `Created book: ${book.title}`, metadata: { isbn: book.isbn } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'library',
    action: 'created',
  });

  res.status(201).json({ success: true, book });
});

const getLibraryRecords = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };

  if (req.user.role === 'student') {
    query.userId = req.user._id;
  } else if (req.user.role === 'parent') {
    const child = await resolveStudentContext(req.user, req.query.studentId);
    if (!child) {
      return res.json({ success: true, records: [] });
    }
    query.userId = child._id;
  } else if (req.query.userId) {
    query.userId = req.query.userId;
  }

  const records = await LibraryRecord.find(query)
    .populate('bookId', 'title author isbn category')
    .populate('userId', 'name rollNo email')
    .sort({ issuedDate: -1 });

  res.json({ success: true, records });
});

const issueBook = asyncHandler(async (req, res) => {
  const book = await Book.findOne({ _id: req.body.bookId, collegeId: req.user.collegeId, isActive: true });
  if (!book) {
    return res.status(404).json({ success: false, message: 'Book not found' });
  }

  if (book.availableCopies < 1) {
    return res.status(400).json({ success: false, message: 'No copies available right now' });
  }

  let userId = req.body.userId;
  if (req.user.role === 'student') {
    userId = req.user._id;
  } else if (req.user.role === 'parent') {
    const child = await resolveStudentContext(req.user, req.body.studentId);
    if (!child) {
      return res.status(400).json({ success: false, message: 'Parent account is not linked to a student' });
    }
    userId = child._id;
  }

  const record = await LibraryRecord.create({
    collegeId: req.user.collegeId,
    bookId: book._id,
    userId,
    dueDate: req.body.dueDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    status: 'issued',
  });

  book.availableCopies -= 1;
  await book.save();

  logAudit(req, 'create', 'library_record', { resourceId: record._id, description: `Issued book: ${book.title}`, metadata: { bookId: book._id, userId } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    userIds: userId ? [String(userId)] : [],
    roles: ['superadmin'],
    resource: 'library',
    action: 'issued',
  });

  res.status(201).json({ success: true, record });
});

// @desc    Return a library book
const returnBook = asyncHandler(async (req, res) => {
  const { recordId } = req.body;
  if (!recordId) return res.status(400).json({ success: false, message: 'Record ID is required' });

  const { LibraryRecord } = require('../models/Library');
  const record = await LibraryRecord.findOne({ _id: recordId, collegeId: req.user.collegeId });
  if (!record) return res.status(404).json({ success: false, message: 'Library record not found' });
  if (record.status === 'returned') return res.status(400).json({ success: false, message: 'Book already returned' });

  record.returnDate = new Date();
  record.status = 'returned';

  if (record.dueDate && record.returnDate > record.dueDate) {
    const daysLate = Math.ceil((record.returnDate - record.dueDate) / (1000 * 60 * 60 * 24));
    record.fine = daysLate * 10; // ₹10 per day late
  }

  await record.save();

  const { Book } = require('../models/Library');
  await Book.findByIdAndUpdate(record.bookId, { $inc: { availableCopies: 1 } });

  logAudit(req, 'return_book', 'library', { resourceId: record._id, description: `Book returned: ${record.bookId}`, metadata: { fine: record.fine || 0 } });

  res.json({ success: true, message: 'Book returned successfully', record });
});

// @desc    Grade an assignment submission
const gradeSubmission = asyncHandler(async (req, res) => {
  const { submissionId } = req.params;
  const { marksObtained, feedback } = req.body;

  const { Submission } = require('../models/Assignment');
  const submission = await Submission.findOne({ _id: submissionId, collegeId: req.user.collegeId });
  if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

  const assignment = await require('../models/Assignment').Assignment.findById(submission.assignmentId);
  if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });

  if (marksObtained !== undefined && marksObtained > assignment.totalMarks) {
    return res.status(400).json({ success: false, message: `Marks cannot exceed total marks (${assignment.totalMarks})` });
  }

  submission.marksObtained = marksObtained;
  submission.feedback = feedback;
  submission.status = 'graded';
  await submission.save();

  logAudit(req, 'grade', 'assignment', { resourceId: submission._id, description: `Graded submission: ${marksObtained}/${assignment.totalMarks}`, metadata: { studentId: submission.studentId, assignmentId: assignment._id } });

  res.json({ success: true, message: 'Submission graded', submission });
});

module.exports = {
  getCourses,
  createCourse,
  getSubjects,
  getStudents,
  getStudentProfile,
  createSubject,
  getTimetable,
  createTimetable,
  getAssignments,
  createAssignment,
  deleteAssignment,
  submitAssignment,
  getAssignmentSubmissions,
  getLibraryBooks,
  createBook,
  getLibraryRecords,
  issueBook,
  returnBook,
  gradeSubmission,
};
