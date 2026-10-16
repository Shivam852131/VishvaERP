const asyncHandler = require('../middleware/asyncHandler');
const { Mentorship, MentorSession } = require('../models/Mentorship');
const User = require('../models/User');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

const getAvailableMentors = asyncHandler(async (req, res) => {
  const { type, search } = req.query;
  const query = { collegeId: req.user.collegeId, role: 'faculty', isActive: true };
  if (search) query.name = { $regex: search, $options: 'i' };

  const mentors = await User.find(query).select('name email avatar designation subjects department');
  const mentorIds = mentors.map(m => m._id);
  const activeMentorships = await Mentorship.aggregate([
    { $match: { collegeId: req.user.collegeId, mentorId: { $in: mentorIds }, status: 'active' } },
    { $group: { _id: '$mentorId', count: { $sum: 1 } } },
  ]);
  const countMap = {};
  activeMentorships.forEach(m => { countMap[m._id.toString()] = m.count; });

  const result = mentors.map(m => ({
    ...m.toObject(),
    activeMentees: countMap[m._id.toString()] || 0,
    available: (countMap[m._id.toString()] || 0) < 5,
  }));

  res.json({ success: true, mentors: result });
});

const requestMentorship = asyncHandler(async (req, res) => {
  const { mentorId, type, goals } = req.body;
  if (!mentorId) return res.status(400).json({ success: false, message: 'mentorId is required' });

  const existing = await Mentorship.findOne({
    collegeId: req.user.collegeId, mentorId, menteeId: req.user._id,
  });
  if (existing && ['pending', 'active'].includes(existing.status)) {
    return res.status(400).json({ success: false, message: 'Mentorship already exists' });
  }

  const mentorship = await Mentorship.create({
    collegeId: req.user.collegeId,
    mentorId,
    menteeId: req.user._id,
    type: type || 'career',
    goals: goals || [],
    status: 'pending',
  });

  logAudit(req, 'create', 'mentorship', { resourceId: mentorship._id, description: `Requested mentorship from ${mentorId}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['faculty'], resource: 'mentorship', action: 'created' });

  res.status(201).json({ success: true, mentorship });
});

const getMyMentorships = asyncHandler(async (req, res) => {
  const isMentor = req.user.role === 'faculty';
  const filter = isMentor ? { mentorId: req.user._id } : { menteeId: req.user._id };

  const mentorships = await Mentorship.find({ collegeId: req.user.collegeId, ...filter })
    .populate('mentorId', 'name avatar designation department')
    .populate('menteeId', 'name avatar department semester')
    .sort({ updatedAt: -1 });

  res.json({ success: true, mentorships });
});

const updateMentorshipStatus = asyncHandler(async (req, res) => {
  const { status, rating, feedback } = req.body;
  const mentorship = await Mentorship.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!mentorship) return res.status(404).json({ success: false, message: 'Mentorship not found' });

  const isMentor = mentorship.mentorId.toString() === req.user._id.toString();
  const isMentee = mentorship.menteeId.toString() === req.user._id.toString();
  if (!isMentor && !isMentee && req.user.role !== 'collegeAdmin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  if (status) {
    mentorship.status = status;
    if (status === 'active') mentorship.startDate = new Date();
    if (['completed', 'rejected'].includes(status)) mentorship.endDate = new Date();
  }
  if (rating && isMentee) mentorship.rating = rating;
  if (feedback && isMentee) mentorship.feedback = feedback;
  if (isMentor && req.body.notes) mentorship.notes = req.body.notes;

  await mentorship.save();
  logAudit(req, 'update', 'mentorship', { resourceId: mentorship._id, description: `Status: ${mentorship.status}` });
  res.json({ success: true, mentorship });
});

const scheduleSession = asyncHandler(async (req, res) => {
  const { mentorshipId, scheduledAt, duration, topic, meetingUrl, location } = req.body;
  if (!mentorshipId || !scheduledAt) {
    return res.status(400).json({ success: false, message: 'mentorshipId and scheduledAt are required' });
  }

  const mentorship = await Mentorship.findOne({ _id: mentorshipId, collegeId: req.user.collegeId, status: 'active' });
  if (!mentorship) return res.status(404).json({ success: false, message: 'Active mentorship not found' });

  const session = await MentorSession.create({
    collegeId: req.user.collegeId,
    mentorshipId,
    mentorId: mentorship.mentorId,
    menteeId: mentorship.menteeId,
    scheduledAt: new Date(scheduledAt),
    duration: duration || 30,
    topic,
    meetingUrl,
    location,
  });

  await Mentorship.findByIdAndUpdate(mentorshipId, { $inc: { totalSessions: 1 } });
  logAudit(req, 'create', 'mentor-session', { resourceId: session._id, description: `Session: ${topic}` });
  res.status(201).json({ success: true, session });
});

const getMySessions = asyncHandler(async (req, res) => {
  const isMentor = req.user.role === 'faculty';
  const filter = isMentor ? { mentorId: req.user._id } : { menteeId: req.user._id };

  const sessions = await MentorSession.find({ collegeId: req.user.collegeId, ...filter })
    .populate('mentorId', 'name avatar designation')
    .populate('menteeId', 'name avatar department')
    .sort({ scheduledAt: -1 })
    .limit(50);

  res.json({ success: true, sessions });
});

const updateSession = asyncHandler(async (req, res) => {
  const { status, notes, rating, menteeFeedback, mentorFeedback } = req.body;
  const session = await MentorSession.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

  if (status) session.status = status;
  if (notes) session.notes = notes;
  if (rating) session.rating = rating;
  if (menteeFeedback) session.menteeFeedback = menteeFeedback;
  if (mentorFeedback) session.mentorFeedback = mentorFeedback;

  await session.save();
  res.json({ success: true, session });
});

const getMentorshipStats = asyncHandler(async (req, res) => {
  const stats = await Mentorship.aggregate([
    { $match: { collegeId: req.user.collegeId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const sessionStats = await MentorSession.aggregate([
    { $match: { collegeId: req.user.collegeId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const avgRating = await Mentorship.aggregate([
    { $match: { collegeId: req.user.collegeId, rating: { $exists: true, $ne: null } } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  const byType = await Mentorship.aggregate([
    { $match: { collegeId: req.user.collegeId } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);

  res.json({
    success: true,
    stats: {
      mentorships: Object.fromEntries(stats.map(s => [s._id, s.count])),
      sessions: Object.fromEntries(sessionStats.map(s => [s._id, s.count])),
      avgRating: avgRating[0]?.avg || 0,
      totalReviews: avgRating[0]?.count || 0,
      byType: Object.fromEntries(byType.map(s => [s._id, s.count])),
    },
  });
});

module.exports = {
  getAvailableMentors, requestMentorship, getMyMentorships, updateMentorshipStatus,
  scheduleSession, getMySessions, updateSession, getMentorshipStats,
};
