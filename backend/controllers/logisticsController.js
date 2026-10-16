const asyncHandler = require('../middleware/asyncHandler');
const { Hostel, Room } = require('../models/Hostel');
const TransportRoute = require('../models/Transport');
const User = require('../models/User');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

// Helper to generate unique digital bus pass number
function generateBusPassNumber(routeCode) {
  const code = (routeCode || 'BUS').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PASS-${code}-${dateStr}-${rand}`;
}

// ==========================================
// ── HOSTEL CONTROLLERS ───────────────────
// ==========================================

// @desc    Add a new Hostel Block
// @route   POST /api/logistics/hostels or POST /api/hostel
const addHostel = asyncHandler(async (req, res) => {
  const { name, type, totalRooms, warden, facilities, blockCode, messType, rules, curfewTime, address } = req.body;
  if (!name || !type) {
    return res.status(400).json({ success: false, message: 'Hostel name and type (boys/girls/coed) are required' });
  }

  const code = blockCode || name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4);

  const hostel = await Hostel.create({
    collegeId: req.user.collegeId,
    name,
    type,
    blockCode: code,
    totalRooms: Number(totalRooms) || 20,
    warden: warden || undefined,
    facilities: Array.isArray(facilities) ? facilities : (facilities ? String(facilities).split(',').map(s => s.trim()) : []),
    messType: messType || 'both',
    rules: Array.isArray(rules) ? rules : [],
    curfewTime: curfewTime || '09:30 PM',
    address,
    isActive: req.body.isActive !== false,
  });

  logAudit(req, 'create', 'hostel', { resourceId: hostel._id, description: `Added hostel: ${hostel.name}`, metadata: { name: hostel.name } });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'hostels', action: 'created' });
  res.status(201).json({ success: true, hostel, data: hostel });
});

// @desc    Get all Hostels & configured Rooms
// @route   GET /api/logistics/hostels or GET /api/hostel
const getHostels = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const [hostels, rooms] = await Promise.all([
    Hostel.find({ collegeId }).populate('warden', 'name email phone role'),
    Room.find({ collegeId })
      .populate('hostelId', 'name type blockCode curfewTime')
      .populate('occupants', 'name rollNo department semester email phone')
      .populate('maintenanceLogs.inspectedBy', 'name role'),
  ]);

  res.json({ success: true, hostels, rooms, count: hostels.length });
});

// @desc    Get Single Hostel by ID
// @route   GET /api/logistics/hostels/:id
const getHostelById = asyncHandler(async (req, res) => {
  const hostel = await Hostel.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('warden', 'name email phone');
  if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });

  const rooms = await Room.find({ hostelId: hostel._id, collegeId: req.user.collegeId })
    .populate('occupants', 'name rollNo department semester email phone');

  res.json({ success: true, hostel, rooms });
});

// @desc    Update Hostel
// @route   PUT /api/logistics/hostels/:id
const updateHostel = asyncHandler(async (req, res) => {
  const hostel = await Hostel.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true, runValidators: true }
  );
  if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'hostels', action: 'updated' });
  res.json({ success: true, hostel, data: hostel });
});

// @desc    Delete Hostel & Rooms
// @route   DELETE /api/logistics/hostels/:id
const deleteHostel = asyncHandler(async (req, res) => {
  const hostel = await Hostel.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!hostel) return res.status(404).json({ success: false, message: 'Hostel not found' });
  await Room.deleteMany({ hostelId: hostel._id });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'hostels', action: 'deleted' });
  res.json({ success: true, message: 'Hostel and associated rooms deleted' });
});

// ==========================================
// ── ROOM CONTROLLERS ──────────────────────
// ==========================================

// @desc    Add Room to Hostel
// @route   POST /api/logistics/hostels/rooms or POST /api/hostel/rooms
const addRoom = asyncHandler(async (req, res) => {
  const { hostelId, roomNumber, capacity, floor, roomType, feePerTerm, amenities } = req.body;
  if (!hostelId || !roomNumber || !capacity) {
    return res.status(400).json({ success: false, message: 'Hostel ID, room number, and capacity are required' });
  }

  const existingRoom = await Room.findOne({
    collegeId: req.user.collegeId,
    hostelId,
    roomNumber: String(roomNumber).trim(),
  });
  if (existingRoom) {
    return res.status(400).json({ success: false, message: `Room ${roomNumber} already exists in this hostel` });
  }

  const room = await Room.create({
    collegeId: req.user.collegeId,
    hostelId,
    roomNumber: String(roomNumber).trim(),
    floor: Number(floor) || 1,
    roomType: roomType || 'double',
    capacity: Number(capacity),
    feePerTerm: Number(feePerTerm) || 0,
    amenities: Array.isArray(amenities) ? amenities : (amenities ? String(amenities).split(',').map(s => s.trim()) : []),
    occupants: [],
    status: 'available',
  });

  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'hostels', action: 'room-created' });
  res.status(201).json({ success: true, room, data: room });
});

// @desc    Get all Rooms
// @route   GET /api/logistics/rooms
const getRooms = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  if (req.query.hostelId) query.hostelId = req.query.hostelId;
  if (req.query.status) query.status = req.query.status;
  if (req.query.floor) query.floor = Number(req.query.floor);

  const rooms = await Room.find(query)
    .populate('hostelId', 'name type blockCode')
    .populate('occupants', 'name rollNo department semester email phone');

  res.json({ success: true, rooms, count: rooms.length });
});

// @desc    Update Room
// @route   PUT /api/logistics/hostels/rooms/:id
const updateRoom = asyncHandler(async (req, res) => {
  const room = await Room.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true, runValidators: true }
  );
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
  res.json({ success: true, room, data: room });
});

// @desc    Delete Room
// @route   DELETE /api/logistics/hostels/rooms/:id
const deleteRoom = asyncHandler(async (req, res) => {
  const room = await Room.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  if (room.occupants && room.occupants.length > 0) {
    return res.status(400).json({ success: false, message: 'Cannot delete room with active occupants. Please deallocate occupants first.' });
  }

  await Room.deleteOne({ _id: room._id });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'hostels', action: 'room-deleted' });
  res.json({ success: true, message: 'Room deleted successfully' });
});

// @desc    Allocate Room to Student
// @route   POST /api/logistics/hostels/allocate
const allocateRoom = asyncHandler(async (req, res) => {
  const { studentId, rollNo, roll, roomNumber, roomId, hostelId } = req.body;

  const student = await User.findOne({
    collegeId: req.user.collegeId,
    role: 'student',
    $or: [
      ...(studentId ? [{ _id: studentId }] : []),
      ...(rollNo || roll ? [{ rollNo: rollNo || roll }] : []),
    ],
  }).select('_id name rollNo department semester email');

  if (!student) {
    return res.status(400).json({ success: false, message: 'Valid registered student is required for room allocation' });
  }

  let room;
  if (roomId) {
    room = await Room.findOne({ _id: roomId, collegeId: req.user.collegeId });
  } else if (roomNumber) {
    const roomQuery = { roomNumber: String(roomNumber).trim(), collegeId: req.user.collegeId };
    if (hostelId) roomQuery.hostelId = hostelId;
    room = await Room.findOne(roomQuery);
  }

  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  // Check if student is already in this room
  if (room.occupants.some(id => String(id) === String(student._id))) {
    return res.json({ success: true, message: 'Student is already allocated to this room', room });
  }

  // Check if room is at capacity
  if (room.occupants.length >= room.capacity) {
    return res.status(400).json({ success: false, message: `Room ${room.roomNumber} is at maximum capacity (${room.capacity} beds)` });
  }

  // Remove student from any other currently allocated room in the college
  await Room.updateMany(
    { collegeId: req.user.collegeId, occupants: student._id },
    { $pull: { occupants: student._id }, $set: { status: 'available' } }
  );

  room.occupants.push(student._id);
  if (room.occupants.length >= room.capacity) {
    room.status = 'occupied';
  }
  await room.save();

  logAudit(req, 'update', 'hostel_allocation', { resourceId: room._id, description: `Allocated ${student.name} to room ${room.roomNumber}`, metadata: { studentId: student._id, roomNumber: room.roomNumber } });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin', 'student'], resource: 'hostels', action: 'allocated' });

  const populatedRoom = await Room.findById(room._id)
    .populate('hostelId', 'name type')
    .populate('occupants', 'name rollNo department semester');

  res.json({ success: true, message: `Allocated ${student.name} to Room ${room.roomNumber}`, room: populatedRoom });
});

// @desc    Deallocate / Checkout Student from Room
// @route   POST /api/logistics/hostels/deallocate
const deallocateRoom = asyncHandler(async (req, res) => {
  const { roomId, studentId, roll, rollNo, hostelId, roomNumber } = req.body;
  let targetStudentId = studentId;

  if (!targetStudentId && (roll || rollNo)) {
    const student = await User.findOne({
      collegeId: req.user.collegeId,
      role: 'student',
      rollNo: rollNo || roll,
    }).select('_id name rollNo');
    if (student) targetStudentId = student._id;
  }

  let room;
  if (roomId) {
    room = await Room.findOne({ _id: roomId, collegeId: req.user.collegeId });
  } else if (roomNumber) {
    const roomQuery = { roomNumber, collegeId: req.user.collegeId };
    if (hostelId) roomQuery.hostelId = hostelId;
    room = await Room.findOne(roomQuery);
  } else if (targetStudentId) {
    room = await Room.findOne({ occupants: targetStudentId, collegeId: req.user.collegeId });
  }

  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
  if (!targetStudentId) return res.status(400).json({ success: false, message: 'Student identifier is required' });

  room.occupants = room.occupants.filter(id => String(id) !== String(targetStudentId));
  room.status = 'available';
  await room.save();

  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin', 'student'], resource: 'hostels', action: 'deallocated' });
  res.json({ success: true, message: 'Student deallocated from room', room });
});

// @desc    Transfer Student from one room to another
// @route   POST /api/logistics/hostels/transfer
const transferRoom = asyncHandler(async (req, res) => {
  const { studentId, rollNo, targetRoomId, targetRoomNumber, targetHostelId } = req.body;

  const student = await User.findOne({
    collegeId: req.user.collegeId,
    role: 'student',
    $or: [
      ...(studentId ? [{ _id: studentId }] : []),
      ...(rollNo ? [{ rollNo }] : []),
    ],
  }).select('_id name rollNo department');

  if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

  // Find target room
  let targetRoom;
  if (targetRoomId) {
    targetRoom = await Room.findOne({ _id: targetRoomId, collegeId: req.user.collegeId });
  } else if (targetRoomNumber) {
    const q = { roomNumber: String(targetRoomNumber).trim(), collegeId: req.user.collegeId };
    if (targetHostelId) q.hostelId = targetHostelId;
    targetRoom = await Room.findOne(q);
  }

  if (!targetRoom) return res.status(404).json({ success: false, message: 'Target room not found' });
  if (targetRoom.occupants.length >= targetRoom.capacity) {
    return res.status(400).json({ success: false, message: `Target room ${targetRoom.roomNumber} is full` });
  }

  // Find current room
  const currentRoom = await Room.findOne({ occupants: student._id, collegeId: req.user.collegeId });
  if (currentRoom) {
    if (String(currentRoom._id) === String(targetRoom._id)) {
      return res.status(400).json({ success: false, message: 'Student is already in this room' });
    }
    currentRoom.occupants = currentRoom.occupants.filter(id => String(id) !== String(student._id));
    currentRoom.status = 'available';
    await currentRoom.save();
  }

  targetRoom.occupants.push(student._id);
  if (targetRoom.occupants.length >= targetRoom.capacity) {
    targetRoom.status = 'occupied';
  }
  await targetRoom.save();

  logAudit(req, 'update', 'hostel_transfer', {
    resourceId: targetRoom._id,
    description: `Transferred ${student.name} from Room ${currentRoom?.roomNumber || 'None'} to ${targetRoom.roomNumber}`,
    metadata: { studentId: student._id, fromRoom: currentRoom?.roomNumber, toRoom: targetRoom.roomNumber },
  });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin', 'student'], resource: 'hostels', action: 'transferred' });

  res.json({
    success: true,
    message: `Successfully transferred ${student.name} to Room ${targetRoom.roomNumber}`,
    fromRoom: currentRoom?.roomNumber || null,
    toRoom: targetRoom.roomNumber,
    targetRoom,
  });
});

// @desc    Log Room Maintenance Issue or Inspection
// @route   POST /api/logistics/hostels/rooms/:id/maintenance
const addRoomMaintenance = asyncHandler(async (req, res) => {
  const room = await Room.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  const { issue, notes, status } = req.body;
  if (!issue || !issue.trim()) {
    return res.status(400).json({ success: false, message: 'Maintenance issue description is required' });
  }

  const logEntry = {
    date: new Date(),
    issue: issue.trim(),
    status: status || 'reported',
    notes: notes || '',
    inspectedBy: req.user._id,
  };

  room.maintenanceLogs.unshift(logEntry);
  if (status === 'reported' || status === 'in-progress') {
    room.status = 'maintenance';
  } else if (status === 'resolved') {
    room.status = room.occupants.length >= room.capacity ? 'occupied' : 'available';
  }
  await room.save();

  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'hostels', action: 'maintenance-logged' });
  res.json({ success: true, message: 'Maintenance record saved', room });
});

// @desc    Get Student's Own Hostel & Room Allocation
// @route   GET /api/logistics/my-hostel
const getMyHostel = asyncHandler(async (req, res) => {
  const room = await Room.findOne({ occupants: req.user._id, collegeId: req.user.collegeId })
    .populate({
      path: 'hostelId',
      select: 'name type blockCode warden facilities totalRooms rules curfewTime messType address',
      populate: { path: 'warden', select: 'name email phone' },
    })
    .populate('occupants', 'name rollNo department semester email phone')
    .populate('maintenanceLogs.inspectedBy', 'name role');

  if (!room) {
    const availableHostels = await Hostel.find({ collegeId: req.user.collegeId, isActive: true })
      .select('name type blockCode facilities totalRooms messType curfewTime')
      .populate('warden', 'name email phone');

    return res.json({ success: true, room: null, availableHostels });
  }

  const roomObj = room.toObject();
  roomObj.hostel = roomObj.hostelId;
  roomObj.hostelName = roomObj.hostelId?.name;
  roomObj.warden = roomObj.hostelId?.warden;
  roomObj.wardenName = roomObj.hostelId?.warden?.name || 'Campus Warden';
  roomObj.wardenEmail = roomObj.hostelId?.warden?.email || 'warden@vishvaerp.edu';
  roomObj.wardenPhone = roomObj.hostelId?.warden?.phone || '+91 98765 43210';

  res.json({ success: true, room: roomObj });
});

// ==========================================
// ── TRANSPORT CONTROLLERS ─────────────────
// ==========================================

// @desc    Add Transport Route
// @route   POST /api/logistics/transport or POST /api/transport
const addRoute = asyncHandler(async (req, res) => {
  const { routeName, routeNo, busNumber, vehicleModel, driverName, driverPhone, driverLicense, helperName, helperPhone, capacity, morningTime, eveningTime } = req.body;
  const name = routeName || routeNo;
  if (!name || !busNumber) {
    return res.status(400).json({ success: false, message: 'Route name/number and bus number are required' });
  }

  let formattedStops = [];
  if (Array.isArray(req.body.stops) && req.body.stops.length > 0) {
    formattedStops = req.body.stops.map(s => ({
      stopName: s.stopName || s.name || 'Campus Stop',
      pickupTime: s.pickupTime || '',
      dropTime: s.dropTime || '',
      feePerTerm: Number(s.feePerTerm) || 0,
      lat: s.lat || undefined,
      lng: s.lng || undefined,
    }));
  } else {
    const stopNames = String(req.body.via || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    formattedStops = stopNames.map((stopName, index) => ({
      stopName,
      pickupTime: index === 0 ? (morningTime || req.body.pickupTime || '07:30 AM') : '',
      dropTime: index === stopNames.length - 1 ? (eveningTime || req.body.dropTime || '05:00 PM') : '',
      feePerTerm: 0,
    }));
  }

  const route = await TransportRoute.create({
    collegeId: req.user.collegeId,
    routeName: name,
    routeCode: req.body.routeCode || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase(),
    busNumber: String(busNumber).trim(),
    vehicleModel: vehicleModel || 'College Bus Standard',
    driverName: driverName || '',
    driverPhone: driverPhone || '',
    driverLicense: driverLicense || '',
    helperName: helperName || '',
    helperPhone: helperPhone || '',
    stops: formattedStops,
    capacity: Number(capacity) || 40,
    enrolledStudents: req.body.enrolledStudents || [],
    passes: [],
    currentLocation: {
      lat: 12.9716,
      lng: 77.5946,
      speed: 0,
      heading: 0,
      lastUpdated: new Date(),
      currentStopIndex: 0,
      isLive: false,
    },
    isActive: req.body.isActive !== false,
  });

  logAudit(req, 'create', 'transport_route', { resourceId: route._id, description: `Added transport route: ${route.routeName}`, metadata: { routeName: route.routeName } });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'transport', action: 'created' });
  res.status(201).json({ success: true, route, data: route });
});

// @desc    Get all Transport Routes
// @route   GET /api/logistics/transport or GET /api/transport
const getRoutes = asyncHandler(async (req, res) => {
  const routes = await TransportRoute.find({ collegeId: req.user.collegeId })
    .populate('enrolledStudents', 'name rollNo department semester email phone')
    .populate('passes.studentId', 'name rollNo department email');

  res.json({ success: true, routes, count: routes.length });
});

// @desc    Get Single Transport Route by ID
// @route   GET /api/logistics/transport/:id
const getRouteById = asyncHandler(async (req, res) => {
  const route = await TransportRoute.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('enrolledStudents', 'name rollNo department semester email phone');
  if (!route) return res.status(404).json({ success: false, message: 'Transport route not found' });
  res.json({ success: true, route });
});

// @desc    Update Transport Route
// @route   PUT /api/logistics/transport/:id
const updateRoute = asyncHandler(async (req, res) => {
  const route = await TransportRoute.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true, runValidators: true }
  );
  if (!route) return res.status(404).json({ success: false, message: 'Transport route not found' });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'transport', action: 'updated' });
  res.json({ success: true, route, data: route });
});

// @desc    Delete Transport Route
// @route   DELETE /api/logistics/transport/:id
const deleteRoute = asyncHandler(async (req, res) => {
  const route = await TransportRoute.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!route) return res.status(404).json({ success: false, message: 'Transport route not found' });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin'], resource: 'transport', action: 'deleted' });
  res.json({ success: true, message: 'Transport route deleted' });
});

// @desc    Enroll Student on Transport Route & Generate Digital Pass
// @route   POST /api/logistics/transport/:id/enroll
const enrollStudent = asyncHandler(async (req, res) => {
  const route = await TransportRoute.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!route) return res.status(404).json({ success: false, message: 'Route not found' });

  // Enforce capacity
  if (route.enrolledStudents.length >= route.capacity) {
    return res.status(400).json({ success: false, message: `Route ${route.routeName} is at full capacity (${route.capacity} seats)` });
  }

  let student;
  if (req.user.role === 'student') {
    student = req.user;
  } else {
    const studentId = req.body.studentId;
    const rollNo = req.body.rollNo || req.body.roll;
    student = await User.findOne({
      collegeId: req.user.collegeId,
      role: 'student',
      $or: [
        ...(studentId ? [{ _id: studentId }] : []),
        ...(rollNo ? [{ rollNo }] : []),
      ],
    }).select('_id name rollNo department semester email');
  }
  if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

  // Check if student is already enrolled on this route
  const alreadyEnrolled = route.enrolledStudents.some(id => String(id) === String(student._id));
  if (alreadyEnrolled) {
    const existingPass = (route.passes || []).find(p => String(p.studentId) === String(student._id));
    return res.json({ success: true, message: 'Student already enrolled on this route', route, pass: existingPass });
  }

  // Unenroll student from any other route
  await TransportRoute.updateMany(
    { collegeId: req.user.collegeId, enrolledStudents: student._id },
    {
      $pull: { enrolledStudents: student._id },
      $set: { 'passes.$[elem].status': 'suspended' },
    },
    { arrayFilters: [{ 'elem.studentId': student._id }] }
  );

  route.enrolledStudents.push(student._id);

  // Generate Digital Transit Pass
  const passNumber = generateBusPassNumber(route.routeCode);
  const selectedStop = req.body.stopName || (route.stops?.[0]?.stopName) || 'Main Gate';
  const expiryDate = new Date(Date.now() + 180 * 24 * 3600 * 1000); // 6 months term

  const passObj = {
    studentId: student._id,
    passNumber,
    issueDate: new Date(),
    expiryDate,
    stopName: selectedStop,
    feePaid: true,
    qrCode: `VISHVA-BUS-PASS:${passNumber}:${student._id}:${route.busNumber}`,
    status: 'active',
  };

  route.passes.push(passObj);
  await route.save();

  logAudit(req, 'create', 'transport_enrollment', {
    resourceId: route._id,
    description: `Enrolled ${student.name} on ${route.routeName} with pass ${passNumber}`,
    metadata: { studentId: student._id, passNumber, routeName: route.routeName },
  });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin', 'student'], resource: 'transport', action: 'enrolled' });

  res.json({
    success: true,
    message: `${student.name || 'Student'} enrolled on ${route.routeName}`,
    route,
    pass: passObj,
  });
});

// @desc    Unenroll Student from Transport Route
// @route   POST /api/logistics/transport/:id/unenroll
const unenrollStudent = asyncHandler(async (req, res) => {
  const route = await TransportRoute.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!route) return res.status(404).json({ success: false, message: 'Route not found' });

  let studentId;
  if (req.user.role === 'student') {
    studentId = req.user._id;
  } else {
    studentId = req.body.studentId;
    if (!studentId && (req.body.roll || req.body.rollNo)) {
      const student = await User.findOne({
        collegeId: req.user.collegeId,
        role: 'student',
        rollNo: req.body.rollNo || req.body.roll,
      }).select('_id');
      if (student) studentId = student._id;
    }
  }
  if (!studentId) return res.status(400).json({ success: false, message: 'Student identifier required' });

  route.enrolledStudents = route.enrolledStudents.filter(id => String(id) !== String(studentId));
  // Mark pass as expired/suspended
  route.passes.forEach(p => {
    if (String(p.studentId) === String(studentId)) {
      p.status = 'expired';
    }
  });

  await route.save();
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin', 'superadmin', 'student'], resource: 'transport', action: 'unenrolled' });
  res.json({ success: true, message: 'Student unenrolled from transport route', route });
});

// @desc    Update Driver GPS Location
// @route   POST /api/logistics/transport/:id/gps
const updateGPSLocation = asyncHandler(async (req, res) => {
  const route = await TransportRoute.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!route) return res.status(404).json({ success: false, message: 'Route not found' });

  const { lat, lng, speed, heading, currentStopIndex } = req.body;
  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ success: false, message: 'Latitude and Longitude are required' });
  }

  route.currentLocation = {
    lat: Number(lat),
    lng: Number(lng),
    speed: Number(speed) || 0,
    heading: Number(heading) || 0,
    lastUpdated: new Date(),
    currentStopIndex: currentStopIndex !== undefined ? Number(currentStopIndex) : (route.currentLocation?.currentStopIndex || 0),
    isLive: true,
  };
  await route.save();

  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['student', 'collegeAdmin', 'superadmin'],
    resource: 'transport',
    action: 'gps-updated',
    data: { routeId: route._id, busNumber: route.busNumber, location: route.currentLocation },
  });

  res.json({ success: true, message: 'GPS coordinates recorded', location: route.currentLocation });
});

// @desc    Get Live GPS Telemetry for Route
// @route   GET /api/logistics/transport/:id/live-gps
const getLiveGPS = asyncHandler(async (req, res) => {
  const route = await TransportRoute.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .select('routeName busNumber driverName driverPhone currentLocation stops');
  if (!route) return res.status(404).json({ success: false, message: 'Route not found' });

  res.json({
    success: true,
    busNumber: route.busNumber,
    routeName: route.routeName,
    driver: { name: route.driverName, phone: route.driverPhone },
    location: route.currentLocation || { lat: 0, lng: 0, isLive: false },
    stops: route.stops,
  });
});

// @desc    Get Live Fleet Coordinates (All active buses)
// @route   GET /api/logistics/transport/live-fleet
const getLiveFleet = asyncHandler(async (req, res) => {
  const routes = await TransportRoute.find({ collegeId: req.user.collegeId, isActive: true })
    .select('routeName routeCode busNumber driverName driverPhone currentLocation capacity enrolledStudents');

  const fleet = routes.map(r => ({
    routeId: r._id,
    routeName: r.routeName,
    busNumber: r.busNumber,
    driverName: r.driverName,
    driverPhone: r.driverPhone,
    enrolledCount: (r.enrolledStudents || []).length,
    capacity: r.capacity,
    location: r.currentLocation,
  }));

  res.json({ success: true, fleet, count: fleet.length });
});

// @desc    Get Student's Own Transport & Digital Pass
// @route   GET /api/logistics/my-transport
const getMyTransport = asyncHandler(async (req, res) => {
  const route = await TransportRoute.findOne({ enrolledStudents: req.user._id, collegeId: req.user.collegeId })
    .populate('enrolledStudents', 'name rollNo department email');

  if (!route) {
    const availableRoutes = await TransportRoute.find({ collegeId: req.user.collegeId, isActive: true })
      .select('routeName busNumber driverName driverPhone capacity enrolledStudents stops');
    return res.json({ success: true, route: null, availableRoutes });
  }

  const routeObj = route.toObject();
  routeObj.enrolledCount = (routeObj.enrolledStudents || []).length;
  if (Array.isArray(routeObj.stops) && routeObj.stops.length > 0) {
    routeObj.pickupTime = routeObj.stops[0].pickupTime || '';
    routeObj.dropTime = routeObj.stops[routeObj.stops.length - 1].dropTime || '';
  }

  // Find active digital pass for student
  const myPass = (routeObj.passes || []).find(p => String(p.studentId) === String(req.user._id) && p.status === 'active');
  routeObj.myPass = myPass || null;

  res.json({ success: true, route: routeObj, pass: myPass || null });
});

// @desc    Get Student's Digital Pass Details
// @route   GET /api/logistics/transport/my-pass
const getMyPass = asyncHandler(async (req, res) => {
  const route = await TransportRoute.findOne({
    collegeId: req.user.collegeId,
    'passes.studentId': req.user._id,
    'passes.status': 'active',
  });

  if (!route) {
    return res.status(404).json({ success: false, message: 'No active transport pass found for your account' });
  }

  const pass = route.passes.find(p => String(p.studentId) === String(req.user._id) && p.status === 'active');
  res.json({
    success: true,
    pass,
    route: {
      routeName: route.routeName,
      busNumber: route.busNumber,
      driverName: route.driverName,
      driverPhone: route.driverPhone,
    },
  });
});

// ==========================================
// ── AGGREGATE & EXPORT CONTROLLERS ────────
// ==========================================

// @desc    Get aggregate logistics & hostel stats
// @route   GET /api/logistics/stats
const getLogisticsStats = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const [routes, hostels, rooms] = await Promise.all([
    TransportRoute.find({ collegeId }),
    Hostel.find({ collegeId }),
    Room.find({ collegeId }).populate('hostelId', 'name type'),
  ]);

  const totalRoutes = routes.length;
  const activeRoutes = routes.filter(r => r.isActive).length;
  const totalBusCapacity = routes.reduce((acc, r) => acc + (r.capacity || 0), 0);
  const totalCommuters = routes.reduce((acc, r) => acc + (r.enrolledStudents || []).length, 0);

  const totalHostels = hostels.length;
  const totalRooms = rooms.length;
  const totalBedCapacity = rooms.reduce((acc, rm) => acc + (rm.capacity || 0), 0);
  const totalHostelOccupants = rooms.reduce((acc, rm) => acc + (rm.occupants || []).length, 0);
  const vacantBeds = Math.max(0, totalBedCapacity - totalHostelOccupants);

  const occupancyRate = totalBedCapacity > 0 ? Math.round((totalHostelOccupants / totalBedCapacity) * 100) : 0;
  const transportOccupancyRate = totalBusCapacity > 0 ? Math.round((totalCommuters / totalBusCapacity) * 100) : 0;

  const roomsByStatus = {
    available: rooms.filter(r => r.status === 'available').length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    maintenance: rooms.filter(r => r.status === 'maintenance').length,
    reserved: rooms.filter(r => r.status === 'reserved').length,
  };

  const activePassesCount = routes.reduce((acc, r) => acc + (r.passes || []).filter(p => p.status === 'active').length, 0);

  res.json({
    success: true,
    stats: {
      totalRoutes,
      activeRoutes,
      totalBusCapacity,
      totalCommuters,
      transportOccupancyRate,
      activePassesCount,
      totalHostels,
      totalRooms,
      totalBedCapacity,
      totalHostelOccupants,
      vacantBeds,
      occupancyRate,
      roomsByStatus,
    },
  });
});

// @desc    Export logistics & hostel data as CSV
// @route   GET /api/logistics/export
const exportLogisticsReport = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const type = req.query.type || 'all';

  const [routes, rooms] = await Promise.all([
    TransportRoute.find({ collegeId }).populate('enrolledStudents', 'name rollNo email'),
    Room.find({ collegeId }).populate('hostelId', 'name type blockCode').populate('occupants', 'name rollNo email'),
  ]);

  let csv = '';

  if (type === 'transport' || type === 'all') {
    csv += '=== TRANSPORT ROUTES & COMMUTERS ===\n';
    csv += 'Route Name,Route Code,Bus Number,Driver Name,Driver Phone,Capacity,Enrolled,Stops,Student Names,Student Roll Numbers\n';
    routes.forEach(r => {
      const stopsStr = `"${(r.stops || []).map(s => s.stopName).join(' -> ')}"`;
      const namesStr = `"${(r.enrolledStudents || []).map(s => s.name).join('; ')}"`;
      const rollStr = `"${(r.enrolledStudents || []).map(s => s.rollNo).join('; ')}"`;
      csv += `"${r.routeName}","${r.routeCode || ''}","${r.busNumber}","${r.driverName || ''}","${r.driverPhone || ''}",${r.capacity},${(r.enrolledStudents || []).length},${stopsStr},${namesStr},${rollStr}\n`;
    });
    csv += '\n';
  }

  if (type === 'hostel' || type === 'all') {
    csv += '=== HOSTEL ROOMS & ALLOCATIONS ===\n';
    csv += 'Hostel Block,Block Code,Type,Room Number,Floor,Room Type,Capacity,Occupants Count,Status,Fee Per Term,Student Names,Student Roll Numbers\n';
    rooms.forEach(rm => {
      const hName = rm.hostelId?.name || '';
      const hCode = rm.hostelId?.blockCode || '';
      const hType = rm.hostelId?.type || '';
      const namesStr = `"${(rm.occupants || []).map(o => o.name).join('; ')}"`;
      const rollStr = `"${(rm.occupants || []).map(o => o.rollNo).join('; ')}"`;
      csv += `"${hName}","${hCode}","${hType}","${rm.roomNumber}",${rm.floor || 1},"${rm.roomType || 'double'}",${rm.capacity},${(rm.occupants || []).length},"${rm.status || 'available'}",${rm.feePerTerm || 0},${namesStr},${rollStr}\n`;
    });
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="logistics-report-${Date.now()}.csv"`);
  res.status(200).send(csv);
});

module.exports = {
  // Hostel
  addHostel, getHostels, getHostelById, updateHostel, deleteHostel,
  // Room
  addRoom, getRooms, updateRoom, deleteRoom, allocateRoom, deallocateRoom, transferRoom, addRoomMaintenance, getMyHostel,
  // Transport
  addRoute, getRoutes, getRouteById, updateRoute, deleteRoute,
  enrollStudent, unenrollStudent, updateGPSLocation, getLiveGPS, getLiveFleet, getMyTransport, getMyPass,
  // Stats & Export
  getLogisticsStats, exportLogisticsReport,
};
