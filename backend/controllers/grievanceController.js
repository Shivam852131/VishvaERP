const asyncHandler = require('../middleware/asyncHandler');
const Grievance = require('../models/Grievance');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');

const createGrievance = asyncHandler(async (req, res) => {
  const { category, subject, description, priority, assignedTo } = req.body;
  const isAnonymous = req.body.isAnonymous !== undefined ? req.body.isAnonymous : Boolean(req.body.anonymous);
  if (!category || !subject || !description) {
    return res.status(400).json({ success: false, message: 'Category, subject and description are required' });
  }
  const grievance = await Grievance.create({
    collegeId: req.user.collegeId,
    raisedBy: req.user._id,
    category,
    subject,
    description,
    priority: priority || 'medium',
    isAnonymous,
    assignedTo,
    escalationTier: 1,
  });
  logAudit(req, 'create', 'grievance', { resourceId: grievance._id, description: `Grievance raised: ${subject}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin'], resource: 'grievances', action: 'created' });
  res.status(201).json({ success: true, grievance, data: grievance });
});

const getGrievances = asyncHandler(async (req, res) => {
  const { status, category, priority, tier, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (req.user.role === 'student' || req.user.role === 'parent') query.raisedBy = req.user._id;
  if (status) query.status = status;
  if (category) query.category = category;
  if (priority) query.priority = priority;
  if (tier) query.escalationTier = Number(tier);
  const skip = (Number(page) - 1) * Number(limit);
  const [grievances, total] = await Promise.all([
    Grievance.find(query).populate('raisedBy', 'name role').populate('assignedTo', 'name').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Grievance.countDocuments(query),
  ]);
  res.json({ success: true, grievances, total, pages: Math.ceil(total / Number(limit)) });
});

const getGrievanceById = asyncHandler(async (req, res) => {
  const grievance = await Grievance.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('raisedBy', 'name role email')
    .populate('assignedTo', 'name email')
    .populate('responses.responder', 'name role');
  if (!grievance) return res.status(404).json({ success: false, message: 'Grievance not found' });

  const isStaff = ['collegeAdmin', 'superadmin', 'faculty'].includes(req.user.role);
  const grievanceObj = grievance.toObject();

  if (!isStaff) {
    grievanceObj.responses = (grievanceObj.responses || []).filter(r => !r.isInternal);
  }

  // Enrich responses with 'from' field for frontend display compatibility
  grievanceObj.responses = (grievanceObj.responses || []).map(r => ({
    ...r,
    from: (r.responder?.role === 'collegeAdmin' || r.responder?.role === 'superadmin')
      ? 'admin'
      : (String(r.responder?._id || r.responder) === String(req.user._id) ? 'student' : 'staff'),
  }));

  res.json({ success: true, grievance: grievanceObj });
});

const updateGrievance = asyncHandler(async (req, res) => {
  const grievance = await Grievance.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!grievance) return res.status(404).json({ success: false, message: 'Grievance not found' });

  const isAdmin = ['collegeAdmin', 'superadmin'].includes(req.user.role);
  const { status, assignedTo, priority, resolution } = req.body;

  if (!isAdmin) {
    if (String(grievance.raisedBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this grievance' });
    }
    if (status && (status === 'closed' || status === 'reopened')) {
      grievance.status = status;
      await grievance.save();
      logAudit(req, 'update', 'grievance', { resourceId: grievance._id, description: `Grievance status changed to ${grievance.status} by owner` });
      return res.json({ success: true, grievance });
    }
    return res.status(400).json({ success: false, message: 'Invalid action for grievance owner' });
  }

  if (status) {
    grievance.status = status;
    if (status === 'resolved') {
      grievance.resolvedAt = new Date();
      if (resolution) grievance.resolution = resolution;
    }
  }
  if (resolution) grievance.resolution = resolution;
  if (assignedTo) grievance.assignedTo = assignedTo;
  if (priority) grievance.priority = priority;
  await grievance.save();
  logAudit(req, 'update', 'grievance', { resourceId: grievance._id, description: `Grievance updated to ${grievance.status}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'student'], resource: 'grievances', action: 'updated' });
  res.json({ success: true, grievance });
});

const escalateGrievance = asyncHandler(async (req, res) => {
  const grievance = await Grievance.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!grievance) return res.status(404).json({ success: false, message: 'Grievance not found' });

  const isOwner = String(grievance.raisedBy) === String(req.user._id);
  const isAdmin = ['collegeAdmin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, message: 'Not authorized to escalate this grievance' });
  }

  const newTier = req.body.tier ? Math.min(3, Math.max(1, Number(req.body.tier))) : Math.min(3, (grievance.escalationTier || 1) + 1);
  const reason = req.body.reason || 'Escalated due to SLA breach or required supervisory attention';

  grievance.escalationTier = newTier;
  grievance.status = 'under-review';
  // Accelerated SLA for escalated tickets
  grievance.slaDeadline = new Date(Date.now() + 24 * 3600 * 1000);

  grievance.responses.push({
    responder: req.user._id,
    message: `[ESCALATION - TIER ${newTier}]: ${reason}`,
    isInternal: false,
    createdAt: new Date(),
  });

  await grievance.save();

  logAudit(req, 'update', 'grievance_escalation', {
    resourceId: grievance._id,
    description: `Grievance ${grievance.trackingId} escalated to Tier ${newTier}`,
    metadata: { newTier, reason },
  });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'student'], resource: 'grievances', action: 'escalated' });

  res.json({
    success: true,
    message: `Grievance escalated to Tier ${newTier}`,
    escalationTier: newTier,
    grievance,
  });
});

const addResponse = asyncHandler(async (req, res) => {
  const grievance = await Grievance.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!grievance) return res.status(404).json({ success: false, message: 'Grievance not found' });

  const isStaff = ['collegeAdmin', 'superadmin', 'faculty'].includes(req.user.role);
  if (!isStaff && String(grievance.raisedBy) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Not authorized to respond to this grievance' });
  }

  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Response message is required' });
  }

  const isInternal = isStaff ? Boolean(req.body.isInternal) : false;
  grievance.responses.push({ responder: req.user._id, message: message.trim(), isInternal });
  if (grievance.status === 'open' && isStaff) grievance.status = 'in-progress';
  await grievance.save();
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'student'], resource: 'grievances', action: 'responded' });
  res.json({ success: true, grievance });
});

const addFeedback = asyncHandler(async (req, res) => {
  const grievance = await Grievance.findOne({ _id: req.params.id, collegeId: req.user.collegeId, raisedBy: req.user._id });
  if (!grievance) return res.status(404).json({ success: false, message: 'Grievance not found' });
  const { feedback, feedbackComment, satisfactionRating } = req.body;
  grievance.feedback = feedback;
  if (feedbackComment) grievance.feedbackComment = feedbackComment;
  if (satisfactionRating) grievance.satisfactionRating = Number(satisfactionRating);
  grievance.status = 'closed';
  await grievance.save();
  res.json({ success: true, grievance });
});

const getGrievanceStats = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  const [statusCounts, categoryCounts, priorityCounts, tierCounts] = await Promise.all([
    Grievance.aggregate([
      { $match: query },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Grievance.aggregate([
      { $match: query },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
    Grievance.aggregate([
      { $match: query },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]),
    Grievance.aggregate([
      { $match: query },
      { $group: { _id: '$escalationTier', count: { $sum: 1 } } },
    ]),
  ]);
  const total = await Grievance.countDocuments(query);
  const avgResolutionTime = await Grievance.aggregate([
    { $match: { ...query, resolvedAt: { $exists: true } } },
    { $project: { diff: { $subtract: ['$resolvedAt', '$createdAt'] } } },
    { $group: { _id: null, avg: { $avg: '$diff' } } },
  ]);
  res.json({
    success: true,
    total,
    byStatus: Object.fromEntries(statusCounts.map(s => [s._id, s.count])),
    byCategory: Object.fromEntries(categoryCounts.map(c => [c._id, c.count])),
    byPriority: Object.fromEntries(priorityCounts.map(p => [p._id, p.count])),
    byTier: Object.fromEntries(tierCounts.map(t => [t._id, t.count])),
    avgResolutionHours: avgResolutionTime[0] ? Math.round(avgResolutionTime[0].avg / 3600000) : 0,
  });
});

module.exports = {
  createGrievance,
  getGrievances,
  getGrievanceById,
  updateGrievance,
  escalateGrievance,
  addResponse,
  addFeedback,
  getGrievanceStats,
};
