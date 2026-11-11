const asyncHandler = require('../middleware/asyncHandler');
const { Alumni, AlumniEvent, AlumniDonation } = require('../models/Alumni');
const { logAudit } = require('../services/auditService');
const { regexFilter } = require('../utils/parseHelpers');

/**
 * Explicit allow-lists.
 *
 * Passing `req.body` straight into `create()` / `findOneAndUpdate()` lets a
 * caller write fields they should never control (tenant id, audit actor,
 * donation settlement status, mentor flags). Only the fields below are
 * writable, and the tenant/actor fields are always set server-side.
 */
const ALUMNI_WRITABLE_FIELDS = [
  'name', 'email', 'phone', 'graduationYear', 'department', 'course', 'rollNo',
  'currentCompany', 'designation', 'location', 'linkedin', 'achievements',
  'isMentor', 'isAvailableForMentoring', 'batch', 'profileImage', 'bio', 'userId',
];

const ALUMNI_EVENT_WRITABLE_FIELDS = [
  'title', 'description', 'date', 'venue', 'type', 'maxAttendees',
  'isVirtual', 'meetingLink',
];

const ALUMNI_DONATION_WRITABLE_FIELDS = [
  'alumniId', 'amount', 'purpose', 'category', 'paymentMethod',
  'transactionId', 'receiptNo', 'remarks',
];

/**
 * Copy only allow-listed keys out of an untrusted payload.
 */
const pick = (source, fields) => {
  const output = {};
  if (!source || typeof source !== 'object') return output;
  for (const field of fields) {
    if (source[field] !== undefined) {
      output[field] = source[field];
    }
  }
  return output;
};

const addAlumni = asyncHandler(async (req, res) => {
  // `collegeId` is applied last so a client supplied value can never move the
  // record into another tenant.
  const alumni = await Alumni.create({
    ...pick(req.body, ALUMNI_WRITABLE_FIELDS),
    collegeId: req.user.collegeId,
  });
  logAudit(req, 'create', 'alumni', { resourceId: alumni._id, description: `Added alumni: ${alumni.name}` });
  res.status(201).json({ success: true, alumni });
});

const getAlumni = asyncHandler(async (req, res) => {
  const { graduationYear, department, search, isMentor, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (graduationYear) query.graduationYear = Number(graduationYear);
  if (department) query.department = department;
  if (isMentor === 'true') query.isMentor = true;
  if (search) {
    query.$or = [{ name: regexFilter(search) }, { currentCompany: regexFilter(search) }];
  }
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
  const alumni = await Alumni.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    { $set: pick(req.body, ALUMNI_WRITABLE_FIELDS) },
    { new: true, runValidators: true },
  );
  if (!alumni) return res.status(404).json({ success: false, message: 'Alumni not found' });
  res.json({ success: true, alumni });
});

const createAlumniEvent = asyncHandler(async (req, res) => {
  // `organizer` (the audit actor) and `attendees` are server-controlled.
  const event = await AlumniEvent.create({
    ...pick(req.body, ALUMNI_EVENT_WRITABLE_FIELDS),
    collegeId: req.user.collegeId,
    organizer: req.user._id,
  });
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

  // The attendee must be a real alumni record of this college.
  const alumniId = req.body.alumniId;
  if (!alumniId) {
    return res.status(400).json({ success: false, message: 'alumniId is required' });
  }
  const alumni = await Alumni.findOne({ _id: alumniId, collegeId: req.user.collegeId }).select('_id');
  if (!alumni) {
    return res.status(404).json({ success: false, message: 'Alumni record not found' });
  }

  const alreadyRegistered = event.attendees.some((a) => String(a.alumniId) === String(alumniId));
  if (alreadyRegistered) return res.status(400).json({ success: false, message: 'Already registered' });
  if (event.maxAttendees && event.attendees.length >= event.maxAttendees) {
    return res.status(400).json({ success: false, message: 'Event is full' });
  }
  event.attendees.push({ alumniId: alumni._id, status: 'registered' });
  await event.save();
  res.json({ success: true, event });
});

const recordDonation = asyncHandler(async (req, res) => {
  const donation = await AlumniDonation.create({
    ...pick(req.body, ALUMNI_DONATION_WRITABLE_FIELDS),
    // A donation is never "settled" by the caller - that would let anyone
    // inflate the institution's donation totals. Status is always server-side.
    status: 'pending',
    collegeId: req.user.collegeId,
  });
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
