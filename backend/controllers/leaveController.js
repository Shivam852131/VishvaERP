const asyncHandler = require('../middleware/asyncHandler');
const Leave = require('../models/Leave');
const User = require('../models/User');
const Timetable = require('../models/Timetable');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

/**
 * Helper to compute total days between two dates
 */
function calculateLeaveDays(startDate, endDate, isHalfDay = false) {
  if (isHalfDay) return 0.5;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diffDays);
}

// @desc    Apply for leave (Faculty, Students, Staff)
// @route   POST /api/leave/apply & /api/hr/leaves/apply
const applyLeave = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const collegeId = req.user.collegeId;
  const {
    leaveType,
    startDate,
    endDate,
    isHalfDay,
    halfDaySession,
    reason,
    substituteFacultyId,
    substituteNotes,
    attachments,
    contactDuringLeave,
  } = req.body;

  if (!leaveType || !startDate || !endDate || !reason) {
    return res.status(400).json({ success: false, message: 'Please provide leaveType, startDate, endDate, and reason' });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ success: false, message: 'Invalid start or end date' });
  }
  if (start > end) {
    return res.status(400).json({ success: false, message: 'Start date cannot be after end date' });
  }

  // Prevent overlapping active leave requests for the same user
  const overlap = await Leave.findOne({
    collegeId,
    userId,
    status: { $in: ['pending', 'approved'] },
    $or: [
      { startDate: { $lte: end }, endDate: { $gte: start } },
    ],
  });

  if (overlap) {
    return res.status(400).json({
      success: false,
      message: 'Leave dates overlap with an existing pending or approved leave application',
    });
  }

  // Total days calculation
  const totalDays = calculateLeaveDays(start, end, Boolean(isHalfDay));

  // Determine role
  const role = ['faculty', 'student', 'staff'].includes(req.user.role) ? req.user.role : 'faculty';

  // Substitute faculty handling
  let substituteStatus = 'not_required';
  if (substituteFacultyId) {
    if (String(substituteFacultyId) === String(userId)) {
      return res.status(400).json({ success: false, message: 'Cannot assign yourself as substitute faculty' });
    }
    const substituteUser = await User.findOne({ _id: substituteFacultyId, collegeId });
    if (!substituteUser) {
      return res.status(404).json({ success: false, message: 'Substitute faculty not found in this institution' });
    }
    substituteStatus = 'pending';
  }

  const actionHistory = [{
    action: 'applied',
    performedBy: userId,
    role: req.user.role,
    timestamp: new Date(),
    notes: `Applied for ${totalDays} day(s) ${leaveType} leave`,
  }];

  const leave = await Leave.create({
    collegeId,
    userId,
    role,
    leaveType,
    startDate: start,
    endDate: end,
    isHalfDay: Boolean(isHalfDay),
    halfDaySession: isHalfDay ? (halfDaySession || 'first_half') : null,
    totalDays,
    reason,
    substituteFacultyId: substituteFacultyId || null,
    substituteStatus,
    substituteNotes: substituteNotes || '',
    attachments: Array.isArray(attachments) ? attachments : [],
    contactDuringLeave: contactDuringLeave || '',
    actionHistory,
  });

  logAudit(req, 'create', 'leave', {
    resourceId: leave._id,
    description: `Leave application submitted (${leaveType}) for ${totalDays} day(s)`,
    metadata: { startDate: leave.startDate, endDate: leave.endDate, totalDays, leaveType },
  });

  emitDataChange(req, {
    collegeId: String(collegeId),
    roles: ['collegeAdmin', 'superadmin', 'faculty'],
    resource: 'leaves',
    action: 'created',
  });

  const populatedLeave = await Leave.findById(leave._id)
    .populate('substituteFacultyId', 'name email department designation phone')
    .populate('userId', 'name email department designation rollNo role');

  res.status(201).json({
    success: true,
    message: 'Leave application submitted successfully',
    leave: populatedLeave,
  });
});

// @desc    Get leave requests for current user with annual quotas & balances
// @route   GET /api/leave/my-leaves & /api/hr/leaves/my-leaves
const getMyLeaves = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const query = { userId: req.user._id, collegeId: req.user.collegeId };
  if (status && status !== 'all') {
    query.status = status;
  }

  const leaves = await Leave.find(query)
    .populate('approvedBy', 'name role email')
    .populate('substituteFacultyId', 'name role department designation email phone')
    .sort({ createdAt: -1 });

  const currentYear = new Date().getFullYear();
  const approvedThisYear = leaves.filter(l =>
    l.status === 'approved' && new Date(l.startDate).getFullYear() === currentYear
  );

  const calcDays = (type) => approvedThisYear
    .filter(l => l.leaveType === type)
    .reduce((sum, l) => sum + (l.totalDays || 1), 0);

  let balances = {};
  if (req.user.role === 'student') {
    balances = {
      medical: { used: calcDays('medical') },
      duty: { used: calcDays('duty') },
      emergency: { used: calcDays('emergency') },
      personal: { used: calcDays('personal') },
      advisory: 'Approved On-Duty (OD) days qualify for academic attendance regularization.',
    };
  } else {
    // Faculty and staff standard quotas
    balances = {
      casual: { total: 12, used: calcDays('casual'), remaining: Math.max(0, 12 - calcDays('casual')) },
      sick: { total: 10, used: calcDays('sick'), remaining: Math.max(0, 10 - calcDays('sick')) },
      earned: { total: 15, used: calcDays('earned'), remaining: Math.max(0, 15 - calcDays('earned')) },
      duty: { total: 10, used: calcDays('duty'), remaining: Math.max(0, 10 - calcDays('duty')) },
      maternity: { total: 180, used: calcDays('maternity'), remaining: Math.max(0, 180 - calcDays('maternity')) },
      paternity: { total: 15, used: calcDays('paternity'), remaining: Math.max(0, 15 - calcDays('paternity')) },
    };
  }

  res.json({ success: true, count: leaves.length, leaves, balances });
});

// @desc    Get all leave requests across the college (Admin)
// @route   GET /api/leave/all & /api/hr/leaves/all
const getAllLeaves = asyncHandler(async (req, res) => {
  const { status, role, leaveType, department, startDate, endDate } = req.query;
  const query = { collegeId: req.user.collegeId };

  if (status && status !== 'all') query.status = status;
  if (role && role !== 'all') query.role = role;
  if (leaveType && leaveType !== 'all') query.leaveType = leaveType;

  if (startDate || endDate) {
    query.startDate = {};
    if (startDate) query.startDate.$gte = new Date(startDate);
    if (endDate) query.startDate.$lte = new Date(endDate);
  }

  let leaves = await Leave.find(query)
    .populate('userId', 'name role department designation rollNo semester email phone avatar')
    .populate('approvedBy', 'name role email')
    .populate('substituteFacultyId', 'name role department designation email phone')
    .sort({ createdAt: -1 });

  if (department && department !== 'all') {
    leaves = leaves.filter(l => l.userId && l.userId.department === department);
  }

  res.json({ success: true, total: leaves.length, leaves });
});

// @desc    Approve or Reject leave request (Admin)
// @route   PUT /api/leave/:id/status & /api/hr/leaves/:id/status
const updateLeaveStatus = asyncHandler(async (req, res) => {
  const { status, remarks, rejectionReason } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be either approved or rejected' });
  }

  const leave = await Leave.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!leave) {
    return res.status(404).json({ success: false, message: 'Leave record not found' });
  }

  if (leave.status === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Cannot update a cancelled leave application' });
  }

  leave.status = status;
  leave.approvedBy = req.user._id;
  leave.remarks = remarks || leave.remarks;
  if (status === 'rejected') {
    leave.rejectionReason = rejectionReason || remarks || 'Rejected by administration';
  }

  leave.actionHistory.push({
    action: status,
    performedBy: req.user._id,
    role: req.user.role,
    timestamp: new Date(),
    notes: remarks || rejectionReason || `Leave ${status} by administrator`,
  });

  await leave.save();

  logAudit(req, 'update', 'leave', {
    resourceId: leave._id,
    description: `Leave application ${status}`,
    metadata: { status, remarks, approvedBy: req.user._id },
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin', 'collegeAdmin', 'faculty', 'student'],
    resource: 'leaves',
    action: 'updated',
  });

  const updatedLeave = await Leave.findById(leave._id)
    .populate('userId', 'name role department designation rollNo email phone')
    .populate('approvedBy', 'name role email')
    .populate('substituteFacultyId', 'name role department designation email phone');

  res.json({
    success: true,
    message: `Leave application ${status} successfully`,
    leave: updatedLeave,
  });
});

// @desc    Cancel a leave application (Applicant)
// @route   PUT /api/leave/:id/cancel & /api/hr/leaves/:id/cancel
const cancelLeave = asyncHandler(async (req, res) => {
  const leave = await Leave.findOne({
    _id: req.params.id,
    userId: req.user._id,
    collegeId: req.user.collegeId,
  });

  if (!leave) {
    return res.status(404).json({ success: false, message: 'Leave application not found' });
  }

  if (['rejected', 'cancelled'].includes(leave.status)) {
    return res.status(400).json({ success: false, message: `Cannot cancel a leave that is already ${leave.status}` });
  }

  // If approved, check if start date is already in the past
  if (leave.status === 'approved' && new Date(leave.startDate) < new Date().setHours(0, 0, 0, 0)) {
    return res.status(400).json({ success: false, message: 'Cannot cancel an approved leave that has already commenced' });
  }

  leave.status = 'cancelled';
  leave.remarks = req.body.reason || 'Cancelled by applicant';
  leave.actionHistory.push({
    action: 'cancelled',
    performedBy: req.user._id,
    role: req.user.role,
    timestamp: new Date(),
    notes: req.body.reason || 'Cancelled by applicant',
  });

  await leave.save();

  logAudit(req, 'update', 'leave', {
    resourceId: leave._id,
    description: 'Leave application cancelled by applicant',
    metadata: { leaveId: leave._id },
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['collegeAdmin', 'faculty'],
    resource: 'leaves',
    action: 'cancelled',
  });

  res.json({ success: true, message: 'Leave application cancelled successfully', leave });
});

// @desc    Get covering/substitute requests assigned to current faculty
// @route   GET /api/leave/substitute-requests & /api/hr/substitute-requests
const getMySubstituteRequests = asyncHandler(async (req, res) => {
  const requests = await Leave.find({
    collegeId: req.user.collegeId,
    substituteFacultyId: req.user._id,
  })
    .populate('userId', 'name email department designation phone avatar')
    .sort({ createdAt: -1 });

  res.json({ success: true, count: requests.length, requests });
});

// @desc    Respond to a substitute teaching request (Accept / Decline)
// @route   PATCH /api/leave/:id/substitute-response & /api/hr/substitute/:id/response
const respondSubstituteRequest = asyncHandler(async (req, res) => {
  const { response, notes } = req.body;

  if (!['accepted', 'declined'].includes(response)) {
    return res.status(400).json({ success: false, message: 'Response must be either accepted or declined' });
  }

  const leave = await Leave.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
    substituteFacultyId: req.user._id,
  });

  if (!leave) {
    return res.status(404).json({ success: false, message: 'Substitute request not found or not assigned to you' });
  }

  leave.substituteStatus = response;
  leave.substituteNotes = notes || leave.substituteNotes;

  leave.actionHistory.push({
    action: `substitute_${response}`,
    performedBy: req.user._id,
    role: req.user.role,
    timestamp: new Date(),
    notes: notes || `Substitute request ${response}`,
  });

  await leave.save();

  logAudit(req, 'update', 'leave', {
    resourceId: leave._id,
    description: `Substitute coverage ${response} by faculty`,
    metadata: { response, notes },
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['faculty', 'collegeAdmin'],
    resource: 'leaves',
    action: 'updated',
  });

  res.json({
    success: true,
    message: `Substitute teaching request marked as ${response}`,
    leave,
  });
});

// @desc    Get HR & Leave aggregate statistics (Admin)
// @route   GET /api/leave/stats & /api/hr/stats
const getLeaveStats = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;

  // Active faculty and staff
  const totalStaff = await User.countDocuments({
    collegeId,
    role: { $in: ['faculty', 'staff'] },
    isActive: true,
  });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Active leaves today
  const onLeaveTodayDocs = await Leave.find({
    collegeId,
    status: 'approved',
    role: { $in: ['faculty', 'staff'] },
    startDate: { $lte: todayEnd },
    endDate: { $gte: todayStart },
  }).populate('userId', 'department name');

  const onLeaveToday = onLeaveTodayDocs.length;
  const presentToday = Math.max(0, totalStaff - onLeaveToday);

  const pendingApprovals = await Leave.countDocuments({
    collegeId,
    status: 'pending',
  });

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const approvedMonth = await Leave.countDocuments({
    collegeId,
    status: 'approved',
    updatedAt: { $gte: startOfMonth },
  });

  const rejectedMonth = await Leave.countDocuments({
    collegeId,
    status: 'rejected',
    updatedAt: { $gte: startOfMonth },
  });

  // Leave distribution by type
  const distributionAgg = await Leave.aggregate([
    { $match: { collegeId, status: 'approved' } },
    { $group: { _id: '$leaveType', count: { $sum: 1 }, totalDays: { $sum: '$totalDays' } } },
  ]);

  const leaveTypeDistribution = {};
  distributionAgg.forEach(d => {
    leaveTypeDistribution[d._id] = { count: d.count, totalDays: d.totalDays };
  });

  // Department absenteeism breakdown
  const departmentAbsenteeism = {};
  onLeaveTodayDocs.forEach(l => {
    const dept = (l.userId && l.userId.department) || 'General';
    departmentAbsenteeism[dept] = (departmentAbsenteeism[dept] || 0) + 1;
  });

  res.json({
    success: true,
    stats: {
      totalStaff,
      presentToday,
      onLeaveToday,
      pendingApprovals,
      approvedMonth,
      rejectedMonth,
      leaveTypeDistribution,
      departmentAbsenteeism,
      attendanceRateToday: totalStaff > 0 ? Math.round((presentToday / totalStaff) * 100) : 100,
    },
  });
});

// @desc    Export leave applications as RFC 4180 CSV
// @route   GET /api/leave/export & /api/hr/leaves/export
const exportLeaveReport = asyncHandler(async (req, res) => {
  const { status, role, leaveType } = req.query;
  const query = { collegeId: req.user.collegeId };

  if (status && status !== 'all') query.status = status;
  if (role && role !== 'all') query.role = role;
  if (leaveType && leaveType !== 'all') query.leaveType = leaveType;

  const leaves = await Leave.find(query)
    .populate('userId', 'name role department designation rollNo email phone')
    .populate('approvedBy', 'name role email')
    .populate('substituteFacultyId', 'name role department designation')
    .sort({ createdAt: -1 });

  const headers = [
    'Application ID',
    'Applicant Name',
    'Role',
    'Department / Roll',
    'Designation',
    'Leave Type',
    'Start Date',
    'End Date',
    'Total Days',
    'Half Day',
    'Substitute Faculty',
    'Substitute Status',
    'Status',
    'Approved By',
    'Remarks',
    'Applied On',
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = leaves.map(l => [
    escapeCSV(l._id),
    escapeCSV(l.userId ? l.userId.name : 'Unknown'),
    escapeCSV(l.role || (l.userId ? l.userId.role : 'faculty')),
    escapeCSV(l.userId ? (l.userId.department || l.userId.rollNo || '-') : '-'),
    escapeCSV(l.userId ? (l.userId.designation || '-') : '-'),
    escapeCSV(l.leaveType),
    escapeCSV(new Date(l.startDate).toISOString().split('T')[0]),
    escapeCSV(new Date(l.endDate).toISOString().split('T')[0]),
    escapeCSV(l.totalDays || 1),
    escapeCSV(l.isHalfDay ? `Yes (${l.halfDaySession})` : 'No'),
    escapeCSV(l.substituteFacultyId ? l.substituteFacultyId.name : 'None'),
    escapeCSV(l.substituteStatus),
    escapeCSV(l.status),
    escapeCSV(l.approvedBy ? l.approvedBy.name : '-'),
    escapeCSV(l.remarks || l.rejectionReason || '-'),
    escapeCSV(new Date(l.createdAt).toISOString().split('T')[0]),
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="leave-report-${new Date().toISOString().split('T')[0]}.csv"`);
  res.status(200).send(csvContent);
});

// @desc    Get Faculty Workload & Staff Directory metrics (Admin / Faculty)
// @route   GET /api/hr/faculty-workload & /api/leave/faculty-workload
const getFacultyWorkload = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;

  const facultyMembers = await User.find({
    collegeId,
    role: 'faculty',
    isActive: true,
  }).select('name email phone department designation avatar admissionDate');

  const facultyIds = facultyMembers.map(f => f._id);

  // Fetch timetable slots for faculty
  let timetableSlots = [];
  try {
    timetableSlots = await Timetable.find({
      collegeId,
      facultyId: { $in: facultyIds },
      isActive: true,
    }).populate('subjectId', 'name code').populate('courseId', 'name code');
  } catch (err) {
    timetableSlots = [];
  }

  const workloads = facultyMembers.map(faculty => {
    const slots = timetableSlots.filter(s => String(s.facultyId) === String(faculty._id));
    const weeklyClasses = slots.length;

    // Calculate contact hours
    let totalMinutes = 0;
    const subjectsSet = new Set();
    const roomsSet = new Set();

    slots.forEach(slot => {
      if (slot.subjectId) subjectsSet.add(slot.subjectId.name || slot.subjectId.code || String(slot.subjectId));
      if (slot.room) roomsSet.add(slot.room);

      if (slot.startTime && slot.endTime) {
        const [sh, sm] = slot.startTime.split(':').map(Number);
        const [eh, em] = slot.endTime.split(':').map(Number);
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins > 0) totalMinutes += mins;
      } else {
        totalMinutes += 60; // Default 1 hour
      }
    });

    const weeklyHours = Math.round((totalMinutes / 60) * 10) / 10;

    return {
      facultyId: faculty._id,
      name: faculty.name,
      email: faculty.email,
      phone: faculty.phone,
      department: faculty.department || 'General',
      designation: faculty.designation || 'Faculty Member',
      avatar: faculty.avatar,
      weeklyClasses,
      weeklyHours,
      distinctSubjects: subjectsSet.size,
      roomsAssigned: Array.from(roomsSet),
    };
  });

  res.json({ success: true, count: workloads.length, facultyWorkload: workloads });
});

module.exports = {
  applyLeave,
  getMyLeaves,
  getAllLeaves,
  updateLeaveStatus,
  cancelLeave,
  getMySubstituteRequests,
  respondSubstituteRequest,
  getLeaveStats,
  exportLeaveReport,
  getFacultyWorkload,
};
