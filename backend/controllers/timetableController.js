const asyncHandler = require('../middleware/asyncHandler');
const Timetable = require('../models/Timetable');
const Subject = require('../models/Subject');
const Course = require('../models/Course');
const User = require('../models/User');
const { emitDataChange } = require('../utils/realtime');
const { parseSemester } = require('../utils/parseHelpers');
const { logAudit } = require('../services/auditService');

/**
 * Helper: Convert "HH:MM" (24h) to minutes from midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.trim().split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

/**
 * Helper: Check if two time intervals overlap: [s1, e1) and [s2, e2)
 */
function isOverlapping(s1, e1, s2, e2) {
  return Math.max(s1, s2) < Math.min(e1, e2);
}

/**
 * Helper: Day mapping for iCalendar RRULE BYDAY
 */
const DAY_ICS_MAP = {
  Monday: 'MO',
  Tuesday: 'TU',
  Wednesday: 'WE',
  Thursday: 'TH',
  Friday: 'FR',
  Saturday: 'SA',
  Sunday: 'SU',
};

// @desc    Get timetable slots
// @route   GET /api/timetable
// @access  Authenticated
const getTimetable = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId, isActive: true };

  // Role-based filtering defaults
  if (req.user.role === 'faculty') {
    if (req.query.viewAll !== 'true') {
      query.facultyId = req.user._id;
    }
  } else if (req.user.role === 'student') {
    if (req.user.semester) query.semester = req.user.semester;
    if (req.user.department) {
      const courses = await Course.find({ collegeId: req.user.collegeId, department: req.user.department }).select('_id');
      if (courses.length > 0) {
        query.courseId = { $in: courses.map((c) => c._id) };
      }
    }
  }

  // Explicit query filters
  if (req.query.facultyId) query.facultyId = req.query.facultyId;
  if (req.query.semester) query.semester = parseSemester(req.query.semester);
  if (req.query.courseId) query.courseId = req.query.courseId;
  if (req.query.dayOfWeek) query.dayOfWeek = req.query.dayOfWeek;
  if (req.query.room) query.room = req.query.room;

  const timetable = await Timetable.find(query)
    .populate('courseId', 'name code department')
    .populate('subjectId', 'name code credits type')
    .populate('facultyId', 'name email designation avatar')
    .sort({ dayOfWeek: 1, startTime: 1 })
    .lean();

  res.json({
    success: true,
    count: timetable.length,
    data: timetable,
  });
});

// @desc    Create timetable slot with 3-way clash detection
// @route   POST /api/timetable
// @access  Faculty, CollegeAdmin
const createTimetableSlot = asyncHandler(async (req, res) => {
  const {
    subjectId,
    facultyId,
    courseId,
    semester,
    dayOfWeek,
    startTime,
    endTime,
    room,
    type,
    academicYear,
    force,
  } = req.body;

  if (!subjectId || !dayOfWeek || !startTime || !endTime) {
    return res.status(400).json({
      success: false,
      message: 'Subject, day of week, start time, and end time are required',
    });
  }

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);

  if (endMin <= startMin) {
    return res.status(400).json({
      success: false,
      message: 'End time must be after start time',
    });
  }

  // Resolve subject and course
  const subject = await Subject.findOne({ _id: subjectId, collegeId: req.user.collegeId });
  if (!subject) {
    return res.status(400).json({ success: false, message: 'Valid subject not found' });
  }

  const effectiveCourseId = courseId || subject.courseId;
  const effectiveSemester = parseSemester(semester) || subject.semester || 1;
  const effectiveFacultyId = facultyId || subject.facultyId || req.user._id;

  // ── 3-WAY CLASH DETECTION ─────────────────────────────
  const existingSlots = await Timetable.find({
    collegeId: req.user.collegeId,
    dayOfWeek,
    isActive: true,
  })
    .populate('subjectId', 'name code')
    .populate('facultyId', 'name')
    .populate('courseId', 'name department')
    .lean();

  const clashes = [];

  for (const slot of existingSlots) {
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);

    if (isOverlapping(startMin, endMin, slotStart, slotEnd)) {
      // 1. Room Clash
      if (room && slot.room && room.trim().toLowerCase() === slot.room.trim().toLowerCase()) {
        clashes.push({
          type: 'room_clash',
          message: `Room ${room} is already booked by ${slot.subjectId?.name || 'another subject'} (${slot.startTime}-${slot.endTime})`,
          conflictingSlot: slot,
        });
      }

      // 2. Faculty Clash
      if (effectiveFacultyId && String(slot.facultyId?._id || slot.facultyId) === String(effectiveFacultyId)) {
        clashes.push({
          type: 'faculty_clash',
          message: `Faculty ${slot.facultyId?.name || 'Member'} is already scheduled for ${slot.subjectId?.name || 'Class'} (${slot.startTime}-${slot.endTime}) in Room ${slot.room || 'TBD'}`,
          conflictingSlot: slot,
        });
      }

      // 3. Batch/Semester Clash
      if (
        String(slot.courseId?._id || slot.courseId) === String(effectiveCourseId) &&
        Number(slot.semester) === Number(effectiveSemester)
      ) {
        clashes.push({
          type: 'batch_clash',
          message: `Semester ${effectiveSemester} batch already has ${slot.subjectId?.name || 'class'} scheduled at ${slot.startTime}-${slot.endTime}`,
          conflictingSlot: slot,
        });
      }
    }
  }

  if (clashes.length > 0 && !force) {
    return res.status(409).json({
      success: false,
      code: 'TIMETABLE_CLASH',
      message: `Detected ${clashes.length} scheduling clash(es)`,
      clashes,
    });
  }

  const entry = await Timetable.create({
    collegeId: req.user.collegeId,
    courseId: effectiveCourseId,
    subjectId: subject._id,
    facultyId: effectiveFacultyId,
    semester: effectiveSemester,
    dayOfWeek,
    startTime,
    endTime,
    room: room ? room.trim() : 'TBD',
    type: type || 'lecture',
    academicYear: academicYear || '2026-27',
  });

  await logAudit(req, 'create', 'timetable', {
    resourceId: entry._id,
    description: `Created timetable slot for ${subject.code} on ${dayOfWeek} (${startTime}-${endTime}) in ${room || 'TBD'}`,
  });

  emitDataChange(req, {
    collegeId: req.user.collegeId,
    roles: ['faculty', 'student', 'collegeAdmin'],
    type: 'timetable:updated',
  });

  const populated = await Timetable.findById(entry._id)
    .populate('courseId', 'name code department')
    .populate('subjectId', 'name code credits type')
    .populate('facultyId', 'name email designation avatar');

  res.status(201).json({
    success: true,
    message: 'Timetable slot created successfully',
    data: populated,
    hadClashesIgnored: clashes.length > 0 && Boolean(force),
  });
});

// @desc    Update timetable slot with clash checking
// @route   PUT /api/timetable/:id
// @access  Faculty, CollegeAdmin
const updateTimetableSlot = asyncHandler(async (req, res) => {
  const slot = await Timetable.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });

  if (!slot) {
    return res.status(404).json({ success: false, message: 'Timetable slot not found' });
  }

  const {
    subjectId,
    facultyId,
    courseId,
    semester,
    dayOfWeek,
    startTime,
    endTime,
    room,
    type,
    academicYear,
    force,
  } = req.body;

  const effectiveDay = dayOfWeek || slot.dayOfWeek;
  const effectiveStart = startTime || slot.startTime;
  const effectiveEnd = endTime || slot.endTime;
  const startMin = timeToMinutes(effectiveStart);
  const endMin = timeToMinutes(effectiveEnd);

  if (endMin <= startMin) {
    return res.status(400).json({ success: false, message: 'End time must be after start time' });
  }

  const effectiveRoom = room !== undefined ? room.trim() : slot.room;
  const effectiveFaculty = facultyId || slot.facultyId;
  const effectiveCourse = courseId || slot.courseId;
  const effectiveSem = semester !== undefined ? parseSemester(semester) : slot.semester;

  // Check clashes against other active slots (excluding this slot itself)
  const otherSlots = await Timetable.find({
    collegeId: req.user.collegeId,
    dayOfWeek: effectiveDay,
    _id: { $ne: slot._id },
    isActive: true,
  })
    .populate('subjectId', 'name code')
    .populate('facultyId', 'name')
    .lean();

  const clashes = [];

  for (const other of otherSlots) {
    const oStart = timeToMinutes(other.startTime);
    const oEnd = timeToMinutes(other.endTime);

    if (isOverlapping(startMin, endMin, oStart, oEnd)) {
      if (effectiveRoom && other.room && effectiveRoom.toLowerCase() === other.room.toLowerCase()) {
        clashes.push({
          type: 'room_clash',
          message: `Room ${effectiveRoom} is already booked by ${other.subjectId?.name || 'another subject'} (${other.startTime}-${other.endTime})`,
        });
      }

      if (effectiveFaculty && String(other.facultyId?._id || other.facultyId) === String(effectiveFaculty)) {
        clashes.push({
          type: 'faculty_clash',
          message: `Faculty ${other.facultyId?.name || 'Member'} is already booked for ${other.subjectId?.name || 'Class'} (${other.startTime}-${other.endTime})`,
        });
      }

      if (
        String(other.courseId?._id || other.courseId) === String(effectiveCourse) &&
        Number(other.semester) === Number(effectiveSem)
      ) {
        clashes.push({
          type: 'batch_clash',
          message: `Semester ${effectiveSem} batch already has ${other.subjectId?.name || 'class'} at this time`,
        });
      }
    }
  }

  if (clashes.length > 0 && !force) {
    return res.status(409).json({
      success: false,
      code: 'TIMETABLE_CLASH',
      message: `Detected ${clashes.length} scheduling clash(es)`,
      clashes,
    });
  }

  if (subjectId) slot.subjectId = subjectId;
  if (effectiveFaculty) slot.facultyId = effectiveFaculty;
  if (effectiveCourse) slot.courseId = effectiveCourse;
  if (effectiveSem) slot.semester = effectiveSem;
  if (dayOfWeek) slot.dayOfWeek = dayOfWeek;
  if (startTime) slot.startTime = startTime;
  if (endTime) slot.endTime = endTime;
  if (room !== undefined) slot.room = effectiveRoom;
  if (type) slot.type = type;
  if (academicYear) slot.academicYear = academicYear;

  await slot.save();

  await logAudit(req, 'update', 'timetable', {
    resourceId: slot._id,
    description: `Updated timetable slot ${slot._id}`,
  });

  emitDataChange(req, {
    collegeId: req.user.collegeId,
    roles: ['faculty', 'student', 'collegeAdmin'],
    type: 'timetable:updated',
  });

  const populated = await Timetable.findById(slot._id)
    .populate('courseId', 'name code department')
    .populate('subjectId', 'name code credits type')
    .populate('facultyId', 'name email designation avatar');

  res.json({
    success: true,
    message: 'Timetable slot updated successfully',
    data: populated,
  });
});

// @desc    Delete timetable slot
// @route   DELETE /api/timetable/:id
// @access  Faculty, CollegeAdmin
const deleteTimetableSlot = asyncHandler(async (req, res) => {
  const slot = await Timetable.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });

  if (!slot) {
    return res.status(404).json({ success: false, message: 'Timetable slot not found' });
  }

  await Timetable.deleteOne({ _id: slot._id });

  await logAudit(req, 'delete', 'timetable', {
    resourceId: slot._id,
    description: `Deleted timetable slot for ${slot.dayOfWeek} ${slot.startTime}-${slot.endTime}`,
  });

  emitDataChange(req, {
    collegeId: req.user.collegeId,
    roles: ['faculty', 'student', 'collegeAdmin'],
    type: 'timetable:updated',
  });

  res.json({
    success: true,
    message: 'Timetable slot deleted successfully',
  });
});

// @desc    Detect all scheduling clashes across the institution
// @route   GET /api/timetable/clashes
// @access  Faculty, CollegeAdmin
const detectClashes = asyncHandler(async (req, res) => {
  const slots = await Timetable.find({ collegeId: req.user.collegeId, isActive: true })
    .populate('courseId', 'name code department')
    .populate('subjectId', 'name code')
    .populate('facultyId', 'name email')
    .lean();

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const conflicts = [];

  for (const day of days) {
    const daySlots = slots.filter((s) => s.dayOfWeek === day);

    for (let i = 0; i < daySlots.length; i++) {
      for (let j = i + 1; j < daySlots.length; j++) {
        const a = daySlots[i];
        const b = daySlots[j];

        const aStart = timeToMinutes(a.startTime);
        const aEnd = timeToMinutes(a.endTime);
        const bStart = timeToMinutes(b.startTime);
        const bEnd = timeToMinutes(b.endTime);

        if (isOverlapping(aStart, aEnd, bStart, bEnd)) {
          // Room conflict
          if (a.room && b.room && a.room.trim().toLowerCase() === b.room.trim().toLowerCase()) {
            conflicts.push({
              conflictType: 'room',
              day,
              room: a.room,
              timeA: `${a.startTime}-${a.endTime}`,
              timeB: `${b.startTime}-${b.endTime}`,
              slotA: { id: a._id, subject: a.subjectId?.name, faculty: a.facultyId?.name },
              slotB: { id: b._id, subject: b.subjectId?.name, faculty: b.facultyId?.name },
              message: `Room "${a.room}" is double-booked on ${day} between ${a.startTime} and ${b.endTime}`,
            });
          }

          // Faculty conflict
          if (a.facultyId && b.facultyId && String(a.facultyId._id) === String(b.facultyId._id)) {
            conflicts.push({
              conflictType: 'faculty',
              day,
              faculty: a.facultyId.name,
              timeA: `${a.startTime}-${a.endTime}`,
              timeB: `${b.startTime}-${b.endTime}`,
              slotA: { id: a._id, subject: a.subjectId?.name, room: a.room },
              slotB: { id: b._id, subject: b.subjectId?.name, room: b.room },
              message: `Faculty ${a.facultyId.name} has overlapping classes on ${day}`,
            });
          }

          // Batch conflict
          if (
            a.courseId &&
            b.courseId &&
            String(a.courseId._id) === String(b.courseId._id) &&
            a.semester === b.semester
          ) {
            conflicts.push({
              conflictType: 'batch',
              day,
              department: a.courseId.department,
              semester: a.semester,
              timeA: `${a.startTime}-${a.endTime}`,
              timeB: `${b.startTime}-${b.endTime}`,
              slotA: { id: a._id, subject: a.subjectId?.name, room: a.room },
              slotB: { id: b._id, subject: b.subjectId?.name, room: b.room },
              message: `${a.courseId.department} Sem ${a.semester} students have two simultaneous classes on ${day}`,
            });
          }
        }
      }
    }
  }

  res.json({
    success: true,
    totalSlots: slots.length,
    conflictCount: conflicts.length,
    conflicts,
  });
});

// @desc    Get user's classes for today with live status indicators
// @route   GET /api/timetable/today
// @access  Authenticated
const getTodayQueue = asyncHandler(async (req, res) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const now = new Date();
  const todayName = days[now.getDay()];
  const currentMin = now.getHours() * 60 + now.getMinutes();

  const query = {
    collegeId: req.user.collegeId,
    dayOfWeek: todayName,
    isActive: true,
  };

  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  } else if (req.user.role === 'student') {
    if (req.user.semester) query.semester = req.user.semester;
    if (req.user.department) {
      const courses = await Course.find({ collegeId: req.user.collegeId, department: req.user.department }).select('_id');
      if (courses.length > 0) query.courseId = { $in: courses.map((c) => c._id) };
    }
  }

  const slots = await Timetable.find(query)
    .populate('courseId', 'name code department')
    .populate('subjectId', 'name code credits type')
    .populate('facultyId', 'name email designation avatar')
    .sort({ startTime: 1 })
    .lean();

  let nextClass = null;
  const queue = slots.map((s) => {
    const sStart = timeToMinutes(s.startTime);
    const sEnd = timeToMinutes(s.endTime);

    let status = 'upcoming';
    if (currentMin > sEnd) {
      status = 'completed';
    } else if (currentMin >= sStart && currentMin <= sEnd) {
      status = 'live_now';
    }

    if (!nextClass && (status === 'live_now' || status === 'upcoming')) {
      nextClass = { ...s, status };
    }

    return {
      ...s,
      status,
      durationMinutes: sEnd - sStart,
    };
  });

  res.json({
    success: true,
    today: todayName,
    currentTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    count: queue.length,
    nextClass,
    queue,
  });
});

// @desc    Export timetable in iCalendar RFC 5545 format (.ics)
// @route   GET /api/timetable/export/ics
// @access  Authenticated
const exportICS = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId, isActive: true };

  if (req.user.role === 'faculty') {
    query.facultyId = req.user._id;
  } else if (req.user.role === 'student' && req.user.semester) {
    query.semester = req.user.semester;
  }

  const slots = await Timetable.find(query)
    .populate('courseId', 'name code department')
    .populate('subjectId', 'name code')
    .populate('facultyId', 'name')
    .lean();

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VishvaERP//Academic Timetable//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:VishvaERP Academic Timetable',
  ];

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  // Base date set to current week Monday
  const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayIndex);

  const dayOffsets = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
  };

  slots.forEach((s) => {
    const offset = dayOffsets[s.dayOfWeek] !== undefined ? dayOffsets[s.dayOfWeek] : 0;
    const targetDate = new Date(monday);
    targetDate.setDate(monday.getDate() + offset);

    const [startH, startM] = (s.startTime || '09:00').split(':').map(Number);
    const [endH, endM] = (s.endTime || '10:00').split(':').map(Number);

    targetDate.setHours(startH, startM, 0, 0);
    const dtStart = targetDate.toISOString().replace(/[-:]/g, '').split('.')[0];

    targetDate.setHours(endH, endM, 0, 0);
    const dtEnd = targetDate.toISOString().replace(/[-:]/g, '').split('.')[0];

    const rruleDay = DAY_ICS_MAP[s.dayOfWeek] || 'MO';
    const summary = `${s.subjectId?.code || 'CLASS'}: ${s.subjectId?.name || 'Lecture'} (${(s.type || 'lecture').toUpperCase()})`;
    const location = s.room ? `Room ${s.room}` : 'Campus';
    const desc = `Instructor: ${s.facultyId?.name || 'Faculty'}\\nBatch: ${s.courseId?.department || ''} Sem ${s.semester}`;

    ics.push('BEGIN:VEVENT');
    ics.push(`UID:timetable-${s._id}@vishvaerp.edu`);
    ics.push(`DTSTAMP:${stamp}`);
    ics.push(`DTSTART;TZID=Asia/Kolkata:${dtStart}`);
    ics.push(`DTEND;TZID=Asia/Kolkata:${dtEnd}`);
    ics.push(`RRULE:FREQ=WEEKLY;BYDAY=${rruleDay}`);
    ics.push(`SUMMARY:${summary}`);
    ics.push(`LOCATION:${location}`);
    ics.push(`DESCRIPTION:${desc}`);
    ics.push('STATUS:CONFIRMED');
    ics.push('END:VEVENT');
  });

  ics.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="vishvaerp-timetable.ics"');
  res.send(ics.join('\r\n'));
});

module.exports = {
  getTimetable,
  createTimetableSlot,
  updateTimetableSlot,
  deleteTimetableSlot,
  detectClashes,
  getTodayQueue,
  exportICS,
};
