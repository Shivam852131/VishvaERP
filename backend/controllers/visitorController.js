const asyncHandler = require('../middleware/asyncHandler');
const Visitor = require('../models/Visitor');
const User = require('../models/User');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');

function escapeRegex(text) {
  return String(text || '').replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * Resolves a host by ID, roll number, email, or name.
 * Falls back to the authenticated user if no specific record matches.
 */
async function resolveHost(collegeId, hostInput, defaultUser) {
  if (!hostInput) {
    return {
      hostUserId: defaultUser?._id,
      hostName: defaultUser?.name || 'Campus Administration',
      department: defaultUser?.department || 'Administration',
    };
  }

  const str = String(hostInput).trim();

  // 1. Is it a valid 24-character hexadecimal ObjectId?
  if (/^[a-f\d]{24}$/i.test(str)) {
    const user = await User.findOne({ _id: str, collegeId }).select('name department');
    if (user) {
      return { hostUserId: user._id, hostName: user.name, department: user.department };
    }
  }

  // 2. Try match roll number or enrollment number
  const byRoll = await User.findOne({
    collegeId,
    $or: [{ rollNo: str }, { enrollmentNo: str }],
  }).select('name department rollNo');
  if (byRoll) {
    return { hostUserId: byRoll._id, hostName: `${byRoll.name} (${byRoll.rollNo})`, department: byRoll.department };
  }

  // 3. Try match email
  const byEmail = await User.findOne({ collegeId, email: str.toLowerCase() }).select('name department');
  if (byEmail) {
    return { hostUserId: byEmail._id, hostName: byEmail.name, department: byEmail.department };
  }

  // 4. Try match name with regex
  const byName = await User.findOne({
    collegeId,
    name: { $regex: escapeRegex(str), $options: 'i' },
  }).select('name department');
  if (byName) {
    return { hostUserId: byName._id, hostName: byName.name, department: byName.department };
  }

  // 5. Fallback: Host is designated by textual name directly
  return {
    hostUserId: defaultUser?._id,
    hostName: str,
    department: defaultUser?.department || 'Administration',
  };
}

function generateGatePass() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VIS-${dateStr}-${rand}`;
}

// @desc    Check in an on-spot visitor and issue gate pass
// @route   POST /api/visitors
// @access  Protected
const createVisitor = asyncHandler(async (req, res) => {
  const {
    visitorName,
    visitorPhone,
    visitorEmail,
    purpose,
    category,
    hostUserId,
    department,
    meetingRoom,
    expectedDuration,
    vehicleNumber,
    vehicleType,
    itemsCarried,
    idType,
    idNumber,
    badgeNumber,
    securityNotes,
  } = req.body;

  if (!visitorName || !visitorName.trim()) {
    return res.status(400).json({ success: false, message: 'Visitor name is required' });
  }

  if (!purpose || !purpose.trim()) {
    return res.status(400).json({ success: false, message: 'Purpose of visit is required' });
  }

  const resolvedHost = await resolveHost(req.user.collegeId, hostUserId, req.user);

  // Check if visitor phone or email is blacklisted
  const blacklistedRecord = await Visitor.findOne({
    collegeId: req.user.collegeId,
    isBlacklisted: true,
    $or: [
      ...(visitorPhone ? [{ visitorPhone: visitorPhone.trim() }] : []),
      ...(visitorEmail ? [{ visitorEmail: visitorEmail.trim().toLowerCase() }] : []),
    ],
  });

  if (blacklistedRecord) {
    return res.status(403).json({
      success: false,
      message: `Visitor entry denied. This visitor is blacklisted. Reason: ${blacklistedRecord.blacklistReason || 'Security Alert'}`,
      isBlacklisted: true,
      blacklistReason: blacklistedRecord.blacklistReason,
    });
  }

  const gatePass = generateGatePass();

  const visitor = await Visitor.create({
    collegeId: req.user.collegeId,
    visitorName: visitorName.trim(),
    visitorPhone: visitorPhone ? visitorPhone.trim() : '',
    visitorEmail: visitorEmail ? visitorEmail.trim().toLowerCase() : '',
    purpose: purpose.trim(),
    category: category || 'other',
    hostUserId: resolvedHost.hostUserId,
    hostName: resolvedHost.hostName,
    department: department || resolvedHost.department,
    meetingRoom: meetingRoom ? meetingRoom.trim() : '',
    expectedDuration: expectedDuration ? expectedDuration.trim() : '1 hour',
    vehicleNumber: vehicleNumber ? vehicleNumber.trim().toUpperCase() : '',
    vehicleType: vehicleType || 'none',
    itemsCarried: itemsCarried ? itemsCarried.trim() : '',
    idType: idType || 'aadhaar',
    idNumber: idNumber ? idNumber.trim() : '',
    badgeNumber: badgeNumber ? badgeNumber.trim() : `B-${gatePass.slice(-4)}`,
    gatePass,
    checkInTime: new Date(),
    status: 'checked-in',
    securityNotes: securityNotes ? securityNotes.trim() : '',
    approvedBy: req.user._id,
  });

  logAudit(req, 'create', 'visitor', {
    resourceId: visitor._id,
    description: `Visitor checked in: ${visitor.visitorName} (Pass: ${gatePass}) to meet ${visitor.hostName}`,
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['collegeAdmin'],
    resource: 'visitors',
    action: 'checked-in',
    gatePass,
  });

  if (req.io) {
    req.io.to(`college:${req.user.collegeId}`).emit('visitor_update', {
      action: 'checked-in',
      visitor,
    });
  }

  res.status(201).json({
    success: true,
    visitor,
    data: visitor,
    gatePass: visitor.gatePass,
    message: 'Visitor checked in successfully',
  });
});

// @desc    Pre-register an expected visitor
// @route   POST /api/visitors/pre-register
// @access  Protected
const preRegisterVisitor = asyncHandler(async (req, res) => {
  const {
    visitorName,
    visitorPhone,
    visitorEmail,
    purpose,
    category,
    hostUserId,
    department,
    meetingRoom,
    expectedDuration,
    vehicleNumber,
    vehicleType,
    securityNotes,
  } = req.body;

  if (!visitorName || !purpose) {
    return res.status(400).json({ success: false, message: 'visitorName and purpose are required' });
  }

  const resolvedHost = await resolveHost(req.user.collegeId, hostUserId, req.user);
  const gatePass = generateGatePass();

  const visitor = await Visitor.create({
    collegeId: req.user.collegeId,
    visitorName: visitorName.trim(),
    visitorPhone: visitorPhone ? visitorPhone.trim() : '',
    visitorEmail: visitorEmail ? visitorEmail.trim().toLowerCase() : '',
    purpose: purpose.trim(),
    category: category || 'other',
    hostUserId: resolvedHost.hostUserId,
    hostName: resolvedHost.hostName,
    department: department || resolvedHost.department,
    meetingRoom: meetingRoom ? meetingRoom.trim() : '',
    expectedDuration: expectedDuration || '1 hour',
    vehicleNumber: vehicleNumber ? vehicleNumber.trim().toUpperCase() : '',
    vehicleType: vehicleType || 'none',
    gatePass,
    status: 'pre-registered',
    securityNotes: securityNotes ? securityNotes.trim() : '',
    approvedBy: req.user._id,
  });

  logAudit(req, 'create', 'visitor', {
    resourceId: visitor._id,
    description: `Pre-registered visitor: ${visitorName} (Pass: ${gatePass})`,
  });

  res.status(201).json({
    success: true,
    visitor,
    data: visitor,
    gatePass: visitor.gatePass,
    message: 'Visitor pre-registered successfully',
  });
});

// @desc    Check in a pre-registered visitor
// @route   POST /api/visitors/:id/checkin
// @access  Protected
const checkInPreRegistered = asyncHandler(async (req, res) => {
  const visitor = await Visitor.findOne({
    _id: req.params.id,
    collegeId: req.user.collegeId,
  });

  if (!visitor) {
    return res.status(404).json({ success: false, message: 'Visitor record not found' });
  }

  if (visitor.status === 'checked-in') {
    return res.status(400).json({ success: false, message: 'Visitor is already checked in' });
  }

  if (visitor.isBlacklisted) {
    return res.status(403).json({ success: false, message: 'Visitor is blacklisted' });
  }

  visitor.status = 'checked-in';
  visitor.checkInTime = new Date();
  if (req.body.badgeNumber) visitor.badgeNumber = req.body.badgeNumber;
  if (req.body.vehicleNumber) visitor.vehicleNumber = req.body.vehicleNumber;
  if (req.body.idType) visitor.idType = req.body.idType;
  if (req.body.idNumber) visitor.idNumber = req.body.idNumber;
  if (req.body.itemsCarried) visitor.itemsCarried = req.body.itemsCarried;
  await visitor.save();

  logAudit(req, 'update', 'visitor', {
    resourceId: visitor._id,
    description: `Pre-registered visitor checked in at gate: ${visitor.visitorName} (${visitor.gatePass})`,
  });

  res.json({
    success: true,
    visitor,
    data: visitor,
    message: 'Visitor checked in successfully',
  });
});

// @desc    Get paginated visitors list with search and filters
// @route   GET /api/visitors
// @access  Protected
const getVisitors = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 50,
    status,
    category,
    search,
    date,
    hostUserId,
  } = req.query;

  const query = { collegeId: req.user.collegeId };

  if (status && status !== 'all') {
    query.status = status;
  }

  if (category && category !== 'all') {
    query.category = category;
  }

  if (hostUserId) {
    query.hostUserId = hostUserId;
  }

  if (search && search.trim()) {
    const s = search.trim();
    query.$or = [
      { visitorName: { $regex: escapeRegex(s), $options: 'i' } },
      { visitorPhone: { $regex: escapeRegex(s), $options: 'i' } },
      { visitorEmail: { $regex: escapeRegex(s), $options: 'i' } },
      { hostName: { $regex: escapeRegex(s), $options: 'i' } },
      { gatePass: { $regex: escapeRegex(s), $options: 'i' } },
      { badgeNumber: { $regex: escapeRegex(s), $options: 'i' } },
      { vehicleNumber: { $regex: escapeRegex(s), $options: 'i' } },
    ];
  }

  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    query.checkInTime = { $gte: start, $lte: end };
  }

  const numLimit = Math.min(Number(limit) || 50, 200);
  const numPage = Math.max(Number(page) || 1, 1);
  const skip = (numPage - 1) * numLimit;

  const [total, visitors] = await Promise.all([
    Visitor.countDocuments(query),
    Visitor.find(query)
      .populate('hostUserId', 'name email department phone')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(numLimit),
  ]);

  res.json({
    success: true,
    visitors,
    data: visitors,
    total,
    page: numPage,
    pages: Math.ceil(total / numLimit) || 1,
  });
});

// @desc    Get visitor by ID
// @route   GET /api/visitors/:id
// @access  Protected
const getVisitorById = asyncHandler(async (req, res) => {
  const visitor = await Visitor.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('hostUserId', 'name email department phone')
    .populate('approvedBy', 'name email');

  if (!visitor) {
    return res.status(404).json({ success: false, message: 'Visitor not found' });
  }

  res.json({ success: true, visitor, data: visitor });
});

// @desc    Get printable gate pass and QR payload by pass code or ID
// @route   GET /api/visitors/pass/:gatePass
// @access  Protected
const getGatePass = asyncHandler(async (req, res) => {
  const passIdentifier = req.params.gatePass || req.params.id;

  const query = { collegeId: req.user.collegeId };
  if (/^[a-f\d]{24}$/i.test(passIdentifier)) {
    query.$or = [{ _id: passIdentifier }, { gatePass: passIdentifier }];
  } else {
    query.gatePass = passIdentifier;
  }

  const visitor = await Visitor.findOne(query)
    .populate('hostUserId', 'name email department phone')
    .populate('approvedBy', 'name');

  if (!visitor) {
    return res.status(404).json({ success: false, message: 'Gate pass not found' });
  }

  const qrPayload = JSON.stringify({
    gatePass: visitor.gatePass,
    name: visitor.visitorName,
    host: visitor.hostName,
    checkIn: visitor.checkInTime,
    status: visitor.status,
    cid: String(req.user.collegeId),
  });

  res.json({
    success: true,
    pass: {
      ...visitor.toObject(),
      qrPayload,
      qrVerificationUri: `https://erp.campus.edu/gatepass/verify?pass=${visitor.gatePass}`,
    },
    data: visitor,
  });
});

// @desc    Verify QR or Gate Pass at security checkpoint
// @route   POST /api/visitors/verify
// @access  Protected
const verifyGatePass = asyncHandler(async (req, res) => {
  const gatePass = req.body.gatePass || req.params.gatePass || req.query.gatePass;
  if (!gatePass) {
    return res.status(400).json({ success: false, message: 'Gate pass code or QR payload is required' });
  }

  let code = String(gatePass).trim();
  // If JSON QR scanned, extract gatePass field
  if (code.startsWith('{') && code.endsWith('}')) {
    try {
      const parsed = JSON.parse(code);
      if (parsed.gatePass) code = parsed.gatePass;
    } catch (_) {}
  }

  const visitor = await Visitor.findOne({ gatePass: code, collegeId: req.user.collegeId })
    .populate('hostUserId', 'name email department phone')
    .populate('approvedBy', 'name');

  if (!visitor) {
    return res.status(404).json({ success: false, message: 'Invalid or unrecognized Gate Pass' });
  }

  let durationMinutes = 0;
  if (visitor.checkInTime) {
    const end = visitor.checkOutTime || new Date();
    durationMinutes = Math.max(0, Math.round((end - new Date(visitor.checkInTime)) / 60000));
  }

  res.json({
    success: true,
    valid: true,
    visitor,
    data: visitor,
    durationMinutes,
    isBlacklisted: Boolean(visitor.isBlacklisted),
    canCheckout: visitor.status === 'checked-in',
  });
});

// @desc    Check out a visitor
// @route   POST /api/visitors/:id/checkout
// @access  Protected
const checkOutVisitor = asyncHandler(async (req, res) => {
  const visitor = await Visitor.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!visitor) {
    return res.status(404).json({ success: false, message: 'Visitor not found' });
  }

  if (visitor.status !== 'checked-in') {
    return res.status(400).json({ success: false, message: `Visitor is already ${visitor.status}` });
  }

  visitor.status = 'checked-out';
  visitor.checkOutTime = new Date();
  if (req.body.feedback) visitor.feedback = req.body.feedback.trim();
  if (req.body.rating) visitor.rating = Number(req.body.rating);
  if (req.body.securityNotes) visitor.securityNotes = req.body.securityNotes.trim();
  await visitor.save();

  const durationMinutes = Math.round((visitor.checkOutTime - new Date(visitor.checkInTime)) / 60000);

  logAudit(req, 'update', 'visitor', {
    resourceId: visitor._id,
    description: `Visitor checked out: ${visitor.visitorName} (Duration: ${durationMinutes} mins)`,
  });

  if (req.io) {
    req.io.to(`college:${req.user.collegeId}`).emit('visitor_update', {
      action: 'checked-out',
      visitor,
      durationMinutes,
    });
  }

  res.json({
    success: true,
    visitor,
    data: visitor,
    durationMinutes,
    message: 'Visitor checked out successfully',
  });
});

// @desc    Cancel a visitor check-in or pre-registration
// @route   POST /api/visitors/:id/cancel
// @access  Protected
const cancelVisitor = asyncHandler(async (req, res) => {
  const visitor = await Visitor.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!visitor) {
    return res.status(404).json({ success: false, message: 'Visitor not found' });
  }

  visitor.status = 'cancelled';
  if (req.body.reason) {
    visitor.securityNotes = `${visitor.securityNotes || ''} [Cancelled: ${req.body.reason}]`.trim();
  }
  await visitor.save();

  logAudit(req, 'update', 'visitor', {
    resourceId: visitor._id,
    description: `Visitor pass cancelled: ${visitor.visitorName} (${visitor.gatePass})`,
  });

  res.json({ success: true, visitor, data: visitor, message: 'Visitor pass cancelled' });
});

// @desc    Blacklist or un-blacklist a visitor
// @route   POST /api/visitors/blacklist
// @access  Protected
const blacklistVisitor = asyncHandler(async (req, res) => {
  const { visitorId, isBlacklisted, blacklistReason } = req.body;
  if (!visitorId) {
    return res.status(400).json({ success: false, message: 'visitorId is required' });
  }

  const visitor = await Visitor.findOne({ _id: visitorId, collegeId: req.user.collegeId });
  if (!visitor) {
    return res.status(404).json({ success: false, message: 'Visitor not found' });
  }

  visitor.isBlacklisted = isBlacklisted !== false;
  visitor.blacklistReason = blacklistReason || '';
  await visitor.save();

  logAudit(req, 'update', 'visitor', {
    resourceId: visitor._id,
    description: `Visitor ${visitor.isBlacklisted ? 'blacklisted' : 'removed from blacklist'}: ${visitor.visitorName}`,
  });

  res.json({
    success: true,
    message: `Visitor ${visitor.isBlacklisted ? 'blacklisted' : 'unblacklisted'} successfully`,
    visitor,
    data: visitor,
  });
});

// @desc    Get visitor statistics and analytics
// @route   GET /api/visitors/stats
// @access  Protected
const getVisitorStats = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const since = new Date();
  since.setDate(since.getDate() - parseInt(days));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    statusStats,
    categoryStats,
    dailyCount,
    totalVisitors,
    currentlyInside,
    checkedOutToday,
    blacklisted,
    preRegistered,
  ] = await Promise.all([
    Visitor.aggregate([
      { $match: { collegeId: req.user.collegeId, checkInTime: { $gte: since } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Visitor.aggregate([
      { $match: { collegeId: req.user.collegeId, checkInTime: { $gte: since } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
    Visitor.aggregate([
      { $match: { collegeId: req.user.collegeId, checkInTime: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$checkInTime' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Visitor.countDocuments({ collegeId: req.user.collegeId, checkInTime: { $gte: since } }),
    Visitor.countDocuments({ collegeId: req.user.collegeId, status: 'checked-in' }),
    Visitor.countDocuments({ collegeId: req.user.collegeId, status: 'checked-out', checkOutTime: { $gte: todayStart } }),
    Visitor.countDocuments({ collegeId: req.user.collegeId, isBlacklisted: true }),
    Visitor.countDocuments({ collegeId: req.user.collegeId, status: 'pre-registered' }),
  ]);

  const statsObj = {
    total: totalVisitors,
    totalVisitors,
    currentlyInside,
    checkedIn: currentlyInside,
    checkedOutToday,
    blacklisted,
    preRegistered,
    byStatus: Object.fromEntries(statusStats.map(s => [s._id, s.count])),
    byCategory: Object.fromEntries(categoryStats.map(c => [c._id, c.count])),
    dailyTrend: dailyCount,
  };

  res.json({
    success: true,
    stats: statsObj,
    data: statsObj,
  });
});

// @desc    Export visitors as CSV
// @route   GET /api/visitors/export
// @access  Protected
const exportVisitors = asyncHandler(async (req, res) => {
  const visitors = await Visitor.find({ collegeId: req.user.collegeId })
    .sort({ checkInTime: -1 })
    .limit(1000);

  const headers = ['Gate Pass', 'Visitor Name', 'Phone', 'Email', 'Category', 'Purpose', 'Host', 'Department', 'Check-In', 'Check-Out', 'Status', 'Vehicle'];
  const rows = visitors.map(v => [
    v.gatePass || '',
    `"${(v.visitorName || '').replace(/"/g, '""')}"`,
    v.visitorPhone || '',
    v.visitorEmail || '',
    v.category || '',
    `"${(v.purpose || '').replace(/"/g, '""')}"`,
    `"${(v.hostName || '').replace(/"/g, '""')}"`,
    v.department || '',
    v.checkInTime ? new Date(v.checkInTime).toISOString() : '',
    v.checkOutTime ? new Date(v.checkOutTime).toISOString() : '',
    v.status || '',
    v.vehicleNumber || '',
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="visitors_export_${Date.now()}.csv"`);
  res.status(200).send(csvContent);
});

// @desc    Delete a visitor log
// @route   DELETE /api/visitors/:id
// @access  Protected
const deleteVisitor = asyncHandler(async (req, res) => {
  const visitor = await Visitor.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!visitor) {
    return res.status(404).json({ success: false, message: 'Visitor not found' });
  }

  logAudit(req, 'delete', 'visitor', {
    resourceId: visitor._id,
    description: `Deleted visitor log: ${visitor.visitorName} (${visitor.gatePass})`,
  });

  res.json({ success: true, message: 'Visitor record deleted' });
});

module.exports = {
  createVisitor,
  preRegisterVisitor,
  checkInPreRegistered,
  getVisitors,
  getVisitorById,
  getGatePass,
  verifyGatePass,
  checkOutVisitor,
  cancelVisitor,
  blacklistVisitor,
  getVisitorStats,
  exportVisitors,
  deleteVisitor,
};
