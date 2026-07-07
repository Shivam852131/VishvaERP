const asyncHandler = require('../middleware/asyncHandler');
const Event = require('../models/Event');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');

const createEvent = asyncHandler(async (req, res) => {
  const event = await Event.create({ collegeId: req.user.collegeId, organizer: req.user._id, ...req.body });
  logAudit(req, 'create', 'event', { resourceId: event._id, description: `Created event: ${event.title}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['student', 'faculty'], resource: 'events', action: 'created' });
  res.status(201).json({ success: true, event });
});

const getEvents = asyncHandler(async (req, res) => {
  const { category, startDate, endDate, status, page = 1, limit = 50 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (category) query.category = category;
  if (status) query.status = status;
  if (startDate || endDate) {
    query.startDate = {};
    if (startDate) query.startDate.$gte = new Date(startDate);
    if (endDate) query.startDate.$lte = new Date(endDate);
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [events, total] = await Promise.all([
    Event.find(query).populate('organizer', 'name').sort({ startDate: 1 }).skip(skip).limit(Number(limit)),
    Event.countDocuments(query),
  ]);
  res.json({ success: true, events, total, pages: Math.ceil(total / Number(limit)) });
});

const getEventById = asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, collegeId: req.user.collegeId }).populate('organizer', 'name');
  if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
  res.json({ success: true, event });
});

const updateEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOneAndUpdate({ _id: req.params.id, collegeId: req.user.collegeId }, req.body, { new: true });
  if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
  res.json({ success: true, event });
});

const deleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
  res.json({ success: true, message: 'Event deleted' });
});

const registerForEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
  const alreadyRegistered = event.registrations.some(r => String(r.userId) === String(req.user._id));
  if (alreadyRegistered) return res.status(400).json({ success: false, message: 'Already registered' });
  if (event.maxParticipants && event.registrations.length >= event.maxParticipants) {
    return res.status(400).json({ success: false, message: 'Event is full' });
  }
  event.registrations.push({ userId: req.user._id });
  await event.save();
  res.json({ success: true, event });
});

const cancelRegistration = asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
  event.registrations = event.registrations.filter(r => String(r.userId) !== String(req.user._id));
  await event.save();
  res.json({ success: true, event });
});

const getCalendarEvents = asyncHandler(async (req, res) => {
  const { month, year } = req.query;
  const startDate = new Date(Number(year), Number(month) - 1, 1);
  const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);
  const events = await Event.find({
    collegeId: req.user.collegeId,
    status: { $ne: 'cancelled' },
    startDate: { $lte: endDate },
    $or: [{ endDate: { $gte: startDate } }, { endDate: { $exists: false }, startDate: { $gte: startDate, $lte: endDate } }],
  }).select('title startDate endDate startTime endTime category color venue isVirtual status').sort({ startDate: 1 });
  res.json({ success: true, events });
});

const getEventStats = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  const [total, byCategory, upcomingCount] = await Promise.all([
    Event.countDocuments(query),
    Event.aggregate([{ $match: query }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
    Event.countDocuments({ ...query, startDate: { $gte: new Date() }, status: { $ne: 'cancelled' } }),
  ]);
  res.json({ success: true, total, upcomingCount, byCategory });
});

module.exports = { createEvent, getEvents, getEventById, updateEvent, deleteEvent, registerForEvent, cancelRegistration, getCalendarEvents, getEventStats };
