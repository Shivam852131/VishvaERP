const asyncHandler = require('../middleware/asyncHandler');
const Grievance = require('../models/Grievance');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');

const createGrievance = asyncHandler(async (req, res) => {
  const { category, subject, description, priority, isAnonymous, assignedTo } = req.body;
  if (!category || !subject || !description) {
    return res.status(400).json({ success: false, message: 'Category, subject and description are required' });
  }
  const grievance = await Grievance.create({
    collegeId: req.user.collegeId,
    raisedBy: req.user._id,
    category, subject, description, priority, isAnonymous, assignedTo,
  });
  logAudit(req, 'create', 'grievance', { resourceId: grievance._id, description: `Grievance raised: ${subject}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin'], resource: 'grievances', action: 'created' });
  res.status(201).json({ success: true, grievance });
});

const getGrievances = asyncHandler(async (req, res) => {
  const { status, category, priority, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (req.user.role === 'student' || req.user.role === 'parent') query.raisedBy = req.user._id;
  if (status) query.status = status;
  if (category) query.category = category;
  if (priority) query.priority = priority;
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
  res.json({ success: true, grievance });
});

const updateGrievance = asyncHandler(async (req, res) => {
  const grievance = await Grievance.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!grievance) return res.status(404).json({ success: false, message: 'Grievance not found' });
  const { status, assignedTo, priority } = req.body;
  if (status) {
    grievance.status = status;
    if (status === 'resolved') grievance.resolvedAt = new Date();
  }
  if (assignedTo) grievance.assignedTo = assignedTo;
  if (priority) grievance.priority = priority;
  await grievance.save();
  logAudit(req, 'update', 'grievance', { resourceId: grievance._id, description: `Grievance updated to ${grievance.status}` });
  res.json({ success: true, grievance });
});

const addResponse = asyncHandler(async (req, res) => {
  const grievance = await Grievance.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!grievance) return res.status(404).json({ success: false, message: 'Grievance not found' });
  const { message, isInternal } = req.body;
  grievance.responses.push({ responder: req.user._id, message, isInternal });
  if (grievance.status === 'open') grievance.status = 'in-progress';
  await grievance.save();
  res.json({ success: true, grievance });
});

const addFeedback = asyncHandler(async (req, res) => {
  const grievance = await Grievance.findOne({ _id: req.params.id, collegeId: req.user.collegeId, raisedBy: req.user._id });
  if (!grievance) return res.status(404).json({ success: false, message: 'Grievance not found' });
  const { feedback, feedbackComment } = req.body;
  grievance.feedback = feedback;
  grievance.feedbackComment = feedbackComment;
  grievance.status = 'closed';
  await grievance.save();
  res.json({ success: true, grievance });
});

const getGrievanceStats = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  const [statusCounts, categoryCounts, priorityCounts] = await Promise.all([
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
  ]);
  const total = await Grievance.countDocuments(query);
  const avgResolutionTime = await Grievance.aggregate([
    { $match: { ...query, resolvedAt: { $exists: true } } },
    { $project: { diff: { $subtract: ['$resolvedAt', '$createdAt'] } } },
    { $group: { _id: null, avg: { $avg: '$diff' } } },
  ]);
  res.json({
    success: true, total,
    byStatus: Object.fromEntries(statusCounts.map(s => [s._id, s.count])),
    byCategory: Object.fromEntries(categoryCounts.map(c => [c._id, c.count])),
    byPriority: Object.fromEntries(priorityCounts.map(p => [p._id, p.count])),
    avgResolutionHours: avgResolutionTime[0] ? Math.round(avgResolutionTime[0].avg / 3600000) : 0,
  });
});

module.exports = { createGrievance, getGrievances, getGrievanceById, updateGrievance, addResponse, addFeedback, getGrievanceStats };
