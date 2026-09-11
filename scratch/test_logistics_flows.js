const http = require('http');
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });

const app = require('../backend/server');
const User = require('../backend/models/User');
const College = require('../backend/models/College');
const Subscription = require('../backend/models/Subscription');
const { Hostel, Room } = require('../backend/models/Hostel');
const TransportRoute = require('../backend/models/Transport');
const Grievance = require('../backend/models/Grievance');

let server;
let baseUrl;

async function apiCall(endpoint, { method = 'GET', body, token } = {}) {
  const url = `${baseUrl}${endpoint}`;
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, headers: res.headers, data };
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🚀 SUITE 15: CAMPUS LOGISTICS & FACILITIES E2E VERIFICATION');
  console.log('================================================================\n');

  // Connect to DB if not connected
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/vishva_erp');
  }

  // Start HTTP test server on dynamic port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[INIT] In-process test server running at ${baseUrl}\n`);

  let testCollege, adminUser, wardenUser, student1, student2;
  let adminToken, wardenToken, student1Token, student2Token;
  let boysHostel, girlsHostel, roomA101, roomA102;
  let route7, busPass1;
  let grievance1, grievance2;

  let totalAssertions = 0;
  function assert(condition, message) {
    totalAssertions++;
    if (!condition) {
      throw new Error(`Assertion Failed: ${message}`);
    }
    console.log(`  ✓ ${message}`);
  }

  try {
    // -------------------------------------------------------------
    // PHASE 1: Environment, Users & Authentication Setup
    // -------------------------------------------------------------
    console.log('--- Phase 1: Environment, Subscriptions & Auth Tokens ---');
    testCollege = await College.findOne({ code: 'LOG-COLL-01' });
    if (!testCollege) {
      testCollege = await College.create({
        name: 'Logistics Tech University',
        code: 'LOG-COLL-01',
        status: 'active',
        planExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      });
    } else {
      testCollege.status = 'active';
      testCollege.planExpiry = new Date(Date.now() + 365 * 24 * 3600 * 1000);
      await testCollege.save();
    }

    // Ensure active subscription for college
    await Subscription.findOneAndUpdate(
      { collegeId: testCollege._id },
      {
        plan: 'enterprise',
        status: 'active',
        startDate: new Date(Date.now() - 30 * 24 * 3600 * 1000),
        endDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
      { upsert: true, new: true }
    );

    // Create / find Admin
    adminUser = await User.findOne({ email: 'admin.logistics@vishva.edu' });
    if (!adminUser) {
      adminUser = await User.create({
        name: 'Dr. Vikram Sarabhai',
        email: 'admin.logistics@vishva.edu',
        password: 'Password123!',
        role: 'collegeAdmin',
        collegeId: testCollege._id,
        isActive: true,
      });
    }

    // Create / find Warden
    wardenUser = await User.findOne({ email: 'warden.kumar@vishva.edu' });
    if (!wardenUser) {
      wardenUser = await User.create({
        name: 'Chief Warden Kumar',
        email: 'warden.kumar@vishva.edu',
        password: 'Password123!',
        role: 'faculty',
        collegeId: testCollege._id,
        phone: '+91 98877 66554',
        isActive: true,
      });
    }

    // Create / find Student 1
    student1 = await User.findOne({ email: 'student1.logistics@vishva.edu' });
    if (!student1) {
      student1 = await User.create({
        name: 'Rohan Deshmukh',
        email: 'student1.logistics@vishva.edu',
        password: 'Password123!',
        role: 'student',
        collegeId: testCollege._id,
        rollNo: '2026-CSE-045',
        department: 'Computer Science',
        semester: '4',
        isActive: true,
      });
    }

    // Create / find Student 2
    student2 = await User.findOne({ email: 'student2.logistics@vishva.edu' });
    if (!student2) {
      student2 = await User.create({
        name: 'Ananya Roy',
        email: 'student2.logistics@vishva.edu',
        password: 'Password123!',
        role: 'student',
        collegeId: testCollege._id,
        rollNo: '2026-ECE-012',
        department: 'Electronics',
        semester: '4',
        isActive: true,
      });
    }

    // Create / find Student 3
    let student3 = await User.findOne({ email: 'student3.logistics@vishva.edu' });
    if (!student3) {
      student3 = await User.create({
        name: 'Kabir Verma',
        email: 'student3.logistics@vishva.edu',
        password: 'Password123!',
        role: 'student',
        collegeId: testCollege._id,
        rollNo: '2026-MECH-099',
        department: 'Mechanical',
        semester: '4',
        isActive: true,
      });
    }

    // Login users to obtain real JWTs
    const loginAdmin = await apiCall('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin.logistics@vishva.edu', password: 'Password123!' },
    });
    assert(loginAdmin.status === 200 && loginAdmin.data.token, 'Admin logged in successfully');
    adminToken = loginAdmin.data.token;

    const loginWarden = await apiCall('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'warden.kumar@vishva.edu', password: 'Password123!' },
    });
    assert(loginWarden.status === 200 && loginWarden.data.token, 'Warden logged in successfully');
    wardenToken = loginWarden.data.token;

    const loginStudent1 = await apiCall('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'student1.logistics@vishva.edu', password: 'Password123!' },
    });
    assert(loginStudent1.status === 200 && loginStudent1.data.token, 'Student 1 logged in successfully');
    student1Token = loginStudent1.data.token;

    const loginStudent2 = await apiCall('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'student2.logistics@vishva.edu', password: 'Password123!' },
    });
    assert(loginStudent2.status === 200 && loginStudent2.data.token, 'Student 2 logged in successfully');
    student2Token = loginStudent2.data.token;

    // -------------------------------------------------------------
    // PHASE 2: Hostel & Room Provisioning
    // -------------------------------------------------------------
    console.log('\n--- Phase 2: Hostel Blocks & Room Provisioning ---');
    // Create Boys Hostel Block via /api/v1/hostel
    const createHostel1 = await apiCall('/api/v1/hostel', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Aryabhata Residence Block',
        type: 'boys',
        blockCode: 'ARB-1',
        totalRooms: 30,
        warden: wardenUser._id,
        facilities: ['High-Speed WiFi', 'Gymnasium', 'Solar Geyser', 'Study Lounge'],
        messType: 'both',
        curfewTime: '10:00 PM',
      },
    });
    assert(createHostel1.status === 201, 'POST /api/v1/hostel created Aryabhata block');
    boysHostel = createHostel1.data.hostel;
    assert(boysHostel.blockCode === 'ARB-1', 'Hostel block code verified');

    // Create Girls Hostel Block via legacy alias /api/hostel
    const createHostel2 = await apiCall('/api/hostel', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Gargi Residence Block',
        type: 'girls',
        blockCode: 'GRG-2',
        totalRooms: 25,
        facilities: ['WiFi', 'Badminton Court', 'Laundry', 'Cafeteria'],
        messType: 'veg',
      },
    });
    assert(createHostel2.status === 201, 'POST /api/hostel created Gargi block');
    girlsHostel = createHostel2.data.hostel;

    // Create Room A-101 (Double Seater, capacity 2) via /api/logistics/hostels/rooms
    const createRoom1 = await apiCall('/api/logistics/hostels/rooms', {
      method: 'POST',
      token: adminToken,
      body: {
        hostelId: boysHostel._id,
        roomNumber: 'A-101',
        capacity: 2,
        floor: 1,
        roomType: 'double',
        feePerTerm: 32000,
        amenities: ['Study Desk', 'Attached Bath', 'Balcony'],
      },
    });
    assert(createRoom1.status === 201, 'POST /api/logistics/hostels/rooms created Room A-101');
    roomA101 = createRoom1.data.room;
    assert(roomA101.capacity === 2 && roomA101.status === 'available', 'Room A-101 capacity 2, available');

    // Create Room A-102 (Single Seater, capacity 1) via /api/hostel/rooms
    const createRoom2 = await apiCall('/api/hostel/rooms', {
      method: 'POST',
      token: adminToken,
      body: {
        hostelId: boysHostel._id,
        roomNumber: 'A-102',
        capacity: 1,
        floor: 1,
        roomType: 'single',
        feePerTerm: 48000,
        amenities: ['AC', 'Study Desk', 'Attached Bath'],
      },
    });
    assert(createRoom2.status === 201, 'POST /api/hostel/rooms created Room A-102');
    roomA102 = createRoom2.data.room;

    // Get hostels and rooms list
    const getHostelsRes = await apiCall('/api/hostel', { token: adminToken });
    assert(getHostelsRes.status === 200, 'GET /api/hostel returned all hostel blocks');
    assert(getHostelsRes.data.hostels.length >= 2, 'At least 2 hostels retrieved');
    assert(getHostelsRes.data.rooms.length >= 2, 'At least 2 rooms retrieved');

    // -------------------------------------------------------------
    // PHASE 3: Student Room Allocation & Capacity Limit Safeguard
    // -------------------------------------------------------------
    console.log('\n--- Phase 3: Room Allocation & Capacity Enforcement ---');
    // Allocate Student 1 to Room A-101
    const allocRes1 = await apiCall('/api/logistics/hostels/allocate', {
      method: 'POST',
      token: adminToken,
      body: {
        studentId: student1._id,
        roomNumber: 'A-101',
        hostelId: boysHostel._id,
      },
    });
    assert(allocRes1.status === 200, 'Allocated Student 1 to Room A-101');
    assert(allocRes1.data.room.occupants.length === 1, 'Room A-101 has 1 occupant');

    // Allocate Student 2 to Room A-101 (fills capacity to 2)
    const allocRes2 = await apiCall('/api/hostel/allocate', {
      method: 'POST',
      token: adminToken,
      body: {
        rollNo: student2.rollNo,
        roomNumber: 'A-101',
        hostelId: boysHostel._id,
      },
    });
    assert(allocRes2.status === 200, 'Allocated Student 2 by roll number to Room A-101');
    assert(allocRes2.data.room.occupants.length === 2, 'Room A-101 now has 2 occupants');

    // Attempt to allocate another student into full room A-101
    const overbookRes = await apiCall('/api/hostel/allocate', {
      method: 'POST',
      token: adminToken,
      body: {
        studentId: wardenUser._id, // non-student or 3rd person
        rollNo: '2026-DUMMY',
        roomNumber: 'A-101',
        hostelId: boysHostel._id,
      },
    });
    assert(overbookRes.status === 400, 'Overbooking Room A-101 rejected with 400');

    // -------------------------------------------------------------
    // PHASE 4: Room Transfer Flow (Atomic Student Transfer)
    // -------------------------------------------------------------
    console.log('\n--- Phase 4: Room Transfer Flow ---');
    // Transfer Student 2 from Room A-101 to Room A-102
    const transferRes = await apiCall('/api/hostel/transfer', {
      method: 'POST',
      token: adminToken,
      body: {
        studentId: student2._id,
        targetRoomNumber: 'A-102',
        targetHostelId: boysHostel._id,
      },
    });
    assert(transferRes.status === 200, 'POST /api/hostel/transfer succeeded');
    assert(transferRes.data.fromRoom === 'A-101', 'Source room was A-101');
    assert(transferRes.data.toRoom === 'A-102', 'Target room is A-102');

    // Verify room states after transfer
    const checkRoomA101 = await Room.findById(roomA101._id);
    assert(checkRoomA101.occupants.length === 1, 'Room A-101 occupant count decreased to 1');
    assert(checkRoomA101.status === 'available', 'Room A-101 status back to available');

    const checkRoomA102 = await Room.findById(roomA102._id);
    assert(checkRoomA102.occupants.length === 1, 'Room A-102 now has 1 occupant');
    assert(checkRoomA102.status === 'occupied', 'Room A-102 status set to occupied');

    // -------------------------------------------------------------
    // PHASE 5: Student Self-Service: /my-hostel
    // -------------------------------------------------------------
    console.log('\n--- Phase 5: Student Self-Service /my-hostel ---');
    const myHostelStudent1 = await apiCall('/api/logistics/my-hostel', { token: student1Token });
    assert(myHostelStudent1.status === 200, 'GET /api/logistics/my-hostel returned 200');
    assert(myHostelStudent1.data.room.roomNumber === 'A-101', 'Student 1 sees Room A-101');
    assert(myHostelStudent1.data.room.hostelName === 'Aryabhata Residence Block', 'Hostel name populated');
    assert(myHostelStudent1.data.room.wardenName === 'Chief Warden Kumar', 'Warden name populated');

    const myHostelStudent2 = await apiCall('/api/hostel/my-hostel', { token: student2Token });
    assert(myHostelStudent2.status === 200, 'GET /api/hostel/my-hostel returned 200');
    assert(myHostelStudent2.data.room.roomNumber === 'A-102', 'Student 2 sees transferred Room A-102');

    // -------------------------------------------------------------
    // PHASE 6: Room Maintenance Request & Inspection Notes
    // -------------------------------------------------------------
    console.log('\n--- Phase 6: Room Maintenance Requests ---');
    const maintenanceRes = await apiCall(`/api/hostel/rooms/${roomA101._id}/maintenance`, {
      method: 'POST',
      token: student1Token,
      body: {
        issue: 'Study desk lamp socket sparking',
        notes: 'Needs immediate electrician attention',
        status: 'reported',
      },
    });
    assert(maintenanceRes.status === 200, 'POST room maintenance log succeeded');
    assert(maintenanceRes.data.room.maintenanceLogs.length >= 1, 'Maintenance entry logged');
    assert(maintenanceRes.data.room.status === 'maintenance', 'Room status updated to maintenance');

    // Resolve maintenance
    const resolveMaint = await apiCall(`/api/hostel/rooms/${roomA101._id}/maintenance`, {
      method: 'POST',
      token: adminToken,
      body: {
        issue: 'Study desk lamp socket replaced',
        notes: 'Electrician installed safe 16A modular socket',
        status: 'resolved',
      },
    });
    assert(resolveMaint.status === 200, 'Maintenance resolved successfully');
    assert(resolveMaint.data.room.status === 'available', 'Room status restored to available');

    // -------------------------------------------------------------
    // PHASE 7: Room Deallocation / Checkout Flow
    // -------------------------------------------------------------
    console.log('\n--- Phase 7: Student Room Deallocation / Checkout ---');
    const deallocRes = await apiCall('/api/hostel/deallocate', {
      method: 'POST',
      token: adminToken,
      body: {
        studentId: student2._id,
        roomId: roomA102._id,
      },
    });
    assert(deallocRes.status === 200, 'POST /api/hostel/deallocate checked out Student 2');
    const verifyRoom102 = await Room.findById(roomA102._id);
    assert(verifyRoom102.occupants.length === 0, 'Room A-102 is now empty');
    assert(verifyRoom102.status === 'available', 'Room A-102 status is available');

    // -------------------------------------------------------------
    // PHASE 8: Transport Route Creation & Multi-Stop Setup
    // -------------------------------------------------------------
    console.log('\n--- Phase 8: Transport Route Creation & Configuration ---');
    const createRouteRes = await apiCall('/api/v1/transport', {
      method: 'POST',
      token: adminToken,
      body: {
        routeName: 'Route 7 - North Corridor Express',
        routeCode: 'R07-NC',
        busNumber: 'KA-04-TR-8822',
        vehicleModel: 'Tata Starbus Ultra 40-Seater AC',
        driverName: 'Ramesh Gowda',
        driverPhone: '+91 94488 23456',
        driverLicense: 'KA0420190004523',
        capacity: 2, // set small capacity to test overflow safeguards
        stops: [
          { stopName: 'Hebbal Flyover', pickupTime: '07:15 AM', dropTime: '05:45 PM', feePerTerm: 12000, lat: 13.0358, lng: 77.597 },
          { stopName: 'Yelahanka Satellite Town', pickupTime: '07:35 AM', dropTime: '05:25 PM', feePerTerm: 10000, lat: 13.1007, lng: 77.5963 },
          { stopName: 'Campus Main Gate', pickupTime: '08:15 AM', dropTime: '04:45 PM', feePerTerm: 0, lat: 13.1345, lng: 77.5689 },
        ],
      },
    });
    assert(createRouteRes.status === 201, 'POST /api/v1/transport created Route 7');
    route7 = createRouteRes.data.route;
    assert(route7.stops.length === 3, 'Route has 3 designated stops');

    // -------------------------------------------------------------
    // PHASE 9: Student Bus Enrollment & Digital Transit Pass
    // -------------------------------------------------------------
    console.log('\n--- Phase 9: Student Enrollment & Digital Transit Pass ---');
    const enrollRes1 = await apiCall(`/api/transport/${route7._id}/enroll`, {
      method: 'POST',
      token: student1Token,
      body: {
        stopName: 'Hebbal Flyover',
      },
    });
    assert(enrollRes1.status === 200, 'Student 1 enrolled on Route 7');
    assert(enrollRes1.data.pass, 'Digital pass object returned in response');
    busPass1 = enrollRes1.data.pass;
    assert(busPass1.passNumber.startsWith('PASS-'), 'Pass number format validated: ' + busPass1.passNumber);
    assert(busPass1.stopName === 'Hebbal Flyover', 'Pass pickup stop verified');

    // Student checks their digital pass
    const getPassRes = await apiCall('/api/transport/my-pass', { token: student1Token });
    assert(getPassRes.status === 200, 'GET /api/transport/my-pass retrieved active boarding pass');
    assert(getPassRes.data.pass.passNumber === busPass1.passNumber, 'Pass number matches');
    assert(getPassRes.data.route.busNumber === 'KA-04-TR-8822', 'Pass bus number matches');

    // -------------------------------------------------------------
    // PHASE 10: Student Self-Service: /my-transport
    // -------------------------------------------------------------
    console.log('\n--- Phase 10: Student /my-transport Endpoint ---');
    const myTransportRes = await apiCall('/api/logistics/my-transport', { token: student1Token });
    assert(myTransportRes.status === 200, 'GET /api/logistics/my-transport returned 200');
    assert(myTransportRes.data.route.routeName === 'Route 7 - North Corridor Express', 'Route name verified');
    assert(myTransportRes.data.route.driverName === 'Ramesh Gowda', 'Driver name verified');
    assert(myTransportRes.data.route.pickupTime === '07:15 AM', 'Pickup timing verified');

    // -------------------------------------------------------------
    // PHASE 11: Real-Time GPS Telemetry Updates & Fleet Polling
    // -------------------------------------------------------------
    console.log('\n--- Phase 11: Real-Time GPS Telemetry & Fleet Polling ---');
    // Driver / Admin pushes GPS coordinates
    const gpsPushRes = await apiCall(`/api/transport/${route7._id}/gps`, {
      method: 'POST',
      token: adminToken,
      body: {
        lat: 13.045,
        lng: 77.598,
        speed: 42.5,
        heading: 180,
        currentStopIndex: 1,
      },
    });
    assert(gpsPushRes.status === 200, 'POST /api/transport/:id/gps pushed telemetry');
    assert(gpsPushRes.data.location.isLive === true, 'Telemetry marked live');
    assert(gpsPushRes.data.location.speed === 42.5, 'Bus speed recorded at 42.5 km/h');

    // Student polls live GPS
    const liveGPSRes = await apiCall(`/api/transport/${route7._id}/live-gps`, { token: student1Token });
    assert(liveGPSRes.status === 200, 'GET /api/transport/:id/live-gps returned coordinates');
    assert(liveGPSRes.data.location.lat === 13.045, 'Latitude matches telemetry push');

    // Admin polls live fleet
    const fleetRes = await apiCall('/api/transport/live-fleet', { token: adminToken });
    assert(fleetRes.status === 200, 'GET /api/transport/live-fleet returned fleet list');
    assert(fleetRes.data.fleet.length >= 1, 'Fleet includes active bus');

    // -------------------------------------------------------------
    // PHASE 12: Transport Capacity Safeguards & Unenrollment
    // -------------------------------------------------------------
    console.log('\n--- Phase 12: Transport Capacity Safeguards & Unenrollment ---');
    // Student 2 enrolls (reaches capacity limit of 2)
    const enrollRes2 = await apiCall(`/api/transport/${route7._id}/enroll`, {
      method: 'POST',
      token: student2Token,
      body: { stopName: 'Yelahanka Satellite Town' },
    });
    assert(enrollRes2.status === 200, 'Student 2 enrolled on Route 7');

    // Admin attempts to enroll a 3rd user -> should fail (capacity 2)
    const overflowEnroll = await apiCall(`/api/transport/${route7._id}/enroll`, {
      method: 'POST',
      token: adminToken,
      body: { studentId: student3._id },
    });
    assert(overflowEnroll.status === 400, 'Overflow enrollment rejected with 400');

    // Student 2 unenrolls
    const unenrollRes = await apiCall(`/api/transport/${route7._id}/unenroll`, {
      method: 'POST',
      token: student2Token,
    });
    assert(unenrollRes.status === 200, 'Student 2 unenrolled from Route 7');

    const updatedRoute = await TransportRoute.findById(route7._id);
    assert(updatedRoute.enrolledStudents.length === 1, 'Route 7 enrolled count back to 1');

    // -------------------------------------------------------------
    // PHASE 13: Campus Grievance / Complaint Lifecycle
    // -------------------------------------------------------------
    console.log('\n--- Phase 13: Campus Grievance / Complaint Lifecycle ---');
    // Student raises hostel complaint
    const createGrvRes = await apiCall('/api/complaints', {
      method: 'POST',
      token: student1Token,
      body: {
        category: 'hostel',
        priority: 'high',
        subject: 'Air Conditioner Cooling Fault in Room A-101',
        description: 'The split AC unit in Room A-101 is blowing warm air and making a vibrating noise.',
      },
    });
    assert(createGrvRes.status === 201, 'POST /api/complaints filed complaint');
    grievance1 = createGrvRes.data.grievance;
    assert(grievance1.trackingId.startsWith('GRV-'), 'Tracking ID generated: ' + grievance1.trackingId);
    assert(grievance1.escalationTier === 1, 'Initial escalation tier is 1');

    // Admin responds to complaint
    const respondRes1 = await apiCall(`/api/complaints/${grievance1._id}/respond`, {
      method: 'POST',
      token: adminToken,
      body: {
        message: 'HVAC technician assigned. Inspection scheduled for 03:00 PM today.',
      },
    });
    assert(respondRes1.status === 200, 'Admin posted response to complaint thread');
    assert(respondRes1.data.grievance.status === 'in-progress', 'Status transitioned to in-progress');

    // Student replies
    const replyRes1 = await apiCall(`/api/complaints/${grievance1._id}/respond`, {
      method: 'POST',
      token: student1Token,
      body: {
        message: 'Thank you, I will be present in the room.',
      },
    });
    assert(replyRes1.status === 200, 'Student replied to thread');
    assert(replyRes1.data.grievance.responses.length === 2, '2 responses in thread');

    // Admin resolves ticket
    const resolveGrv = await apiCall(`/api/complaints/${grievance1._id}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        status: 'resolved',
        resolution: 'Capacitor replaced and air filter cleaned. AC functioning normally at 22°C.',
      },
    });
    assert(resolveGrv.status === 200, 'Admin resolved complaint');
    assert(resolveGrv.data.grievance.status === 'resolved', 'Complaint status is resolved');

    // Student provides satisfaction feedback and closes ticket
    const feedbackRes = await apiCall(`/api/complaints/${grievance1._id}/feedback`, {
      method: 'POST',
      token: student1Token,
      body: {
        feedback: 'satisfied',
        feedbackComment: 'Technician arrived promptly and solved the issue.',
        satisfactionRating: 5,
      },
    });
    assert(feedbackRes.status === 200, 'Student submitted 5-star satisfaction feedback');
    assert(feedbackRes.data.grievance.status === 'closed', 'Ticket automatically closed upon feedback');

    // -------------------------------------------------------------
    // PHASE 14: Complaint Multi-Tier Escalation Flow
    // -------------------------------------------------------------
    console.log('\n--- Phase 14: Complaint Multi-Tier Escalation Flow ---');
    // Student raises transport complaint
    const createGrv2 = await apiCall('/api/complaints', {
      method: 'POST',
      token: student1Token,
      body: {
        category: 'transport',
        priority: 'urgent',
        subject: 'Morning Bus Route 7 delayed by 40 minutes without notification',
        description: 'Morning bus arrived at Hebbal at 07:55 AM instead of 07:15 AM causing missed lab exam.',
      },
    });
    assert(createGrv2.status === 201, 'Student filed urgent transport complaint');
    grievance2 = createGrv2.data.grievance;

    // Escalate to Tier 2 (Campus Operations Directorate)
    const escalateRes = await apiCall(`/api/complaints/${grievance2._id}/escalate`, {
      method: 'POST',
      token: student1Token,
      body: {
        tier: 2,
        reason: 'Missed academic lab examination due to unannounced delay',
      },
    });
    assert(escalateRes.status === 200, 'Complaint escalated to Tier 2');
    assert(escalateRes.data.escalationTier === 2, 'Grievance escalationTier is 2');
    assert(escalateRes.data.grievance.status === 'under-review', 'Status updated to under-review');

    // -------------------------------------------------------------
    // PHASE 15: Logistics Aggregate Statistics & CSV Export
    // -------------------------------------------------------------
    console.log('\n--- Phase 15: Logistics Aggregate Statistics & CSV Export ---');
    const statsRes = await apiCall('/api/logistics/stats', { token: adminToken });
    assert(statsRes.status === 200, 'GET /api/logistics/stats returned 200');
    const stats = statsRes.data.stats;
    assert(stats.totalRoutes >= 1, 'Stats includes totalRoutes: ' + stats.totalRoutes);
    assert(stats.totalHostels >= 2, 'Stats includes totalHostels: ' + stats.totalHostels);
    assert(stats.totalRooms >= 2, 'Stats includes totalRooms: ' + stats.totalRooms);
    assert(stats.totalBedCapacity >= 3, 'Stats includes totalBedCapacity: ' + stats.totalBedCapacity);
    assert(stats.totalCommuters >= 1, 'Stats includes totalCommuters: ' + stats.totalCommuters);
    assert(stats.roomsByStatus !== undefined, 'Stats includes roomsByStatus');

    // Export CSV report
    const exportRes = await apiCall('/api/logistics/export?type=all', { token: adminToken });
    assert(exportRes.status === 200, 'GET /api/logistics/export returned 200');
    assert(exportRes.headers.get('content-type').includes('text/csv'), 'Content-Type is text/csv');
    assert(exportRes.data.includes('TRANSPORT ROUTES & COMMUTERS'), 'CSV contains transport section');
    assert(exportRes.data.includes('HOSTEL ROOMS & ALLOCATIONS'), 'CSV contains hostel section');
    assert(exportRes.data.includes('Route 7 - North Corridor Express'), 'CSV contains Route 7');
    assert(exportRes.data.includes('Aryabhata Residence Block'), 'CSV contains Aryabhata block');

    // -------------------------------------------------------------
    // PHASE 16: Route Mount Parity Verification
    // -------------------------------------------------------------
    console.log('\n--- Phase 16: Route Mount Parity Verification ---');
    const testEndpoints = [
      { url: '/api/v1/transport', expectedStatus: 200, desc: 'GET /api/v1/transport' },
      { url: '/api/transport', expectedStatus: 200, desc: 'GET /api/transport' },
      { url: '/api/v1/hostel', expectedStatus: 200, desc: 'GET /api/v1/hostel' },
      { url: '/api/hostel', expectedStatus: 200, desc: 'GET /api/hostel' },
      { url: '/api/v1/complaints', expectedStatus: 200, desc: 'GET /api/v1/complaints' },
      { url: '/api/complaints', expectedStatus: 200, desc: 'GET /api/complaints' },
      { url: '/api/v1/logistics/stats', expectedStatus: 200, desc: 'GET /api/v1/logistics/stats' },
      { url: '/api/logistics/stats', expectedStatus: 200, desc: 'GET /api/logistics/stats' },
    ];

    for (const ep of testEndpoints) {
      const r = await apiCall(ep.url, { token: adminToken });
      assert(r.status === ep.expectedStatus, `${ep.desc} parity verified (status ${r.status})`);
    }

    console.log('\n================================================================');
    console.log(`🎉 ALL ${totalAssertions} ASSERTIONS PASSED WITH 100% SUCCESS!`);
    console.log('================================================================\n');

  } finally {
    // -------------------------------------------------------------
    // PHASE 17: Teardown & Hygiene
    // -------------------------------------------------------------
    console.log('--- Phase 17: Teardown & Hygiene ---');
    if (testCollege) {
      await Room.deleteMany({ collegeId: testCollege._id });
      await Hostel.deleteMany({ collegeId: testCollege._id });
      await TransportRoute.deleteMany({ collegeId: testCollege._id });
      await Grievance.deleteMany({ collegeId: testCollege._id });
      await User.deleteMany({ collegeId: testCollege._id });
      await Subscription.deleteMany({ collegeId: testCollege._id });
      await College.deleteOne({ _id: testCollege._id });
      console.log('Cleaned up test rooms, hostels, routes, grievances, subscriptions, and college.');
    }

    if (server) {
      server.close();
    }
  }
}

runAllTests().catch((err) => {
  console.error('\n❌ Test Suite Failed with Error:\n', err);
  if (server) server.close();
  process.exit(1);
});
