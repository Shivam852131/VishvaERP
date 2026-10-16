const asyncHandler = require('../middleware/asyncHandler');
const { Alumni, AlumniEvent, AlumniDonation } = require('../models/Alumni');
const { logAudit } = require('../services/auditService');

const addAlumni = asyncHandler(async (req, res) => {
  const alumni = await Alumni.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'alumni', { resourceId: alumni._id, description: `Added alumni: ${alumni.name}` });
  res.status(201).json({ success: true, alumni });
});

const getAlumni = asyncHandler(async (req, res) => {
  const { graduationYear, department, search, isMentor, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (graduationYear) query.graduationYear = Number(graduationYear);
  if (department) query.department = department;
  if (isMentor === 'true') query.isMentor = true;
  if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { currentCompany: { $regex: search, $options: 'i' } }];
  const skip = (Number(page) - 1) * Number(limit);
  const [alumni, total] = await Promise.all([
    Alumni.find(query).sort({ graduationYear: -1 }).skip(skip).limit(Number(limit)),
    Alumni.countDocuments(query),
  ]);
  res.json({ success: true, alumni, total, pages: Math.ceil(total / Number(limit)) });
});

const getAlumniById = asyncHandler(async (req, res) => {
  const alumni = await Alumni.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!alumni) return res.status(404).json({ success: false, message: 'Alumni not found' });
  res.json({ success: true, alumni });
});

const updateAlumni = asyncHandler(async (req, res) => {
  const alumni = await Alumni.findOneAndUpdate({ _id: req.params.id, collegeId: req.user.collegeId }, req.body, { new: true });
  if (!alumni) return res.status(404).json({ success: false, message: 'Alumni not found' });
  res.json({ success: true, alumni });
});

const createAlumniEvent = asyncHandler(async (req, res) => {
  const event = await AlumniEvent.create({ collegeId: req.user.collegeId, organizer: req.user._id, ...req.body });
  logAudit(req, 'create', 'alumni-event', { resourceId: event._id, description: `Created alumni event: ${event.title}` });
  res.status(201).json({ success: true, event });
});

const getAlumniEvents = asyncHandler(async (req, res) => {
  const events = await AlumniEvent.find({ collegeId: req.user.collegeId }).populate('organizer', 'name').sort({ date: -1 });
  res.json({ success: true, events });
});

const registerForEvent = asyncHandler(async (req, res) => {
  const event = await AlumniEvent.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
  const alreadyRegistered = event.attendees.some(a => String(a.alumniId) === req.body.alumniId);
  if (alreadyRegistered) return res.status(400).json({ success: false, message: 'Already registered' });
  if (event.maxAttendees && event.attendees.length >= event.maxAttendees) {
    return res.status(400).json({ success: false, message: 'Event is full' });
  }
  event.attendees.push({ alumniId: req.body.alumniId });
  await event.save();
  res.json({ success: true, event });
});

const recordDonation = asyncHandler(async (req, res) => {
  const donation = await AlumniDonation.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'alumni-donation', { resourceId: donation._id, description: `Donation of ₹${donation.amount} recorded` });
  res.status(201).json({ success: true, donation });
});

const getDonations = asyncHandler(async (req, res) => {
  const donations = await AlumniDonation.find({ collegeId: req.user.collegeId })
    .populate('alumniId', 'name graduationYear')
    .sort({ createdAt: -1 });
  const total = await AlumniDonation.aggregate([
    { $match: { collegeId: req.user.collegeId, status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  res.json({ success: true, donations, totalAmount: total[0]?.total || 0 });
});

const getAlumniStats = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  const [totalAlumni, mentors, byYear, byDepartment, totalDonations, eventCount] = await Promise.all([
    Alumni.countDocuments(query),
    Alumni.countDocuments({ ...query, isMentor: true }),
    Alumni.aggregate([{ $match: query }, { $group: { _id: '$graduationYear', count: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 10 }]),
    Alumni.aggregate([{ $match: query }, { $group: { _id: '$department', count: { $sum: 1 } } }]),
    AlumniDonation.aggregate([{ $match: { ...query, status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    AlumniEvent.countDocuments(query),
  ]);
  res.json({
    success: true, totalAlumni, mentors, eventCount,
    byYear, byDepartment,
    totalDonations: totalDonations[0]?.total || 0,
    donationCount: totalDonations[0]?.count || 0,
  });
});

module.exports = { addAlumni, getAlumni, getAlumniById, updateAlumni, createAlumniEvent, getAlumniEvents, registerForEvent, recordDonation, getDonations, getAlumniStats };
