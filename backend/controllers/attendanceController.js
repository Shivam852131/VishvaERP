const asyncHandler = require('../middleware/asyncHandler');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Timetable = require('../models/Timetable');
const { ClassroomLocation, LocationConsent, LivePresence } = require('../models/SmartAttendance');
const { emitDataChange } = require('../utils/realtime');
const { parseSemester } = require('../utils/parseHelpers');
const { logAudit } = require('../services/auditService');

const SMART_PRESENCE_TTL_MINUTES = 90;
const TEACHER_HEARTBEAT_GRACE_MINUTES = 5;
const CLASS_GRACE_MINUTES = 15;
const LATE_AFTER_MINUTES = 10;

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
      roomName: { $regex: `^${escapeRegex(slot.room)}$`, $options: 'i' },
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

// @desc    Mark attendance
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
        update: { $set: { status: record.status, remarks: record.remarks, facultyId, source: 'manual' } },
        upsert: true,
      },
    }));

    await Attendance.bulkWrite(operations);
    logAudit(req, 'create', 'attendance', { description: `Marked attendance for ${req.body.attendanceRecords?.length || 0} students`, metadata: { subjectId: req.body.subjectId } });
    emitDataChange(req, {
      collegeId: String(collegeId),
      roles: ['superadmin'],
      resource: 'attendance',
      action: 'marked',
    });
    res.json({ success: true, message: 'Attendance marked successfully' });
  });

// @desc    Get attendance for a subject/date
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
      .sort({ date: -1 });

    res.json({ success: true, attendance });
  });

// @desc    Get student attendance summary
const getStudentAttendanceSummary = asyncHandler(async (req, res) => {
    let studentId = req.params.studentId || req.user._id;
    const { subjectId } = req.query;
    const collegeId = req.user.collegeId;

    if (req.user.role === 'parent' && !req.params.studentId) {
      const parent = await User.findById(req.user._id).select('children');
      studentId = parent?.children?.[0];
    }

    if (!studentId) {
      return res.json({ success: true, summary: [] });
    }

    const query = { collegeId, studentId };
    if (subjectId) query.subjectId = subjectId;

    const records = await Attendance.find(query).populate('subjectId', 'name code');
    
    // Group by subject
    const summary = {};
    records.forEach(record => {
      const key = record.subjectId?._id?.toString();
      if (!summary[key]) {
        summary[key] = { subject: record.subjectId, total: 0, present: 0, absent: 0, late: 0 };
      }
      summary[key].total++;
      summary[key][record.status]++;
    });

    // Calculate percentage
    Object.values(summary).forEach(s => {
      s.percentage = s.total > 0 ? ((s.present + s.late * 0.5) / s.total * 100).toFixed(1) : 0;
    });

    res.json({ success: true, summary: Object.values(summary) });
  });

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

    logAudit(req, 'create', 'classroom_location', { resourceId: classroom._id, description: `Upserted classroom location: ${roomName}`, metadata: { roomName } });
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
            { collegeId: req.user.collegeId, studentId: req.user._id, subjectId: slot.subjectId._id || slot.subjectId, date: startOfDay(now) },
            {
              $set: {
                facultyId: slot.facultyId?._id || slot.facultyId,
                status: autoAttendanceStatus,
                source: 'smart-location',
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
          logAudit(req, 'create', 'attendance', { description: `Auto-marked attendance for student via smart location`, metadata: { subjectId: slot.subjectId?._id || slot.subjectId, status: autoAttendanceStatus } });
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

module.exports = {
  markAttendance,
  getAttendance,
  getStudentAttendanceSummary,
  getLocationConsent,
  updateLocationConsent,
  upsertClassroomLocation,
  publishLiveLocation,
  getLiveClassPresence,
};
