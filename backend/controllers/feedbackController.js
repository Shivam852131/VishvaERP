const asyncHandler = require('../middleware/asyncHandler');
const Feedback = require('../models/Feedback');
const { logAudit } = require('../services/auditService');

const submitFeedback = asyncHandler(async (req, res) => {
  const { type, targetId, targetModel, ratings, comment, suggestions, isAnonymous, semester, academicYear } = req.body;
  if (!type || !ratings?.overall) {
    return res.status(400).json({ success: false, message: 'Type and overall rating are required' });
  }
  const existing = await Feedback.findOne({ collegeId: req.user.collegeId, userId: req.user._id, type, targetId });
  if (existing) {
    existing.ratings = ratings;
    existing.comment = comment;
    existing.suggestions = suggestions;
    existing.isAnonymous = isAnonymous;
    await existing.save();
    return res.json({ success: true, message: 'Feedback updated', feedback: existing });
  }
  const feedback = await Feedback.create({
    collegeId: req.user.collegeId, userId: req.user._id,
    type, targetId, targetModel, ratings, comment, suggestions, isAnonymous, semester, academicYear,
  });
  logAudit(req, 'create', 'feedback', { resourceId: feedback._id, description: `Feedback submitted for ${type}` });
  res.status(201).json({ success: true, feedback });
});

const getFeedback = asyncHandler(async (req, res) => {
  const { type, targetId, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (type) query.type = type;
  if (targetId) query.targetId = targetId;
  if (req.user.role === 'student') query.userId = req.user._id;
  const skip = (Number(page) - 1) * Number(limit);
  const [feedbacks, total] = await Promise.all([
    Feedback.find(query).populate('userId', 'name').populate('targetId').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Feedback.countDocuments(query),
  ]);
  const normalized = feedbacks.map(f => ({
    ...f.toObject(),
    userId: f.isAnonymous ? { name: 'Anonymous' } : f.userId,
  }));
  res.json({ success: true, feedbacks: normalized, total, pages: Math.ceil(total / Number(limit)) });
});

const getFeedbackStats = asyncHandler(async (req, res) => {
  const { type, targetId } = req.query;
  const match = { collegeId: req.user.collegeId };
  if (type) match.type = type;
  if (targetId) match.targetId = require('mongoose').Types.ObjectId(targetId);
  const [avgRatings, totalCount, byType] = await Promise.all([
    Feedback.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        avgContent: { $avg: '$ratings.content' },
        avgDelivery: { $avg: '$ratings.delivery' },
        avgCommunication: { $avg: '$ratings.communication' },
        avgOverall: { $avg: '$ratings.overall' },
        count: { $sum: 1 },
      }},
    ]),
    Feedback.countDocuments(match),
    Feedback.aggregate([
      { $match: { collegeId: req.user.collegeId } },
      { $group: { _id: '$type', count: { $sum: 1 }, avgOverall: { $avg: '$ratings.overall' } } },
    ]),
  ]);
  res.json({
    success: true, total: totalCount,
    averages: avgRatings[0] || { avgContent: 0, avgDelivery: 0, avgCommunication: 0, avgOverall: 0 },
    byType,
  });
});

const getMyFeedback = asyncHandler(async (req, res) => {
  const feedbacks = await Feedback.find({ collegeId: req.user.collegeId, userId: req.user._id })
    .populate('targetId').sort({ createdAt: -1 });
  res.json({ success: true, feedbacks });
});

module.exports = { submitFeedback, getFeedback, getFeedbackStats, getMyFeedback };
