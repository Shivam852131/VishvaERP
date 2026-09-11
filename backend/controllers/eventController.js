const asyncHandler = require('../middleware/asyncHandler');
const Event = require('../models/Event');
const User = require('../models/User');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');

function escapeRegex(text) {
  return String(text || '').replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

const CATEGORY_COLORS = {
  academic: '#3B82F6',
  cultural: '#EC4899',
  sports: '#10B981',
  technical: '#8B5CF6',
  workshop: '#F59E0B',
  seminar: '#6366F1',
  holiday: '#EF4444',
  examination: '#7C3AED',
  other: '#64748B',
};

// @desc    Create a new campus event
// @route   POST /api/events
// @access  Protected (Admin, Faculty)
const createEvent = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    category,
    startDate,
    endDate,
    startTime,
    endTime,
    venue,
    isVirtual,
    meetingLink,
    targetAudience,
    departments,
    maxParticipants,
    isPublic,
    color,
    status,
  } = req.body;

  if (!title || !startDate || !category) {
    return res.status(400).json({ success: false, message: 'Title, category, and start date are required' });
  }

  const assignedColor = color || CATEGORY_COLORS[category] || '#4F46E5';

  const event = await Event.create({
    collegeId: req.user.collegeId,
    organizer: req.user._id,
    title: title.trim(),
    description: description ? description.trim() : '',
    category,
    startDate: new Date(startDate),
    endDate: endDate ? new Date(endDate) : undefined,
    startTime: startTime || '',
    endTime: endTime || '',
    venue: venue ? venue.trim() : (isVirtual ? 'Virtual Platform' : 'Campus Auditorium'),
    isVirtual: Boolean(isVirtual),
    meetingLink: meetingLink || '',
    targetAudience: Array.isArray(targetAudience) && targetAudience.length ? targetAudience : ['all'],
    departments: Array.isArray(departments) ? departments : [],
    maxParticipants: maxParticipants ? Number(maxParticipants) : undefined,
    isPublic: isPublic !== false,
    color: assignedColor,
    status: status || 'published',
  });

  logAudit(req, 'create', 'event', {
    resourceId: event._id,
    description: `Created campus event: ${event.title} (${event.category})`,
  });

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['student', 'faculty', 'collegeAdmin'],
    resource: 'events',
    action: 'created',
  });

  if (req.io) {
    req.io.to(`college:${req.user.collegeId}`).emit('event_update', { action: 'created', event });
  }

  res.status(201).json({
    success: true,
    event,
    data: event,
    message: 'Event created successfully',
  });
});

// @desc    Get paginated events with filters and search
// @route   GET /api/events
// @access  Protected
const getEvents = asyncHandler(async (req, res) => {
  const {
    category,
    startDate,
    endDate,
    status,
    search,
    isVirtual,
    page = 1,
    limit = 50,
  } = req.query;

  const query = { collegeId: req.user.collegeId };

  if (category && category !== 'all') {
    query.category = category;
  }

  if (status && status !== 'all') {
    query.status = status;
  }

  if (isVirtual !== undefined && isVirtual !== '') {
    query.isVirtual = isVirtual === 'true';
  }

  if (startDate || endDate) {
    query.startDate = {};
    if (startDate) query.startDate.$gte = new Date(startDate);
    if (endDate) query.startDate.$lte = new Date(endDate);
  }

  if (search && search.trim()) {
    const s = search.trim();
    query.$or = [
      { title: { $regex: escapeRegex(s), $options: 'i' } },
      { description: { $regex: escapeRegex(s), $options: 'i' } },
      { venue: { $regex: escapeRegex(s), $options: 'i' } },
    ];
  }

  const numLimit = Math.min(Number(limit) || 50, 200);
  const numPage = Math.max(Number(page) || 1, 1);
  const skip = (numPage - 1) * numLimit;

  const [events, total] = await Promise.all([
    Event.find(query)
      .populate('organizer', 'name email role')
      .sort({ startDate: 1 })
      .skip(skip)
      .limit(numLimit),
    Event.countDocuments(query),
  ]);

  // Enrich event with user-specific registration status if logged in
  const enriched = events.map(e => {
    const obj = e.toObject();
    const userReg = (obj.registrations || []).find(r => String(r.userId) === String(req.user._id));
    return {
      ...obj,
      isRegistered: Boolean(userReg),
      myTicket: userReg ? userReg.ticketNumber : null,
      myTicketStatus: userReg ? userReg.status : null,
      registeredCount: obj.registrations?.length || 0,
      availableSeats: obj.maxParticipants ? Math.max(0, obj.maxParticipants - (obj.registrations?.length || 0)) : null,
    };
  });

  res.json({
    success: true,
    events: enriched,
    data: enriched,
    total,
    page: numPage,
    pages: Math.ceil(total / numLimit) || 1,
  });
});

// @desc    Get event by ID with full registration roster
// @route   GET /api/events/:id
// @access  Protected
const getEventById = asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('organizer', 'name email designation phone')
    .populate('registrations.userId', 'name email rollNo department semester role');

  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }

  const obj = event.toObject();
  const userReg = (obj.registrations || []).find(r => String(r.userId?._id || r.userId) === String(req.user._id));

  res.json({
    success: true,
    event: {
      ...obj,
      isRegistered: Boolean(userReg),
      myTicket: userReg?.ticketNumber || null,
      registeredCount: obj.registrations?.length || 0,
      attendedCount: (obj.registrations || []).filter(r => r.status === 'attended').length,
    },
    data: event,
  });
});

// @desc    Update event details
// @route   PUT /api/events/:id
// @access  Protected (Admin, Organizer)
const updateEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true, runValidators: true }
  );

  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }

  logAudit(req, 'update', 'event', {
    resourceId: event._id,
    description: `Updated event: ${event.title}`,
  });

  res.json({ success: true, event, data: event, message: 'Event updated successfully' });
});

// @desc    Delete an event
// @route   DELETE /api/events/:id
// @access  Protected (Admin)
const deleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }

  logAudit(req, 'delete', 'event', {
    resourceId: event._id,
    description: `Deleted event: ${event.title}`,
  });

  res.json({ success: true, message: 'Event deleted successfully' });
});

// @desc    Register / RSVP for an event and receive ticket
// @route   POST /api/events/:id/register
// @access  Protected
const registerForEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }

  const existingReg = event.registrations.find(r => String(r.userId) === String(req.user._id));
  if (existingReg) {
    return res.status(400).json({
      success: false,
      message: 'You are already registered for this event',
      ticketNumber: existingReg.ticketNumber,
      ticket: existingReg,
    });
  }

  if (event.maxParticipants && event.registrations.length >= event.maxParticipants) {
    return res.status(400).json({ success: false, message: 'This event has reached full capacity' });
  }

  const eventSuffix = event._id.toString().slice(-4).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const ticketNumber = `TKT-${eventSuffix}-${rand}`;

  const newReg = {
    userId: req.user._id,
    ticketNumber,
    registeredAt: new Date(),
    status: 'registered',
  };

  event.registrations.push(newReg);
  await event.save();

  logAudit(req, 'register', 'event', {
    resourceId: event._id,
    description: `User ${req.user.name} registered for ${event.title} (Ticket: ${ticketNumber})`,
  });

  res.json({
    success: true,
    message: 'Registered successfully! Your ticket has been generated.',
    ticketNumber,
    ticket: {
      ticketNumber,
      eventTitle: event.title,
      venue: event.venue,
      startDate: event.startDate,
      startTime: event.startTime,
      qrPayload: JSON.stringify({
        ticketNumber,
        eventId: String(event._id),
        userId: String(req.user._id),
        name: req.user.name,
      }),
    },
    event,
    data: event,
  });
});

// @desc    Verify ticket or check-in attendee at venue gate
// @route   POST /api/events/:id/checkin-attendee
// @access  Protected (Admin, Faculty)
const checkInAttendee = asyncHandler(async (req, res) => {
  const { ticketNumber, userId } = req.body;
  if (!ticketNumber && !userId) {
    return res.status(400).json({ success: false, message: 'Ticket number or user ID is required' });
  }

  const event = await Event.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }

  let attendeeReg = null;
  if (ticketNumber) {
    attendeeReg = event.registrations.find(r => r.ticketNumber === String(ticketNumber).trim());
  } else if (userId) {
    attendeeReg = event.registrations.find(r => String(r.userId) === String(userId).trim());
  }

  if (!attendeeReg) {
    return res.status(404).json({ success: false, message: 'Ticket not found in attendee roster' });
  }

  if (attendeeReg.status === 'attended') {
    return res.status(400).json({
      success: false,
      message: 'Attendee is already checked in',
      attendedAt: attendeeReg.attendedAt,
    });
  }

  attendeeReg.status = 'attended';
  attendeeReg.attendedAt = new Date();
  await event.save();

  const user = await User.findById(attendeeReg.userId).select('name email rollNo department');

  logAudit(req, 'checkin', 'event', {
    resourceId: event._id,
    description: `Attendee checked in: ${user?.name || attendeeReg.ticketNumber} for ${event.title}`,
  });

  res.json({
    success: true,
    message: 'Attendee verified and checked in successfully',
    attendee: {
      ticketNumber: attendeeReg.ticketNumber,
      status: attendeeReg.status,
      attendedAt: attendeeReg.attendedAt,
      user,
    },
    data: event,
  });
});

// @desc    Cancel event registration
// @route   POST /api/events/:id/cancel
// @access  Protected
const cancelRegistration = asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }

  const initialCount = event.registrations.length;
  event.registrations = event.registrations.filter(r => String(r.userId) !== String(req.user._id));

  if (event.registrations.length === initialCount) {
    return res.status(400).json({ success: false, message: 'You are not registered for this event' });
  }

  await event.save();

  logAudit(req, 'cancel_rsvp', 'event', {
    resourceId: event._id,
    description: `User cancelled RSVP for ${event.title}`,
  });

  res.json({ success: true, message: 'Registration cancelled successfully', event, data: event });
});

// @desc    Get monthly calendar events
// @route   GET /api/events/calendar
// @access  Protected
const getCalendarEvents = asyncHandler(async (req, res) => {
  const { month, year } = req.query;

  const y = Number(year) || new Date().getFullYear();
  const m = Number(month) || (new Date().getMonth() + 1);

  const startDate = new Date(y, m - 1, 1);
  const endDate = new Date(y, m, 0, 23, 59, 59);

  const events = await Event.find({
    collegeId: req.user.collegeId,
    status: { $ne: 'cancelled' },
    startDate: { $lte: endDate },
    $or: [
      { endDate: { $gte: startDate } },
      { endDate: { $exists: false }, startDate: { $gte: startDate, $lte: endDate } },
    ],
  })
    .select('title startDate endDate startTime endTime category color venue isVirtual status maxParticipants registrations')
    .sort({ startDate: 1 });

  const formatted = events.map(e => ({
    _id: e._id,
    title: e.title,
    startDate: e.startDate,
    endDate: e.endDate,
    startTime: e.startTime,
    endTime: e.endTime,
    category: e.category,
    color: e.color || CATEGORY_COLORS[e.category] || '#4F46E5',
    venue: e.venue,
    isVirtual: e.isVirtual,
    status: e.status,
    registeredCount: e.registrations?.length || 0,
  }));

  res.json({ success: true, events: formatted, data: formatted });
});

// @desc    Get executive event analytics & stats
// @route   GET /api/events/stats
// @access  Protected (Admin, Faculty)
const getEventStats = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  const now = new Date();

  const [
    total,
    byCategory,
    upcomingCount,
    virtualCount,
    allEvents,
  ] = await Promise.all([
    Event.countDocuments(query),
    Event.aggregate([
      { $match: query },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
    Event.countDocuments({ ...query, startDate: { $gte: now }, status: { $ne: 'cancelled' } }),
    Event.countDocuments({ ...query, isVirtual: true }),
    Event.find(query).select('registrations maxParticipants'),
  ]);

  const totalRegistrations = allEvents.reduce((sum, e) => sum + (e.registrations?.length || 0), 0);
  const attendedCount = allEvents.reduce((sum, e) => sum + (e.registrations?.filter(r => r.status === 'attended').length || 0), 0);

  const statsObj = {
    total,
    totalEvents: total,
    upcomingCount,
    upcomingEvents: upcomingCount,
    virtualEvents: virtualCount,
    totalRegistrations,
    attendedCount,
    attendanceRate: totalRegistrations > 0 ? Math.round((attendedCount / totalRegistrations) * 100) : 0,
    byCategory: Object.fromEntries(byCategory.map(c => [c._id, c.count])),
  };

  res.json({
    success: true,
    stats: statsObj,
    data: statsObj,
    total,
    upcomingCount,
    byCategory,
  });
});

// @desc    Export registered attendees for an event
// @route   GET /api/events/:id/export-attendees
// @access  Protected (Admin, Faculty)
const exportAttendees = asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('registrations.userId', 'name email rollNo department semester phone');

  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }

  const headers = ['Ticket Number', 'Attendee Name', 'Roll Number', 'Email', 'Department', 'Semester', 'Phone', 'Status', 'Registered At', 'Attended At'];
  const rows = (event.registrations || []).map(r => [
    r.ticketNumber || '',
    `"${(r.userId?.name || '').replace(/"/g, '""')}"`,
    r.userId?.rollNo || '',
    r.userId?.email || '',
    r.userId?.department || '',
    r.userId?.semester || '',
    r.userId?.phone || '',
    r.status || 'registered',
    r.registeredAt ? new Date(r.registeredAt).toISOString() : '',
    r.attendedAt ? new Date(r.attendedAt).toISOString() : '',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="event_${event._id}_attendees.csv"`);
  res.status(200).send(csv);
});

module.exports = {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  registerForEvent,
  checkInAttendee,
  cancelRegistration,
  getCalendarEvents,
  getEventStats,
  exportAttendees,
};
