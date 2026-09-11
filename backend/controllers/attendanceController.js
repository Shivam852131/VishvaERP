const asyncHandler = require('../middleware/asyncHandler');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Timetable = require('../models/Timetable');
const { ClassroomLocation, LocationConsent, LivePresence } = require('../models/SmartAttendance');
const { emitDataChange } = require('../utils/realtime');
const { parseSemester } = require('../utils/parseHelpers');
const { logAudit } = require('../services/auditService');
const { sendParentNotification } = require('../services/parentNotificationService');

const SMART_PRESENCE_TTL_MINUTES = 90;
const TEACHER_HEARTBEAT_GRACE_MINUTES = 5;
const CLASS_GRACE_MINUTES = 15;
const LATE_AFTER_MINUTES = 10;
const DEFAULT_THRESHOLD = 75; // attendance % threshold for shortage alerts

/* ─── Helpers ─── */
const startOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const timeToMinutes = (value) => {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
};

const currentDayName = () => new Date().toLocaleDateString('en-US', { weekday: 'long' });

const currentTimeMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

const buildSessionKey = (slot, date = new Date()) => `${slot._id}:${startOfDay(date).toISOString().slice(0, 10)}`;

const distanceMeters = (aLat, aLng, bLat, bLng) => {
  const toRad = (value) => Number(value) * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const getActiveSlot = async (user, subjectId) => {
  const dayOfWeek = currentDayName();
  const nowMinutes = currentTimeMinutes();
  const query = { collegeId: user.collegeId, dayOfWeek, isActive: true };
  if (subjectId) query.subjectId = subjectId;
  if (user.role === 'faculty') query.facultyId = user._id;
  if (user.role === 'student') query.semester = user.semester;

  const slots = await Timetable.find(query)
    .populate('courseId', 'name code department')
    .populate('subjectId', 'name code semester')
    .populate('facultyId', 'name email')
    .sort({ startTime: 1 });

  const eligible = slots.filter((slot) => {
    if (user.role === 'student' && slot.courseId?.department && slot.courseId.department !== user.department) return false;
    const start = timeToMinutes(slot.startTime) - CLASS_GRACE_MINUTES;
    const end = timeToMinutes(slot.endTime) + CLASS_GRACE_MINUTES;
    return nowMinutes >= start && nowMinutes <= end;
  });

  return eligible[0] || null;
};

const getClassroomForSlot = async (collegeId, slot) => {
  if (!slot?.room) return null;
  return ClassroomLocation.findOne({
    collegeId,
    roomName: { $regex: `^${slot.room.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    isActive: true,
  });
};

const getRosterForSlot = async (collegeId, slot) => {
  if (!slot) return [];
  const query = {
    collegeId,
    role: 'student',
    isActive: true,
    semester: slot.semester,
  };
  if (slot.courseId?.department) query.department = slot.courseId.department;
  return User.find(query).select('name email rollNo department semester').sort({ rollNo: 1, name: 1 });
};

/* ─── Helper: compute summary for a student ─── */
const computeStudentSummary = async (collegeId, studentId, subjectId) => {
  const query = { collegeId, studentId };
  if (subjectId) query.subjectId = subjectId;
  const records = await Attendance.find(query).populate('subjectId', 'name code');

  const summary = {};
  records.forEach(record => {
    const key = record.subjectId?._id?.toString();
    if (!key) return;
    if (!summary[key]) {
      summary[key] = { subject: record.subjectId, total: 0, present: 0, absent: 0, late: 0, excused: 0 };
    }
    summary[key].total++;
    if (summary[key][record.status] !== undefined) summary[key][record.status]++;
  });

  Object.values(summary).forEach(s => {
    // Late counts as 0.5 present; excused does not count against
    const effective = s.present + s.late * 0.5;
    const countableTotal = s.total - s.excused;
    s.percentage = countableTotal > 0 ? ((effective / countableTotal) * 100).toFixed(1) : '100.0';
    s.isAtRisk = parseFloat(s.percentage) < DEFAULT_THRESHOLD;
    // How many more can they miss before dropping below threshold?
    const neededPresent = Math.ceil(DEFAULT_THRESHOLD / 100 * countableTotal) - effective;
    s.canStillMiss = neededPresent <= 0
      ? Math.floor((s.present + s.late * 0.5 - DEFAULT_THRESHOLD / 100 * countableTotal) / (DEFAULT_THRESHOLD / 100))
      : 0;
    // Classes needed to recover
    if (neededPresent > 0) {
      // Solve: (effective + x) / (countableTotal + x) >= 0.75
      const x = Math.ceil((DEFAULT_THRESHOLD / 100 * countableTotal - effective) / (1 - DEFAULT_THRESHOLD / 100));
      s.classesNeeded = Math.max(0, x);
    } else {
      s.classesNeeded = 0;
    }
  });

  return Object.values(summary);
};

/* ═══════════════════════════════════════════════
   EXISTING ENDPOINTS (enhanced)
═══════════════════════════════════════════════ */

// @desc    Mark attendance (bulk upsert)
// @route   POST /api/attendance/mark
const markAttendance = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const facultyId = req.user._id;

  let { subjectId, date, attendanceRecords } = req.body;

  if (!subjectId && req.body.subject) {
    const resolvedSubject = await Subject.findOne({
      collegeId,
      $or: [
        { code: { $regex: req.body.subject, $options: 'i' } },
        { name: { $regex: req.body.subject, $options: 'i' } },
      ],
      ...(parseSemester(req.body.batch || req.body.semester) ? { semester: parseSemester(req.body.batch || req.body.semester) } : {}),
    });
    subjectId = resolvedSubject?._id;
  }

  if (!attendanceRecords && req.body.attendance && typeof req.body.attendance === 'object') {
    const rolls = Object.keys(req.body.attendance);
    const students = await User.find({ collegeId, role: 'student', rollNo: { $in: rolls } }).select('_id rollNo');
    attendanceRecords = students.map((student) => ({
      studentId: student._id,
      status: req.body.attendance[student.rollNo],
      remarks: '',
    }));
  }

  if (!subjectId || !Array.isArray(attendanceRecords) || !attendanceRecords.length) {
    return res.status(400).json({ success: false, message: 'Subject and attendance records are required' });
  }

  const attendanceDate = date ? startOfDay(date) : startOfDay();
  const operations = attendanceRecords.map(record => ({
    updateOne: {
      filter: { collegeId, studentId: record.studentId, subjectId, date: attendanceDate },
      update: {
        $set: {
          status: record.status,
          remarks: record.remarks || '',
          facultyId,
          source: record.source || 'manual',
          verificationMethod: record.verificationMethod || 'manual',
          ...(record.status === 'excused' ? {
            excuseReason: record.excuseReason || '',
            excusedBy: facultyId,
            excusedAt: new Date(),
          } : {}),
        },
      },
      upsert: true,
    },
  }));

  await Attendance.bulkWrite(operations);
  logAudit(req, 'create', 'attendance', {
    description: `Marked attendance for ${attendanceRecords.length} students`,
    metadata: { subjectId, date: attendanceDate },
  });
  emitDataChange(req, {
    collegeId: String(collegeId),
    roles: ['superadmin', 'collegeAdmin'],
    resource: 'attendance',
    action: 'marked',
  });

  // Async parent notifications (fire & forget)
  (async () => {
    try {
      const studentIds = attendanceRecords.map(r => r.studentId);
      const students = await User.find({ _id: { $in: studentIds }, collegeId }).select('name parentId');
      const subjectDoc = await Subject.findById(subjectId).select('name');
      for (const record of attendanceRecords) {
        const student = students.find(s => String(s._id) === String(record.studentId));
        if (!student?.parentId) continue;
        const allRecords = await Attendance.find({ collegeId, studentId: student._id });
        const total = allRecords.filter(r => r.status !== 'excused').length;
        const present = allRecords.filter(r => r.status === 'present' || r.status === 'late').length;
        const percentage = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0;
        sendParentNotification(student.parentId, 'attendance', {
          studentName: student.name,
          date: attendanceDate.toISOString().slice(0, 10),
          status: record.status,
          subject: subjectDoc?.name || '',
          percentage,
        }).catch(() => {});
      }
    } catch (_) {}
  })();

  res.json({ success: true, message: `Attendance marked for ${attendanceRecords.length} students` });
});

// @desc    Get attendance records
// @route   GET /api/attendance
const getAttendance = asyncHandler(async (req, res) => {
  const { subjectId, date, studentId } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (subjectId) query.subjectId = subjectId;
  if (date) query.date = startOfDay(date);
  if (studentId) query.studentId = studentId;

  if (req.user.role === 'student') {
    query.studentId = req.user._id;
  }

  if (req.user.role === 'parent') {
    const parent = await User.findById(req.user._id).select('children');
    query.studentId = req.query.studentId && (parent?.children || []).some((childId) => String(childId) === String(req.query.studentId))
      ? req.query.studentId
      : parent?.children?.[0];
  }

  const attendance = await Attendance.find(query)
    .populate('studentId', 'name rollNo')
    .populate('subjectId', 'name code')
    .populate('excusedBy', 'name')
    .populate('correctedBy', 'name')
    .sort({ date: -1 });

  res.json({ success: true, attendance });
});

// @desc    Get student attendance summary (subject-wise)
// @route   GET /api/attendance/summary/:studentId?
const getStudentAttendanceSummary = asyncHandler(async (req, res) => {
  let studentId = req.params.studentId || req.user._id;
  const { subjectId } = req.query;
  const collegeId = req.user.collegeId;

  if (req.user.role === 'parent' && !req.params.studentId) {
    const parent = await User.findById(req.user._id).select('children');
    studentId = parent?.children?.[0];
  }

  if (!studentId) return res.json({ success: true, summary: [] });

  const summary = await computeStudentSummary(collegeId, studentId, subjectId);
  res.json({ success: true, summary });
});

// @desc    Get student attendance calendar (daily status for heatmap)
// @route   GET /api/attendance/calendar/:studentId?
const getStudentCalendar = asyncHandler(async (req, res) => {
  let studentId = req.params.studentId || req.user._id;
  const collegeId = req.user.collegeId;
  const { days = 90, subjectId } = req.query;

  if (req.user.role === 'parent' && !req.params.studentId) {
    const parent = await User.findById(req.user._id).select('children');
    studentId = parent?.children?.[0];
  }

  if (!studentId) return res.json({ success: true, calendar: [] });

  const since = new Date();
  since.setDate(since.getDate() - Number(days));

  const query = { collegeId, studentId, date: { $gte: startOfDay(since) } };
  if (subjectId) query.subjectId = subjectId;

  const records = await Attendance.find(query)
    .populate('subjectId', 'name code')
    .sort({ date: 1 });

  // Group by date → summarize: if any subject absent that day → absent; all present → present
  const byDate = {};
  records.forEach(r => {
    const dateKey = r.date.toISOString().slice(0, 10);
    if (!byDate[dateKey]) byDate[dateKey] = { date: dateKey, statuses: [], subjects: [] };
    byDate[dateKey].statuses.push(r.status);
    byDate[dateKey].subjects.push({ name: r.subjectId?.name, code: r.subjectId?.code, status: r.status });
  });

  const calendar = Object.values(byDate).map(d => {
    const hasAbsent = d.statuses.includes('absent');
    const hasLate = d.statuses.includes('late');
    const allExcused = d.statuses.every(s => s === 'excused');
    let dayStatus = 'present';
    if (allExcused) dayStatus = 'excused';
    else if (hasAbsent) dayStatus = 'absent';
    else if (hasLate) dayStatus = 'late';
    return { date: d.date, status: dayStatus, subjects: d.subjects, total: d.statuses.length };
  });

  res.json({ success: true, calendar });
});

// @desc    Get students at shortage risk (below threshold)
// @route   GET /api/attendance/shortage
const getShortageAlerts = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const threshold = Number(req.query.threshold) || DEFAULT_THRESHOLD;
  const { semester, department, subjectId } = req.query;

  // Aggregate attendance per student per subject
  const pipeline = [
    { $match: { collegeId } },
    {
      $group: {
        _id: { studentId: '$studentId', subjectId: '$subjectId' },
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
        excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
      },
    },
    {
      $addFields: {
        countableTotal: { $subtract: ['$total', '$excused'] },
      },
    },
    {
      $addFields: {
        percentage: {
          $cond: [
            { $gt: ['$countableTotal', 0] },
            { $multiply: [{ $divide: ['$present', '$countableTotal'] }, 100] },
            100,
          ],
        },
      },
    },
    { $match: { percentage: { $lt: threshold }, countableTotal: { $gte: 3 } } },
    {
      $lookup: { from: 'users', localField: '_id.studentId', foreignField: '_id', as: 'student' },
    },
    { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
    {
      $lookup: { from: 'subjects', localField: '_id.subjectId', foreignField: '_id', as: 'subject' },
    },
    { $unwind: { path: '$subject', preserveNullAndEmptyArrays: true } },
    { $sort: { percentage: 1 } },
  ];

  if (semester) pipeline.splice(1, 0, { $match: {} }); // placeholder, handled below
  if (subjectId) pipeline[0].$match.subjectId = new (require('mongoose').Types.ObjectId)(subjectId);

  let results = await Attendance.aggregate(pipeline);

  // Filter by semester/department after lookup
  if (semester) results = results.filter(r => r.student?.semester == semester);
  if (department) results = results.filter(r => r.student?.department === department);

  const shortage = results.map(r => {
    const classesNeeded = r.countableTotal > 0
      ? Math.max(0, Math.ceil((threshold / 100 * r.countableTotal - r.present) / (1 - threshold / 100)))
      : 0;
    return {
      studentId: r._id.studentId,
      subjectId: r._id.subjectId,
      name: r.student?.name || 'Unknown',
      rollNo: r.student?.rollNo || '',
      email: r.student?.email || '',
      parentId: r.student?.parentId,
      semester: r.student?.semester,
      department: r.student?.department,
      subjectName: r.subject?.name || 'Unknown',
      subjectCode: r.subject?.code || '',
      total: r.total,
      present: r.present,
      absent: r.absent,
      excused: r.excused,
      percentage: Number(r.percentage.toFixed(1)),
      classesNeeded,
    };
  });

  res.json({ success: true, shortage, threshold, count: shortage.length });
});

// @desc    Get attendance streak for a student
// @route   GET /api/attendance/streak/:studentId?
const getAttendanceStreak = asyncHandler(async (req, res) => {
  let studentId = req.params.studentId || req.user._id;
  const collegeId = req.user.collegeId;

  if (req.user.role === 'parent' && !req.params.studentId) {
    const parent = await User.findById(req.user._id).select('children');
    studentId = parent?.children?.[0];
  }

  if (!studentId) return res.json({ success: true, currentStreak: 0, longestStreak: 0 });

  const records = await Attendance.find({ collegeId, studentId }).sort({ date: 1 });

  // Group by date
  const byDate = {};
  records.forEach(r => {
    const key = r.date.toISOString().slice(0, 10);
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(r.status);
  });

  const dates = Object.keys(byDate).sort();
  let currentStreak = 0;
  let longestStreak = 0;
  let streak = 0;

  for (const date of dates) {
    const statuses = byDate[date];
    const hasAbsent = statuses.includes('absent');
    if (!hasAbsent) {
      streak++;
      longestStreak = Math.max(longestStreak, streak);
    } else {
      streak = 0;
    }
  }
  currentStreak = streak;

  res.json({ success: true, currentStreak, longestStreak, totalDays: dates.length });
});

// @desc    Bulk excuse students
// @route   POST /api/attendance/bulk-excuse
const bulkExcuse = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const { studentIds, subjectId, date, excuseReason } = req.body;

  if (!Array.isArray(studentIds) || !studentIds.length || !subjectId || !excuseReason) {
    return res.status(400).json({ success: false, message: 'studentIds, subjectId and excuseReason are required' });
  }

  const attendanceDate = date ? startOfDay(date) : startOfDay();
  const operations = studentIds.map(studentId => ({
    updateOne: {
      filter: { collegeId, studentId, subjectId, date: attendanceDate },
      update: {
        $set: {
          status: 'excused',
          excuseReason,
          excusedBy: req.user._id,
          excusedAt: new Date(),
          source: 'manual',
        },
      },
      upsert: true,
    },
  }));

  await Attendance.bulkWrite(operations);
  logAudit(req, 'update', 'attendance', {
    description: `Bulk excused ${studentIds.length} students for subject ${subjectId}`,
    metadata: { subjectId, date: attendanceDate, excuseReason },
  });

  res.json({ success: true, message: `${studentIds.length} students excused`, excused: studentIds.length });
});

// @desc    Correct a single attendance record (with audit trail)
// @route   PATCH /api/attendance/:id/correct
const correctAttendanceRecord = asyncHandler(async (req, res) => {
  const { status, remarks, excuseReason } = req.body;
  const collegeId = req.user.collegeId;

  const record = await Attendance.findOne({ _id: req.params.id, collegeId });
  if (!record) {
    return res.status(404).json({ success: false, message: 'Attendance record not found' });
  }

  const previousStatus = record.status;
  record.previousStatus = previousStatus;
  record.status = status || record.status;
  record.remarks = remarks !== undefined ? remarks : record.remarks;
  record.correctedBy = req.user._id;
  record.correctedAt = new Date();
  if (status === 'excused') {
    record.excuseReason = excuseReason || '';
    record.excusedBy = req.user._id;
    record.excusedAt = new Date();
  }
  await record.save();

  logAudit(req, 'update', 'attendance', {
    resourceId: record._id,
    description: `Corrected attendance: ${previousStatus} → ${record.status}`,
    metadata: { previousStatus, newStatus: record.status, studentId: record.studentId },
  });

  res.json({ success: true, message: 'Attendance record corrected', record });
});

// @desc    Export attendance as CSV data
// @route   GET /api/attendance/export
const exportAttendance = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const { subjectId, startDate, endDate, studentId, semester, format = 'json' } = req.query;

  const query = { collegeId };
  if (subjectId) query.subjectId = subjectId;
  if (studentId) query.studentId = studentId;
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = startOfDay(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.date.$lte = end;
    }
  }

  const records = await Attendance.find(query)
    .populate('studentId', 'name rollNo email semester department')
    .populate('subjectId', 'name code')
    .populate('facultyId', 'name')
    .sort({ date: 1, 'studentId.rollNo': 1 });

  // Filter by semester if provided
  const filtered = semester
    ? records.filter(r => r.studentId?.semester == semester)
    : records;

  if (format === 'csv') {
    const headers = ['Date', 'Roll No', 'Student Name', 'Department', 'Semester', 'Subject', 'Subject Code', 'Status', 'Source', 'Remarks', 'Faculty'];
    const rows = filtered.map(r => [
      r.date.toISOString().slice(0, 10),
      r.studentId?.rollNo || '',
      r.studentId?.name || '',
      r.studentId?.department || '',
      r.studentId?.semester || '',
      r.subjectId?.name || '',
      r.subjectId?.code || '',
      r.status,
      r.source || 'manual',
      (r.remarks || '').replace(/,/g, ';'),
      r.facultyId?.name || '',
    ]);
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance_export_${Date.now()}.csv"`);
    return res.send(csv);
  }

  res.json({ success: true, records: filtered, total: filtered.length });
});

/* ═══════════════════════════════════════════════
   SMART ATTENDANCE (existing, kept intact)
═══════════════════════════════════════════════ */

const getLocationConsent = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ success: false, message: 'Only students can view their smart attendance consent' });
  }
  const consent = await LocationConsent.findOne({ collegeId: req.user.collegeId, studentId: req.user._id });
  res.json({
    success: true,
    consent: consent || { enabled: false, consentVersion: 'smart-attendance-v1' },
  });
});

const updateLocationConsent = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ success: false, message: 'Only students can update smart attendance consent' });
  }
  const enabled = Boolean(req.body.enabled);
  const now = new Date();
  const update = {
    $set: {
      enabled,
      consentVersion: 'smart-attendance-v1',
      grantedBy: req.user._id,
      ...(enabled ? { grantedAt: now } : { revokedAt: now }),
    },
    $unset: enabled ? { revokedAt: '' } : { grantedAt: '' },
  };
  const consent = await LocationConsent.findOneAndUpdate(
    { collegeId: req.user.collegeId, studentId: req.user._id },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ success: true, consent });
});

const upsertClassroomLocation = asyncHandler(async (req, res) => {
  const { roomName, building, floor, latitude, longitude, radiusMeters = 35 } = req.body;
  if (!roomName || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ success: false, message: 'Room name, latitude, and longitude are required' });
  }

  const classroom = await ClassroomLocation.findOneAndUpdate(
    { collegeId: req.user.collegeId, roomName: roomName.trim() },
    {
      roomName: roomName.trim(),
      building,
      floor,
      latitude: Number(latitude),
      longitude: Number(longitude),
      radiusMeters: Math.max(5, Math.min(250, Number(radiusMeters) || 35)),
      isActive: true,
      createdBy: req.user._id,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logAudit(req, 'create', 'classroom_location', {
    resourceId: classroom._id,
    description: `Upserted classroom location: ${roomName}`,
    metadata: { roomName },
  });
  res.json({ success: true, classroom });
});

const publishLiveLocation = asyncHandler(async (req, res) => {
  if (!['student', 'faculty'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Live smart attendance is available for students and faculty only' });
  }

  const { latitude, longitude, accuracyMeters = 0, subjectId } = req.body;
  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ success: false, message: 'Latitude and longitude are required' });
  }

  if (req.user.role === 'student') {
    const consent = await LocationConsent.findOne({ collegeId: req.user.collegeId, studentId: req.user._id, enabled: true });
    if (!consent) {
      return res.status(403).json({ success: false, message: 'Smart attendance location consent is not enabled' });
    }
  }

  const slot = await getActiveSlot(req.user, subjectId);
  if (!slot) {
    return res.json({ success: true, active: false, message: 'No scheduled class is active for this user right now' });
  }

  const now = new Date();
  const sessionKey = buildSessionKey(slot, now);
  const classroom = await getClassroomForSlot(req.user.collegeId, slot);
  const expiresAt = new Date(now.getTime() + SMART_PRESENCE_TTL_MINUTES * 60 * 1000);
  let status = 'noClassroom';
  let distance = null;
  let teacherPresent = false;
  let autoAttendanceStatus = 'none';

  if (classroom) {
    distance = distanceMeters(Number(latitude), Number(longitude), classroom.latitude, classroom.longitude);
    const accuracyBuffer = Math.min(Number(accuracyMeters) || 0, 20);
    const isInside = distance <= classroom.radiusMeters + accuracyBuffer;
    status = isInside ? 'inside' : 'outside';

    if (req.user.role === 'student' && isInside) {
      const teacherPresenceCutoff = new Date(now.getTime() - TEACHER_HEARTBEAT_GRACE_MINUTES * 60 * 1000);
      const teacherPresence = await LivePresence.findOne({
        sessionKey,
        role: 'faculty',
        status: 'inside',
        lastSeenAt: { $gte: teacherPresenceCutoff },
      });
      teacherPresent = Boolean(teacherPresence);
      status = teacherPresent ? 'inside' : 'waitingTeacher';

      if (teacherPresent) {
        const late = currentTimeMinutes() > timeToMinutes(slot.startTime) + LATE_AFTER_MINUTES;
        autoAttendanceStatus = late ? 'late' : 'present';
        await Attendance.updateOne(
          {
            collegeId: req.user.collegeId,
            studentId: req.user._id,
            subjectId: slot.subjectId._id || slot.subjectId,
            date: startOfDay(now),
          },
          {
            $set: {
              facultyId: slot.facultyId?._id || slot.facultyId,
              status: autoAttendanceStatus,
              source: 'smart-location',
              verificationMethod: 'smart-location',
              timetableId: slot._id,
              classroomId: classroom._id,
              lastSeenAt: now,
              confidence: Math.max(0, Math.min(100, 100 - Math.round(Number(accuracyMeters) || 0))),
              remarks: `Auto-marked by smart attendance in ${slot.room}`,
            },
            $setOnInsert: { firstSeenAt: now },
          },
          { upsert: true }
        );
        logAudit(req, 'create', 'attendance', {
          description: `Auto-marked attendance for student via smart location`,
          metadata: { subjectId: slot.subjectId?._id || slot.subjectId, status: autoAttendanceStatus },
        });
      } else {
        autoAttendanceStatus = 'waiting';
      }
    }
  }

  const previous = await LivePresence.findOne({ sessionKey, userId: req.user._id });
  const update = {
    collegeId: req.user.collegeId,
    userId: req.user._id,
    role: req.user.role,
    studentId: req.user.role === 'student' ? req.user._id : undefined,
    facultyId: req.user.role === 'faculty' ? req.user._id : slot.facultyId?._id || slot.facultyId,
    subjectId: slot.subjectId._id || slot.subjectId,
    timetableId: slot._id,
    classroomId: classroom?._id,
    sessionKey,
    status,
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracyMeters: Number(accuracyMeters) || 0,
    distanceMeters: distance,
    lastSeenAt: now,
    expiresAt,
    autoAttendanceStatus,
  };

  if ((status === 'inside' || status === 'waitingTeacher') && !previous?.enteredAt) update.enteredAt = now;
  if (status === 'outside') update.exitedAt = now;

  const presence = await LivePresence.findOneAndUpdate(
    { sessionKey, userId: req.user._id },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    userIds: [String(slot.facultyId?._id || slot.facultyId)],
    resource: 'smart-attendance',
    action: 'presence-updated',
  });

  res.json({
    success: true,
    active: true,
    presence,
    teacherPresent: req.user.role === 'faculty' ? status === 'inside' : teacherPresent,
    classroom,
    activeSlot: {
      id: slot._id,
      subject: slot.subjectId?.name,
      subjectCode: slot.subjectId?.code,
      room: slot.room,
      startTime: slot.startTime,
      endTime: slot.endTime,
    },
  });
});

const getLiveClassPresence = asyncHandler(async (req, res) => {
  const slot = await getActiveSlot(req.user, req.query.subjectId);
  if (!slot) {
    return res.json({ success: true, active: false, message: 'No active scheduled class found' });
  }

  const sessionKey = buildSessionKey(slot);
  const [classroom, roster, presences, records] = await Promise.all([
    getClassroomForSlot(req.user.collegeId, slot),
    getRosterForSlot(req.user.collegeId, slot),
    LivePresence.find({ sessionKey }).populate('userId', 'name rollNo email role'),
    Attendance.find({ collegeId: req.user.collegeId, subjectId: slot.subjectId._id || slot.subjectId, date: startOfDay() }),
  ]);

  const presenceMap = new Map(presences.filter((item) => item.role === 'student').map((item) => [String(item.studentId || item.userId?._id || item.userId), item]));
  const attendanceMap = new Map(records.map((item) => [String(item.studentId), item]));
  const facultyPresence = presences.find((item) => item.role === 'faculty');

  const students = roster.map((student) => {
    const presence = presenceMap.get(String(student._id));
    const attendance = attendanceMap.get(String(student._id));
    return {
      id: student._id,
      name: student.name,
      rollNo: student.rollNo,
      status: presence?.status || 'outside',
      distanceMeters: presence?.distanceMeters,
      lastSeenAt: presence?.lastSeenAt,
      enteredAt: presence?.enteredAt,
      autoAttendanceStatus: presence?.autoAttendanceStatus || attendance?.status || 'none',
      attendanceStatus: attendance?.status || 'notMarked',
      confidence: attendance?.confidence,
    };
  });

  const presentCount = students.filter((student) => ['inside', 'waitingTeacher'].includes(student.status)).length;

  res.json({
    success: true,
    active: true,
    sessionKey,
    classroom,
    facultyPresent: facultyPresence?.status === 'inside',
    activeSlot: {
      id: slot._id,
      subject: slot.subjectId?.name,
      subjectCode: slot.subjectId?.code,
      room: slot.room,
      startTime: slot.startTime,
      endTime: slot.endTime,
      faculty: slot.facultyId?.name,
    },
    totalStudents: students.length,
    presentCount,
    students,
  });
});

// @desc    Get all classroom locations
const getClassroomLocations = asyncHandler(async (req, res) => {
  const classrooms = await ClassroomLocation.find({ collegeId: req.user.collegeId })
    .populate('createdBy', 'name')
    .sort({ roomName: 1 });
  res.json({ success: true, classrooms });
});

// @desc    Delete a classroom location
const deleteClassroomLocation = asyncHandler(async (req, res) => {
  const classroom = await ClassroomLocation.findOneAndDelete({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });
  if (!classroom) {
    return res.status(404).json({ success: false, message: 'Classroom not found' });
  }
  res.json({ success: true, message: 'Classroom location deleted' });
});

// @desc    Get college-wide attendance analytics
// @route   GET /api/attendance/analytics
const getAttendanceAnalytics = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const { days = 30, subjectId, semester } = req.query;
  const since = new Date();
  since.setDate(since.getDate() - Number(days));

  const matchQuery = { collegeId, date: { $gte: since } };
  if (subjectId) matchQuery.subjectId = subjectId;

  const [overallStats, dailyTrends, subjectWise, sourceBreakdown, topAbsentees, weeklyHeatmap] = await Promise.all([
    Attendance.aggregate([
      { $match: matchQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Attendance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Attendance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$subjectId',
          present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
      { $lookup: { from: 'subjects', localField: '_id', foreignField: '_id', as: 'subject' } },
      { $unwind: { path: '$subject', preserveNullAndEmptyArrays: true } },
      { $sort: { total: -1 } },
    ]),
    Attendance.aggregate([
      { $match: matchQuery },
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]),
    Attendance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$studentId',
          total: { $sum: 1 },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
        },
      },
      { $addFields: { absenceRate: { $divide: ['$absent', '$total'] } } },
      { $match: { total: { $gte: 3 }, absenceRate: { $gte: 0.3 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'student' } },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
      { $sort: { absenceRate: -1 } },
      { $limit: 20 },
    ]),
    // Weekly heatmap: day-of-week × attendance rate
    Attendance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { dayOfWeek: { $dayOfWeek: '$date' } },
          present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
      {
        $addFields: {
          rate: { $cond: [{ $gt: ['$total', 0] }, { $multiply: [{ $divide: ['$present', '$total'] }, 100] }, 0] },
        },
      },
      { $sort: { '_id.dayOfWeek': 1 } },
    ]),
  ]);

  const totalRecords = overallStats.reduce((s, r) => s + r.count, 0);
  const presentCount = overallStats.find(r => r._id === 'present')?.count || 0;
  const lateCount = overallStats.find(r => r._id === 'late')?.count || 0;
  const absentCount = overallStats.find(r => r._id === 'absent')?.count || 0;
  const excusedCount = overallStats.find(r => r._id === 'excused')?.count || 0;

  res.json({
    success: true,
    analytics: {
      overall: {
        total: totalRecords,
        present: presentCount,
        absent: absentCount,
        late: lateCount,
        excused: excusedCount,
        rate: totalRecords > 0 ? ((presentCount + lateCount * 0.5) / (totalRecords - excusedCount) * 100).toFixed(1) : 0,
      },
      dailyTrends,
      subjectWise: subjectWise.map(s => ({
        subjectId: s._id,
        name: s.subject?.name || 'Unknown',
        code: s.subject?.code || '',
        present: s.present,
        absent: s.absent,
        late: s.late,
        excused: s.excused,
        total: s.total,
        rate: (s.total - s.excused) > 0 ? ((s.present + s.late * 0.5) / (s.total - s.excused) * 100).toFixed(1) : 0,
      })),
      sourceBreakdown: sourceBreakdown.map(s => ({ source: s._id || 'manual', count: s.count })),
      topAbsentees: topAbsentees.map(a => ({
        studentId: a._id,
        name: a.student?.name || 'Unknown',
        rollNo: a.student?.rollNo || '',
        email: a.student?.email || '',
        semester: a.student?.semester,
        department: a.student?.department,
        total: a.total,
        absent: a.absent,
        present: a.present,
        absenceRate: (a.absenceRate * 100).toFixed(1),
      })),
      weeklyHeatmap,
    },
  });
});

// @desc    Send notifications to absentees' parents
const notifyAbsentees = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const { date, subjectId } = req.body;
  const targetDate = date ? startOfDay(date) : startOfDay();

  const absentQuery = { collegeId, date: targetDate, status: 'absent' };
  if (subjectId) absentQuery.subjectId = subjectId;

  const absentRecords = await Attendance.find(absentQuery)
    .populate('studentId', 'name rollNo')
    .populate('subjectId', 'name code');

  const studentIds = [...new Set(absentRecords.map(r => String(r.studentId?._id)).filter(Boolean))];
  if (!studentIds.length) {
    return res.json({ success: true, message: 'No absentees found', notified: 0 });
  }

  const students = await User.find({ _id: { $in: studentIds }, collegeId })
    .select('name rollNo parentEmail parentName');

  let notifiedCount = 0;
  for (const student of students) {
    if (!student.parentEmail) continue;
    const subjects = absentRecords
      .filter(r => String(r.studentId?._id) === String(student._id))
      .map(r => r.subjectId?.name || r.subjectId?.code || 'Unknown')
      .join(', ');

    try {
      const { sendMail } = require('../services/emailService');
      await sendMail({
        to: student.parentEmail,
        subject: `Attendance Alert — ${student.name} was absent`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <div style="background:linear-gradient(135deg,#4F46E5,#7C3AED);color:white;padding:20px;border-radius:12px 12px 0 0">
              <h2 style="margin:0;font-size:18px">⚠️ Attendance Alert</h2>
            </div>
            <div style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
              <p>Dear Parent,</p>
              <p>Your child <strong>${student.name}</strong> (Roll: ${student.rollNo || '–'}) was marked
                <span style="color:#ef4444;font-weight:700">ABSENT</span> on
                ${targetDate.toLocaleDateString('en-IN')}.</p>
              <p><strong>Subjects:</strong> ${subjects}</p>
              <p>Please contact the college administration if you have any questions.</p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
              <p style="font-size:12px;color:#94a3b8">This is an automated notification from VishvaERP.</p>
            </div>
          </div>
        `,
      });
      notifiedCount++;
    } catch (err) {
      // Email not configured, skip
    }
  }

  logAudit(req, 'notify', 'attendance', {
    description: `Sent absentee notifications to ${notifiedCount} parents`,
    metadata: { date: targetDate, subjectId, notifiedCount },
  });

  res.json({ success: true, message: `Notified ${notifiedCount} parents`, notified: notifiedCount });
});

// @desc    Get timetable slots
const getTimetableSlots = asyncHandler(async (req, res) => {
  const { dayOfWeek, semester, courseId } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };
  if (dayOfWeek) query.dayOfWeek = dayOfWeek;
  if (semester) query.semester = Number(semester);
  if (courseId) query.courseId = courseId;

  const slots = await Timetable.find(query)
    .populate('courseId', 'name code department')
    .populate('subjectId', 'name code')
    .populate('facultyId', 'name email')
    .sort({ dayOfWeek: 1, startTime: 1 });

  res.json({ success: true, slots });
});

// @desc    Get attendance heatmap data
const getAttendanceHeatmap = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const { weeks = 12 } = req.query;
  const since = new Date();
  since.setDate(since.getDate() - Number(weeks) * 7);

  const data = await Attendance.aggregate([
    { $match: { collegeId, date: { $gte: since } } },
    {
      $group: {
        _id: {
          dayOfWeek: { $dayOfWeek: '$date' },
          week: { $week: '$date' },
        },
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
    {
      $addFields: {
        rate: {
          $cond: [{ $gt: ['$total', 0] }, { $multiply: [{ $divide: ['$present', '$total'] }, 100] }, 0],
        },
      },
    },
  ]);

  res.json({ success: true, heatmap: data });
});

module.exports = {
  markAttendance,
  getAttendance,
  getStudentAttendanceSummary,
  getStudentCalendar,
  getShortageAlerts,
  getAttendanceStreak,
  bulkExcuse,
  correctAttendanceRecord,
  exportAttendance,
  getLocationConsent,
  updateLocationConsent,
  upsertClassroomLocation,
  publishLiveLocation,
  getLiveClassPresence,
  getClassroomLocations,
  deleteClassroomLocation,
  getAttendanceAnalytics,
  notifyAbsentees,
  getTimetableSlots,
  getAttendanceHeatmap,
};
