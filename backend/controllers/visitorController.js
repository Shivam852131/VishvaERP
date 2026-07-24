const asyncHandler = require('../middleware/asyncHandler');
const Visitor = require('../models/Visitor');
const User = require('../models/User');
const { logAudit } = require('../services/auditService');

const createVisitor = asyncHandler(async (req, res) => {
  const { visitorName, visitorPhone, purpose, category, hostUserId, department, meetingRoom, expectedDuration, vehicleNumber, vehicleType, itemsCarried, idType, idNumber, visitorEmail } = req.body;
  if (!visitorName || !purpose || !hostUserId) {
    return res.status(400).json({ success: false, message: 'visitorName, purpose, and hostUserId are required' });
  }
  const host = await User.findById(hostUserId).select('name department');
  if (!host) return res.status(404).json({ success: false, message: 'Host user not found' });

  const visitor = await Visitor.create({
    collegeId: req.user.collegeId,
    visitorName, visitorPhone, visitorEmail, purpose, category: category || 'other',
    hostUserId, hostName: host.name, department: department || host.department,
    meetingRoom, expectedDuration, vehicleNumber, vehicleType, itemsCarried,
    idType, idNumber, status: 'checked-in',
    approvedBy: req.user._id,
  });

  logAudit(req, 'create', 'visitor', { resourceId: visitor._id, description: `Visitor checked in: ${visitorName} to meet ${host.name}` });
  res.status(201).json({ success: true, visitor });
});

const preRegisterVisitor = asyncHandler(async (req, res) => {
  const { visitorName, visitorPhone, purpose, category, hostUserId, expectedDuration, vehicleNumber, visitorEmail } = req.body;
  if (!visitorName || !purpose || !hostUserId) {
    return res.status(400).json({ success: false, message: 'visitorName, purpose, and hostUserId are required' });
  }
  const host = await User.findById(hostUserId).select('name');
  if (!host) return res.status(404).json({ success: false, message: 'Host user not found' });

  const visitor = await Visitor.create({
    collegeId: req.user.collegeId,
    visitorName, visitorPhone, visitorEmail, purpose, category: category || 'other',
    hostUserId, hostName: host.name, expectedDuration, vehicleNumber,
    status: 'pre-registered', approvedBy: req.user._id,
  });

  logAudit(req, 'create', 'visitor', { resourceId: visitor._id, description: `Pre-registered visitor: ${visitorName} for ${host.name}` });
  res.status(201).json({ success: true, visitor });
});

const getVisitors = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, category, search, date, hostUserId } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (status) query.status = status;
  if (category) query.category = category;
  if (hostUserId) query.hostUserId = hostUserId;
  if (search) {
    query.$or = [
      { visitorName: { $regex: search, $options: 'i' } },
      { visitorPhone: { $regex: search, $options: 'i' } },
      { hostName: { $regex: search, $options: 'i' } },
      { gatePass: { $regex: search, $options: 'i' } },
    ];
  }
  if (date) {
    const d = new Date(date);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    query.checkInTime = { $gte: d, $lt: next };
  }

  const total = await Visitor.countDocuments(query);
  const visitors = await Visitor.find(query)
    .populate('hostUserId', 'name email department')
    .populate('approvedBy', 'name')
    .sort({ checkInTime: -1 })
    .skip((page - 1) * parseInt(limit))
    .limit(parseInt(limit));

  res.json({ success: true, visitors, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
});

const getVisitorById = asyncHandler(async (req, res) => {
  const visitor = await Visitor.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('hostUserId', 'name email department phone')
    .populate('approvedBy', 'name');
  if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
  res.json({ success: true, visitor });
});

const checkOutVisitor = asyncHandler(async (req, res) => {
  const visitor = await Visitor.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
  if (visitor.status !== 'checked-in') {
    return res.status(400).json({ success: false, message: `Visitor is already ${visitor.status}` });
  }
  visitor.status = 'checked-out';
  visitor.checkOutTime = new Date();
  if (req.body.feedback) visitor.feedback = req.body.feedback;
  if (req.body.rating) visitor.rating = req.body.rating;
  if (req.body.securityNotes) visitor.securityNotes = req.body.securityNotes;
  await visitor.save();

  logAudit(req, 'update', 'visitor', { resourceId: visitor._id, description: `Visitor checked out: ${visitor.visitorName}` });
  res.json({ success: true, visitor });
});

const cancelVisitor = asyncHandler(async (req, res) => {
  const visitor = await Visitor.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
  visitor.status = 'cancelled';
  await visitor.save();
  res.json({ success: true, visitor });
});

const blacklistVisitor = asyncHandler(async (req, res) => {
  const { visitorId, isBlacklisted, blacklistReason } = req.body;
  if (!visitorId) return res.status(400).json({ success: false, message: 'visitorId is required' });
  const visitor = await Visitor.findOne({ _id: visitorId, collegeId: req.user.collegeId });
  if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
  visitor.isBlacklisted = isBlacklisted !== false;
  visitor.blacklistReason = blacklistReason || '';
  await visitor.save();
  res.json({ success: true, message: `Visitor ${visitor.isBlacklisted ? 'blacklisted' : 'unblacklisted'}`, visitor });
});

const getVisitorStats = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const since = new Date();
  since.setDate(since.getDate() - parseInt(days));

  const [statusStats, categoryStats, dailyCount, totalVisitors, currentlyInside] = await Promise.all([
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
  ]);

  res.json({
    success: true,
    stats: {
      totalVisitors, currentlyInside,
      byStatus: statusStats,
      byCategory: categoryStats,
      dailyTrend: dailyCount,
    },
  });
});

const deleteVisitor = asyncHandler(async (req, res) => {
  const visitor = await Visitor.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
  res.json({ success: true, message: 'Visitor record deleted' });
});

module.exports = {
  createVisitor, preRegisterVisitor, getVisitors, getVisitorById,
  checkOutVisitor, cancelVisitor, blacklistVisitor, getVisitorStats, deleteVisitor,
};
