const asyncHandler = require('../middleware/asyncHandler');
const User = require('../models/User');
const College = require('../models/College');
const Attendance = require('../models/Attendance');
const Result = require('../models/Result');
const Fee = require('../models/Fee');
const Notice = require('../models/Notice');
const Leave = require('../models/Leave');
const Course = require('../models/Course');
const Subject = require('../models/Subject');
const Exam = require('../models/Exam');
const Timetable = require('../models/Timetable');
const { Assignment, Submission } = require('../models/Assignment');
const TransportRoute = require('../models/Transport');
const { Hostel, Room } = require('../models/Hostel');
const LiveClassSession = require('../models/LiveClassSession');
const { emitDataChange } = require('../utils/realtime');

const parseSemester = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = parseInt(String(value).replace(/[^\d]/g, ''), 10);
    return Number.isNaN(numeric) ? undefined : numeric;
  };

// @desc    Get college dashboard analytics (Advanced with Chart Data)
const getCollegeDashboard = asyncHandler(async (req, res) => {
    const collegeId = req.user.collegeId;
    const now = new Date();
    const next30Days = new Date(now);
    next30Days.setDate(next30Days.getDate() + 30);

    const [
      totalStudents,
      totalFaculty,
      totalParents,
      pendingFees,
      recentNotices,
      recentStudents,
      pendingLeaves,
      inactiveStudents,
      linkedStudents,
      activeCourses,
      activeSubjects,
      assignedSubjects,
      timetableSlots,
      upcomingExams,
      publishedExamCount,
      assignmentCount,
      submissionCount,
      activeLiveClasses,
      activeRoutes,
      routeCapacity,
      hostelBlocks,
      roomCapacity,
      departmentMix,
    ] = await Promise.all([
      User.countDocuments({ collegeId, role: 'student', isActive: true }),
      User.countDocuments({ collegeId, role: 'faculty', isActive: true }),
      User.countDocuments({ collegeId, role: 'parent', isActive: true }),
      Fee.countDocuments({ collegeId, status: { $in: ['pending', 'partial', 'overdue'] } }),
      Notice.find({ collegeId, isActive: true }).sort({ createdAt: -1 }).limit(5),
      User.find({ collegeId, role: 'student' }).select('name email rollNo department semester isActive').sort({ createdAt: -1 }).limit(5),
      Leave.find({ collegeId, status: 'pending' }).populate('userId', 'name department designation role').sort({ createdAt: -1 }).limit(10),
      User.countDocuments({ collegeId, role: 'student', isActive: false }),
      User.countDocuments({ collegeId, role: 'student', parentId: { $exists: true, $ne: null } }),
      Course.countDocuments({ collegeId, isActive: true }),
      Subject.countDocuments({ collegeId, isActive: true }),
      Subject.countDocuments({ collegeId, isActive: true, facultyId: { $exists: true, $ne: null } }),
      Timetable.countDocuments({ collegeId, isActive: true }),
      Exam.find({ collegeId, date: { $gte: now, $lte: next30Days } }).populate('subjectId', 'name code').sort({ date: 1 }).limit(5),
      Exam.countDocuments({ collegeId, isPublished: true }),
      Assignment.countDocuments({ collegeId, isPublished: true }),
      Submission.countDocuments({ collegeId }),
      LiveClassSession.countDocuments({ collegeId, status: 'active' }),
      TransportRoute.countDocuments({ collegeId, isActive: true }),
      TransportRoute.aggregate([
        { $match: { collegeId, isActive: true } },
        { $project: { capacity: 1, enrolledCount: { $size: { $ifNull: ['$enrolledStudents', []] } } } },
        { $group: { _id: null, capacity: { $sum: '$capacity' }, enrolled: { $sum: '$enrolledCount' } } },
      ]),
      Hostel.countDocuments({ collegeId, isActive: true }),
      Room.aggregate([
        { $match: { collegeId } },
        { $project: { capacity: 1, occupantCount: { $size: { $ifNull: ['$occupants', []] } } } },
        { $group: { _id: null, rooms: { $sum: 1 }, capacity: { $sum: '$capacity' }, occupied: { $sum: '$occupantCount' } } },
      ]),
      User.aggregate([
        { $match: { collegeId, role: 'student' } },
        { $group: { _id: '$department', students: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } } } },
        { $sort: { students: -1 } },
        { $limit: 6 },
      ]),
    ]);

    // Analytics: Monthly student registrations
    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyStudents = await User.aggregate([
      { $match: { collegeId, role: 'student', createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { $month: '$createdAt' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    // Analytics: Fee Collection Status
    const feeStats = await Fee.aggregate([
      { $match: { collegeId } },
      { $group: { _id: '$status', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    const [feeLedger = {}] = await Fee.aggregate([
      { $match: { collegeId } },
      {
        $group: {
          _id: null,
          totalBilled: { $sum: '$amount' },
          totalPaid: { $sum: { $ifNull: ['$paidAmount', 0] } },
          pendingAmount: {
            $sum: {
              $cond: [
                { $ne: ['$status', 'paid'] },
                { $subtract: ['$amount', { $ifNull: ['$paidAmount', 0] }] },
                0,
              ],
            },
          },
          overdueAmount: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'overdue'] },
                { $subtract: ['$amount', { $ifNull: ['$paidAmount', 0] }] },
                0,
              ],
            },
          },
          pendingInvoices: { $sum: { $cond: [{ $ne: ['$status', 'paid'] }, 1, 0] } },
          overdueInvoices: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
        },
      },
    ]);

    // Analytics: Overall Attendance Rate
    const attendanceStats = await Attendance.aggregate([
      { $match: { collegeId } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const resultStats = await Result.aggregate([
      { $match: { collegeId } },
      { $group: { _id: '$status', count: { $sum: 1 }, avgPercentage: { $avg: '$percentage' } } },
    ]);

    const recentFeeStatusMap = new Map((recentStudents.length ? await Fee.aggregate([
      { $match: { collegeId, studentId: { $in: recentStudents.map((student) => student._id) } } },
      { $sort: { dueDate: -1, createdAt: -1 } },
      { $group: { _id: '$studentId', status: { $first: '$status' } } },
    ]) : []).map((item) => [String(item._id), item.status]));
    const recentStudentsWithFee = recentStudents.map((student) => ({
      ...student.toObject(),
      feeStatus: recentFeeStatusMap.get(String(student._id)) || 'pending',
    }));

    const attendanceTotal = attendanceStats.reduce((sum, item) => sum + item.count, 0);
    const attendedTotal = attendanceStats
      .filter((item) => ['present', 'late', 'excused'].includes(item._id))
      .reduce((sum, item) => sum + item.count, 0);
    const attendanceRate = attendanceTotal ? Math.round((attendedTotal / attendanceTotal) * 100) : 0;

    const totalBilled = feeLedger.totalBilled || 0;
    const totalPaid = feeLedger.totalPaid || 0;
    const collectionRate = totalBilled ? Math.round((totalPaid / totalBilled) * 100) : 0;
    const parentLinkRate = totalStudents ? Math.round((linkedStudents / totalStudents) * 100) : 0;
    const facultyCoverageRate = activeSubjects ? Math.round((assignedSubjects / activeSubjects) * 100) : 0;
    const timetableCoverageRate = activeSubjects ? Math.min(100, Math.round((timetableSlots / activeSubjects) * 100)) : 0;
    const academicDelivery = Math.round((attendanceRate * 0.4) + (facultyCoverageRate * 0.35) + (timetableCoverageRate * 0.25));
    const routeSummary = routeCapacity[0] || { capacity: 0, enrolled: 0 };
    const roomSummary = roomCapacity[0] || { rooms: 0, capacity: 0, occupied: 0 };
    const transportUtilization = routeSummary.capacity ? Math.round((routeSummary.enrolled / routeSummary.capacity) * 100) : 0;
    const hostelUtilization = roomSummary.capacity ? Math.round((roomSummary.occupied / roomSummary.capacity) * 100) : 0;
    const campusServicesScore = Math.round((Math.min(100, transportUtilization || (activeRoutes ? 80 : 0)) + Math.min(100, hostelUtilization || (hostelBlocks ? 80 : 0))) / 2);
    const institutionHealthScore = Math.round((academicDelivery * 0.35) + (collectionRate * 0.25) + (parentLinkRate * 0.2) + (campusServicesScore * 0.2));

    const resultTotal = resultStats.reduce((sum, item) => sum + item.count, 0);
    const passTotal = resultStats.filter((item) => item._id === 'pass').reduce((sum, item) => sum + item.count, 0);
    const averageScore = resultTotal
      ? Math.round(resultStats.reduce((sum, item) => sum + ((item.avgPercentage || 0) * item.count), 0) / resultTotal)
      : 0;
    const passRate = resultTotal ? Math.round((passTotal / resultTotal) * 100) : 0;
    const assignmentBacklog = Math.max((assignmentCount * totalStudents) - submissionCount, 0);

    const priorityQueue = [];
    if (!attendanceTotal) {
      priorityQueue.push({ severity: 'medium', icon: 'fa-calendar-check', title: 'Attendance capture not started', detail: 'Daily attendance data is needed for shortage and student success alerts.' });
    } else if (attendanceRate < 75) {
      priorityQueue.push({ severity: 'high', icon: 'fa-triangle-exclamation', title: 'Attendance below 75%', detail: `${attendanceRate}% overall attendance needs mentor intervention.` });
    }
    if (feeLedger.pendingInvoices > 0) {
      priorityQueue.push({ severity: feeLedger.overdueInvoices ? 'high' : 'medium', icon: 'fa-file-invoice-dollar', title: 'Fee follow-up required', detail: `${feeLedger.pendingInvoices} open invoices worth pending collection.` });
    }
    if (pendingLeaves.length) {
      priorityQueue.push({ severity: 'medium', icon: 'fa-user-clock', title: 'Faculty leave approvals pending', detail: `${pendingLeaves.length} leave requests are waiting for HR action.` });
    }
    if (activeSubjects && facultyCoverageRate < 100) {
      priorityQueue.push({ severity: 'medium', icon: 'fa-chalkboard-user', title: 'Faculty mapping incomplete', detail: `${activeSubjects - assignedSubjects} active subjects need an assigned faculty member.` });
    }
    if (!priorityQueue.length) {
      priorityQueue.push({ severity: 'low', icon: 'fa-circle-check', title: 'Operations stable', detail: 'No critical campus risks detected from current ERP data.' });
    }

    const readiness = [
      { label: 'Course catalog', value: activeCourses, score: activeCourses ? 100 : 0, detail: 'active programs' },
      { label: 'Faculty mapping', value: `${assignedSubjects}/${activeSubjects}`, score: facultyCoverageRate, detail: 'subjects assigned' },
      { label: 'Timetable coverage', value: timetableSlots, score: timetableCoverageRate, detail: 'active weekly slots' },
      { label: 'Exam planning', value: upcomingExams.length, score: upcomingExams.length ? 85 : (publishedExamCount ? 65 : 20), detail: 'upcoming exams in 30 days' },
      { label: 'Notice governance', value: recentNotices.length, score: recentNotices.length ? 90 : 35, detail: 'active notices' },
    ];

    res.json({
      success: true,
      dashboard: { 
        totalStudents, totalFaculty, totalParents, pendingFees, recentNotices, 
        monthlyStudents, feeStats, attendanceStats, recentStudents: recentStudentsWithFee, pendingLeaves,
        operationalInsights: {
          institutionHealthScore,
          academicDelivery,
          attendanceRate,
          collectionRate,
          parentLinkRate,
          facultyCoverageRate,
          timetableCoverageRate,
          campusServicesScore,
        },
        finance: {
          totalBilled,
          totalPaid,
          pendingAmount: feeLedger.pendingAmount || 0,
          overdueAmount: feeLedger.overdueAmount || 0,
          pendingInvoices: feeLedger.pendingInvoices || 0,
          overdueInvoices: feeLedger.overdueInvoices || 0,
          collectionRate,
        },
        academics: {
          activeCourses,
          activeSubjects,
          assignedSubjects,
          timetableSlots,
          upcomingExams: upcomingExams.map((exam) => ({
            id: exam._id,
            name: exam.name,
            subject: exam.subjectId?.name || 'Subject',
            code: exam.subjectId?.code || '',
            date: exam.date,
            venue: exam.venue,
          })),
          publishedExamCount,
          assignmentCount,
          submissionCount,
        },
        studentSuccess: {
          attendanceRate,
          passRate,
          averageScore,
          assignmentBacklog,
          inactiveStudents,
          linkedStudents,
          departmentMix,
        },
        operations: {
          activeRoutes,
          transportCapacity: routeSummary.capacity || 0,
          transportStudents: routeSummary.enrolled || 0,
          transportUtilization,
          hostelBlocks,
          hostelRooms: roomSummary.rooms || 0,
          hostelCapacity: roomSummary.capacity || 0,
          hostelOccupancy: roomSummary.occupied || 0,
          hostelUtilization,
          activeLiveClasses,
        },
        admissions: {
          enrolledStudents: totalStudents,
          recentEnrollments: recentStudents.length,
          inactiveStudents,
          parentLinkRate,
        },
        readiness,
        priorityQueue,
      },
    });
  });

// @desc    Get all students
const getStudents = asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, search = '', department, semester } = req.query;
    const query = { collegeId: req.user.collegeId, role: 'student' };
    if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { rollNo: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }];
    if (department) query.department = department;
    if (semester) query.semester = parseInt(semester);

    const students = await User.find(query)
      .select('-password')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ name: 1 });

    const total = await User.countDocuments(query);
    const feeStatusMap = new Map((await Fee.aggregate([
      { $match: { collegeId: req.user.collegeId, studentId: { $in: students.map((student) => student._id) } } },
      { $sort: { dueDate: -1, createdAt: -1 } },
      { $group: { _id: '$studentId', status: { $first: '$status' } } },
    ])).map((item) => [String(item._id), item.status]));

    const formatted = students.map((student) => ({
      ...student.toObject(),
      roll: student.rollNo,
      branch: student.department,
      sem: student.semester ? `Sem ${student.semester}` : '—',
      feeStatus: feeStatusMap.get(String(student._id)) || 'pending',
      active: student.isActive,
    }));

    res.json({ success: true, students: formatted, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  });

// @desc    Get all faculty
const getFaculty = asyncHandler(async (req, res) => {
    const query = { collegeId: req.user.collegeId, role: 'faculty' };
    const approvedLeaves = await Leave.find({
      collegeId: req.user.collegeId,
      status: 'approved',
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() },
    }).select('userId');

    const leaveSet = new Set(approvedLeaves.map((leave) => String(leave.userId)));
    const faculty = await User.find(query).select('-password').sort({ name: 1 });
    const formatted = faculty.map((member) => ({
      ...member.toObject(),
      dept: member.department,
      active: member.isActive,
      onLeave: leaveSet.has(String(member._id)),
    }));

    res.json({ success: true, faculty: formatted, total: formatted.length });
  });

// @desc    Create/update user (student/faculty/parent)
const createUser = asyncHandler(async (req, res) => {
    const role = req.body.role || (req.originalUrl.includes('faculty') ? 'faculty' : 'student');
    const userData = {
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
      role,
      collegeId: req.user.collegeId,
      phone: req.body.phone || req.body.fPhone || req.body.sPhone,
      address: req.body.address || req.body.sAddress,
      department: req.body.department || req.body.branch || req.body.dept,
      rollNo: req.body.rollNo || req.body.roll,
      semester: parseSemester(req.body.semester || req.body.sem),
      designation: req.body.designation || req.body.fDesig,
      section: req.body.section || req.body.sSection,
      enrollmentNo: req.body.enrollmentNo,
      admissionDate: req.body.admissionDate,
      dateOfBirth: req.body.dateOfBirth || req.body.sDob,
      gender: req.body.gender || req.body.sGender,
      bloodGroup: req.body.bloodGroup || req.body.sBloodGroup,
    };

    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) return res.status(400).json({ success: false, message: 'Email already exists' });

    if (role === 'student' && req.body.parentEmail) {
      const parentEmail = req.body.parentEmail.trim().toLowerCase();
      const existingParent = await User.findOne({ email: parentEmail });
      if (existingParent && existingParent.role !== 'parent') {
        return res.status(400).json({ success: false, message: 'Parent email is already used by another account' });
      }
    }

    const user = await User.create(userData);
    let parentCredentials = null;

    if (role === 'student' && req.body.parentEmail) {
      const parentEmail = req.body.parentEmail.trim().toLowerCase();
      let parent = await User.findOne({ email: parentEmail });

      if (!parent) {
        const generatedPassword = `Parent@${Date.now().toString().slice(-6)}`;
        parent = await User.create({
          name: req.body.parentName || req.body.sParent || `Parent of ${user.name}`,
          email: parentEmail,
          password: generatedPassword,
          role: 'parent',
          collegeId: req.user.collegeId,
          phone: req.body.parentPhone,
          children: [user._id],
        });
        parentCredentials = { email: parent.email, password: generatedPassword };
      } else if (!parent.children.some((childId) => String(childId) === String(user._id))) {
        parent.children.push(user._id);
        await parent.save();
      }

      user.parentId = parent._id;
      await user.save();
    }

    emitDataChange(req, {
      collegeId: String(req.user.collegeId),
      roles: ['superadmin'],
      resource: role === 'faculty' ? 'faculty' : 'students',
      action: 'created',
    });

    res.status(201).json({ success: true, message: 'User created', user, parentCredentials });
  });

// @desc    Update user
const updateUser = asyncHandler(async (req, res) => {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, collegeId: req.user.collegeId },
      req.body,
      { new: true }
    ).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'users', action: 'updated' });
    res.json({ success: true, message: 'User updated', user });
  });

// @desc    Toggle user active
const toggleUser = asyncHandler(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isActive = !user.isActive;
    await user.save();
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'users', action: 'toggled' });
    res.json({ success: true, message: `User ${user.isActive ? 'activated' : 'deactivated'}`, user });
  });

module.exports = { getCollegeDashboard, getStudents, getFaculty, createUser, updateUser, toggleUser };
