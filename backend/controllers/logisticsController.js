const asyncHandler = require('../middleware/asyncHandler');
const { Hostel, Room } = require('../models/Hostel');
const TransportRoute = require('../models/Transport');
const User = require('../models/User');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

// --- HOSTEL ENDPOINTS ---
// @desc    Add Hostel
const addHostel = asyncHandler(async (req, res) => {
    const hostel = await Hostel.create({ ...req.body, collegeId: req.user.collegeId });
    logAudit(req, 'create', 'hostel', { resourceId: hostel._id, description: `Added hostel: ${hostel.name}`, metadata: { name: hostel.name } });
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'hostels', action: 'created' });
    res.status(201).json({ success: true, hostel });
  });

// @desc    Add Room to Hostel
const addRoom = asyncHandler(async (req, res) => {
    const room = await Room.create({ ...req.body, collegeId: req.user.collegeId });
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'hostels', action: 'room-created' });
    res.status(201).json({ success: true, room });
  });

const allocateRoom = asyncHandler(async (req, res) => {
    const student = await User.findOne({
      collegeId: req.user.collegeId,
      role: 'student',
      $or: [
        { _id: req.body.studentId },
        { rollNo: req.body.rollNo || req.body.roll },
      ],
    }).select('_id');

    if (!student) {
      return res.status(400).json({ success: false, message: 'Valid student is required for room allocation' });
    }

    const room = await Room.findOne({
      collegeId: req.user.collegeId,
      roomNumber: req.body.roomNumber,
      ...(req.body.hostelId ? { hostelId: req.body.hostelId } : {}),
    });

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    if (room.occupants.some((occupantId) => String(occupantId) === String(student._id))) {
      return res.json({ success: true, message: 'Student is already allocated to this room', room });
    }

    if (room.occupants.length >= room.capacity) {
      return res.status(400).json({ success: false, message: 'Room is already full' });
    }

    room.occupants.push(student._id);
    await room.save();
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'hostels', action: 'allocated' });
    res.json({ success: true, message: 'Room allocated successfully', room });
  });

// @desc    Get all Hostels & Rooms
const getHostels = asyncHandler(async (req, res) => {
    const hostels = await Hostel.find({ collegeId: req.user.collegeId }).populate('warden', 'name email');
    const rooms = await Room.find({ collegeId: req.user.collegeId })
      .populate('hostelId', 'name type')
      .populate('occupants', 'name rollNo');
    res.json({ success: true, hostels, rooms });
  });


// --- TRANSPORT ENDPOINTS ---
// @desc    Add Transport Route
const addRoute = asyncHandler(async (req, res) => {
    const stopNames = Array.isArray(req.body.stops)
      ? req.body.stops
      : String(req.body.via || '')
          .split(',')
          .map((stop) => stop.trim())
          .filter(Boolean);

    const route = await TransportRoute.create({
      collegeId: req.user.collegeId,
      routeName: req.body.routeName || req.body.routeNo,
      busNumber: req.body.busNumber,
      driverName: req.body.driverName,
      driverPhone: req.body.driverPhone,
      stops: Array.isArray(req.body.stops)
        ? req.body.stops
        : stopNames.map((stopName, index) => ({
            stopName,
            pickupTime: index === 0 ? (req.body.morningTime || req.body.pickupTime || '') : '',
            dropTime: index === 0 ? (req.body.eveningTime || req.body.dropTime || '') : '',
          })),
      capacity: req.body.capacity || 40,
      enrolledStudents: req.body.enrolledStudents || [],
      isActive: req.body.isActive !== false,
    });
    logAudit(req, 'create', 'transport_route', { resourceId: route._id, description: `Added transport route: ${route.routeName}`, metadata: { routeName: route.routeName } });
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'transport', action: 'created' });
    res.status(201).json({ success: true, route });
  });

// @desc    Get all Transport Routes
const getRoutes = asyncHandler(async (req, res) => {
    const routes = await TransportRoute.find({ collegeId: req.user.collegeId });
    res.json({ success: true, routes });
  });

const deleteRoute = asyncHandler(async (req, res) => {
    const route = await TransportRoute.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
    if (!route) {
      return res.status(404).json({ success: false, message: 'Transport route not found' });
    }

    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'transport', action: 'deleted' });
    res.json({ success: true, message: 'Transport route deleted' });
  });

module.exports = { addHostel, addRoom, allocateRoom, getHostels, addRoute, getRoutes, deleteRoute };
