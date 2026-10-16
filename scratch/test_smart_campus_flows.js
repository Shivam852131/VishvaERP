require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');

const User = require('../backend/models/User');
const College = require('../backend/models/College');
const Visitor = require('../backend/models/Visitor');
const Event = require('../backend/models/Event');
const { EnergyLog, SustainabilityGoal } = require('../backend/models/EnergyLog');
const Feedback = require('../backend/models/Feedback');
const Grievance = require('../backend/models/Grievance');
const { generateToken } = require('../backend/config/jwt');

process.env.VERCEL = 'true'; // prevent auto listen in server.js
const app = require('../backend/server');

let BASE_URL = '';
let server = null;

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   SUITE 12: SMART CAMPUS, SUSTAINABILITY & VISITORS SUITE  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/vishva_erp');
  console.log(' Connected to MongoDB');

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  BASE_URL = `http://127.0.0.1:${port}/api`;
  console.log(` Test server listening at ${BASE_URL}\n`);

  let college = await College.findOne({ isActive: true });
  if (!college) {
    college = await College.create({
      name: 'Smart Campus Tech University',
      code: 'SCTU-01',
      address: 'Innovation Park, Bangalore',
      email: 'admin@sctu.edu',
      phone: '9876543210',
      isActive: true,
    });
  }

  // Ensure active subscription so requireSubscription middleware passes
  const Subscription = require('../backend/models/Subscription');
  await Subscription.findOneAndUpdate(
    { collegeId: college._id },
    {
      collegeId: college._id,
      plan: 'enterprise',
      amount: 99999,
      status: 'active',
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    { upsert: true, new: true }
  );
  college.planExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await college.save();

  const uniqueSuffix = Date.now().toString();

  // Create Admin User
  const admin = await User.create({
    name: 'Chief Security Officer',
    email: `cso.${uniqueSuffix}@sctu.edu`,
    password: 'Password123!',
    role: 'collegeAdmin',
    collegeId: college._id,
    department: 'Security & Campus Facilities',
    phone: '9811002233',
    isActive: true,
  });

  // Create Faculty Host
  const faculty = await User.create({
    name: 'Dr. Vikram Sarabhai',
    email: `vikram.${uniqueSuffix}@sctu.edu`,
    password: 'Password123!',
    role: 'faculty',
    collegeId: college._id,
    department: 'Aerospace Engineering',
    designation: 'Department Chair',
    phone: '9822334455',
    isActive: true,
  });

  // Create Student
  const student = await User.create({
    name: 'Ananya Roy',
    email: `ananya.${uniqueSuffix}@sctu.edu`,
    password: 'Password123!',
    role: 'student',
    collegeId: college._id,
    rollNo: `AE-2026-${uniqueSuffix.slice(-4)}`,
    department: 'Aerospace Engineering',
    semester: 6,
    phone: '9833445566',
    isActive: true,
  });

  const adminToken = generateToken({ id: admin._id, role: admin.role, collegeId: college._id });
  const studentToken = generateToken({ id: student._id, role: student.role, collegeId: college._id });

  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  };

  const studentHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${studentToken}`,
  };

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  PASS: ${message}`);
      passed++;
    } else {
      console.error(`  FAIL: ${message}`);
    }
  }

  let testVisitorId = null;
  let testGatePass = null;
  let preRegVisitorId = null;
  let preRegGatePass = null;
  let testEventId = null;
  let testTicketNumber = null;
  let testGoalId = null;

  console.log('--- Phase 1: Visitor Check-In & Gate Pass Issuance ---');
  {
    const payload = {
      visitorName: 'Sunil Mehta',
      visitorPhone: '9898012345',
      visitorEmail: 'sunil.mehta@supplier.com',
      purpose: 'Lab Equipment Delivery & Inspection',
      category: 'vendor',
      hostUserId: 'Dr. Vikram Sarabhai', // Test resilient host name resolution
      department: 'Aerospace Engineering',
      meetingRoom: 'Propulsion Lab 2',
      vehicleNumber: 'KA-01-MJ-9988',
      vehicleType: 'truck',
      idType: 'driving_license',
      idNumber: 'DL-998822',
      itemsCarried: 'Calibrated Flow Sensors (2 Boxes)',
    };

    const res = await fetch(`${BASE_URL}/visitors`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    assert(data.success === true, 'POST /api/visitors check-in succeeds');
    assert(data.visitor?.status === 'checked-in', 'Visitor status is checked-in');
    assert(Boolean(data.visitor?.gatePass), `Gate pass generated: ${data.visitor?.gatePass}`);
    assert(data.visitor?.hostName?.includes('Vikram'), 'Host successfully resolved to faculty');
    assert(data.visitor?.vehicleNumber === 'KA-01-MJ-9988', 'Vehicle details captured');

    testVisitorId = data.visitor?._id;
    testGatePass = data.visitor?.gatePass;
  }

  console.log('\n--- Phase 2: Gate Pass Verification & Checkpoint QR Lookup ---');
  {
    // Verification by pass code
    const res = await fetch(`${BASE_URL}/visitors/verify`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ gatePass: testGatePass }),
    });
    const data = await res.json();
    assert(data.success === true, 'POST /api/visitors/verify succeeds');
    assert(data.valid === true, 'Gate pass validated successfully');
    assert(data.visitor?.visitorName === 'Sunil Mehta', 'Verified visitor name matches');
    assert(data.canCheckout === true, 'Visitor flagged as eligible for checkout');

    // Printable Pass endpoint
    const passRes = await fetch(`${BASE_URL}/visitors/pass/${testGatePass}`, { headers: adminHeaders });
    const passData = await passRes.json();
    assert(passRes.status === 200 && passData.success === true, 'GET /api/visitors/pass/:gatePass succeeds');
    assert(Boolean(passData.pass?.qrPayload), 'Pass contains simulated QR payload');
  }

  console.log('\n--- Phase 3: Pre-Registered Visitor Flow ---');
  {
    const prePayload = {
      visitorName: 'Pooja Verma',
      visitorPhone: '9844001122',
      visitorEmail: 'pooja.verma@consulting.com',
      purpose: 'Guest Lecture on Satellite Navigation',
      category: 'guest',
      hostUserId: String(faculty._id),
      department: 'Aerospace Engineering',
      meetingRoom: 'Auditorium A',
      expectedDuration: '3 hours',
    };

    const res = await fetch(`${BASE_URL}/visitors/pre-register`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(prePayload),
    });
    const data = await res.json();
    assert(data.success === true, 'POST /api/visitors/pre-register succeeds');
    assert(data.visitor?.status === 'pre-registered', 'Visitor status is pre-registered');
    preRegVisitorId = data.visitor?._id;
    preRegGatePass = data.visitor?.gatePass;

    // Check-in pre-registered visitor at the gate
    const checkinRes = await fetch(`${BASE_URL}/visitors/${preRegVisitorId}/checkin`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ badgeNumber: 'BADGE-GUEST-01' }),
    });
    const checkinData = await checkinRes.json();
    assert(checkinData.success === true, 'POST /api/visitors/:id/checkin succeeds');
    assert(checkinData.visitor?.status === 'checked-in', 'Pre-registered guest converted to checked-in');
    assert(checkinData.visitor?.badgeNumber === 'BADGE-GUEST-01', 'Badge number assigned');
  }

  console.log('\n--- Phase 4: Visitor Check-Out with Feedback & Security Notes ---');
  {
    const checkoutRes = await fetch(`${BASE_URL}/visitors/${testVisitorId}/checkout`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        feedback: 'Smooth campus security clearance and gate assistance',
        rating: 5,
        securityNotes: 'All items matched delivery manifest. Vehicle inspected at exit gate 2.',
      }),
    });
    const checkoutData = await checkoutRes.json();
    assert(checkoutData.success === true, 'POST /api/visitors/:id/checkout succeeds');
    assert(checkoutData.visitor?.status === 'checked-out', 'Status transitioned to checked-out');
    assert(Boolean(checkoutData.visitor?.checkOutTime), 'Check-out timestamp recorded');
    assert(checkoutData.visitor?.rating === 5, 'Visitor rating saved');
  }

  console.log('\n--- Phase 5: Security Blacklist Enforcement ---');
  {
    const blacklistRes = await fetch(`${BASE_URL}/visitors/blacklist`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        visitorId: testVisitorId,
        isBlacklisted: true,
        blacklistReason: 'Attempted to bypass hazardous materials protocol',
      }),
    });
    const blacklistData = await blacklistRes.json();
    assert(blacklistData.success === true, 'POST /api/visitors/blacklist succeeds');
    assert(blacklistData.visitor?.isBlacklisted === true, 'Visitor marked as blacklisted');

    // Attempt re-entry with blacklisted phone
    const denyRes = await fetch(`${BASE_URL}/visitors`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        visitorName: 'Sunil Mehta',
        visitorPhone: '9898012345',
        purpose: 'Attempted Entry',
        hostUserId: String(faculty._id),
      }),
    });
    assert(denyRes.status === 403, 'Blacklisted visitor entry blocked with HTTP 403 Forbidden');
    const denyData = await denyRes.json();
    assert(denyData.isBlacklisted === true, 'Denial payload confirms blacklisted status');
  }

  console.log('\n--- Phase 6: Visitor Statistics & CSV Export ---');
  {
    const statsRes = await fetch(`${BASE_URL}/visitors/stats`, { headers: adminHeaders });
    const statsData = await statsRes.json();
    assert(statsData.success === true, 'GET /api/visitors/stats succeeds');
    assert(statsData.stats?.total >= 2, `Total visitors counted (${statsData.stats?.total})`);
    assert(statsData.stats?.blacklisted >= 1, `Blacklisted visitor count tracked (${statsData.stats?.blacklisted})`);

    const exportRes = await fetch(`${BASE_URL}/visitors/export`, { headers: adminHeaders });
    assert(exportRes.status === 200, 'GET /api/visitors/export returns HTTP 200');
    const csv = await exportRes.text();
    assert(csv.includes('Gate Pass') && csv.includes('Visitor Name'), 'Export contains CSV header');
  }

  console.log('\n--- Phase 7: Event Creation & Ticketing RSVP ---');
  {
    const eventPayload = {
      title: 'Aerospace Propulsion Symposium 2026',
      description: 'Annual conference on next-generation scramjet and ion propulsion systems',
      category: 'technical',
      startDate: new Date(Date.now() + 86400000 * 5),
      endDate: new Date(Date.now() + 86400000 * 6),
      startTime: '09:30 AM',
      endTime: '05:00 PM',
      venue: 'Dr. APJ Abdul Kalam Auditorium',
      maxParticipants: 150,
      isVirtual: false,
    };

    const res = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(eventPayload),
    });
    const data = await res.json();
    assert(data.success === true, 'POST /api/events succeeds');
    assert(data.event?.title === 'Aerospace Propulsion Symposium 2026', 'Event title saved');
    assert(data.event?.maxParticipants === 150, 'Max participants capacity configured');
    testEventId = data.event?._id;

    // Student RSVP / Ticket Registration
    const rsvpRes = await fetch(`${BASE_URL}/events/${testEventId}/register`, {
      method: 'POST',
      headers: studentHeaders,
    });
    const rsvpData = await rsvpRes.json();
    assert(rsvpData.success === true, 'POST /api/events/:id/register succeeds');
    assert(Boolean(rsvpData.ticketNumber), `Unique ticket pass issued: ${rsvpData.ticketNumber}`);
    testTicketNumber = rsvpData.ticketNumber;

    // Prevent duplicate RSVP
    const dupRes = await fetch(`${BASE_URL}/events/${testEventId}/register`, {
      method: 'POST',
      headers: studentHeaders,
    });
    assert(dupRes.status === 400, 'Duplicate RSVP prevented with HTTP 400');
  }

  console.log('\n--- Phase 8: Gate Ticket Verification & Attendee Check-In ---');
  {
    const checkinRes = await fetch(`${BASE_URL}/events/${testEventId}/checkin-attendee`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ ticketNumber: testTicketNumber }),
    });
    const checkinData = await checkinRes.json();
    assert(checkinData.success === true, 'POST /api/events/:id/checkin-attendee succeeds');
    assert(checkinData.attendee?.status === 'attended', 'Attendee status updated to attended');
    assert(Boolean(checkinData.attendee?.attendedAt), 'Attendee check-in timestamp saved');

    // Export Attendees CSV
    const expRes = await fetch(`${BASE_URL}/events/${testEventId}/export-attendees`, { headers: adminHeaders });
    assert(expRes.status === 200, 'GET /api/events/:id/export-attendees returns HTTP 200');
    const expCsv = await expRes.text();
    assert(expCsv.includes('Ticket Number') && expCsv.includes('attended'), 'CSV export reflects attended status');

    // Event Stats
    const statsRes = await fetch(`${BASE_URL}/events/stats`, { headers: adminHeaders });
    const statsData = await statsRes.json();
    assert(statsData.success === true, 'GET /api/events/stats succeeds');
    assert(statsData.stats?.totalRegistrations >= 1, 'Total registrations counted in stats');
    assert(statsData.stats?.attendedCount >= 1, 'Attended count tracked in stats');
  }

  console.log('\n--- Phase 9: Energy & Sustainability Goals Tracking ---');
  {
    // Log Energy Reading
    const logRes = await fetch(`${BASE_URL}/energy/logs`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        type: 'solar',
        reading: 4250,
        unit: 'kWh',
        building: 'Aerospace Research Complex',
        cost: 0,
        source: 'sensor',
      }),
    });
    const logData = await logRes.json();
    assert(logData.success === true, 'POST /api/energy/logs succeeds');
    assert(logData.log?.reading === 4250, 'Energy reading saved');

    // Create Sustainability Goal
    const goalRes = await fetch(`${BASE_URL}/energy/goals`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: 'Solar Generation 40% Target',
        type: 'solar',
        target: 40,
        unit: '%',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000 * 365),
        milestones: [
          { title: 'Install Solar Canopies on West Parking', targetDate: new Date() },
          { title: 'Incorporate Battery Storage Phase 1', targetDate: new Date() },
        ],
      }),
    });
    const goalData = await goalRes.json();
    assert(goalRes.status === 201 && goalData.success === true, 'POST /api/energy/goals succeeds');
    testGoalId = goalData.goal?._id;

    // Toggle Milestone
    const patchRes = await fetch(`${BASE_URL}/energy/goals/${testGoalId}/milestone/0`, {
      method: 'PATCH',
      headers: adminHeaders,
    });
    const patchData = await patchRes.json();
    assert(patchData.success === true, 'PATCH /api/energy/goals/:id/milestone/:index succeeds');
    assert(patchData.goal?.milestones?.[0]?.completed === true, 'Milestone 0 toggled to completed');

    // Energy Dashboard
    const dashRes = await fetch(`${BASE_URL}/energy/dashboard`, { headers: adminHeaders });
    const dashData = await dashRes.json();
    assert(dashRes.status === 200 && dashData.success === true, 'GET /api/energy/dashboard succeeds');
    assert(Boolean(dashData.dashboard?.goals?.length > 0), 'Dashboard includes sustainability goals');
  }

  console.log('\n--- Phase 10: Feedback & Grievance Submissions & Analytics ---');
  {
    // Submit Feedback
    const fbRes = await fetch(`${BASE_URL}/feedback`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({
        type: 'facility',
        targetId: testEventId,
        targetModel: 'Event',
        ratings: {
          content: 5,
          delivery: 5,
          communication: 4,
          overall: 5,
        },
        comment: 'Outstanding organization and technical depth of symposium!',
        suggestions: 'Provide recording links to attendees afterwards.',
        isAnonymous: false,
      }),
    });
    const fbData = await fbRes.json();
    assert(fbData.success === true, 'POST /api/feedback succeeds');

    // Feedback Stats
    const fbStatsRes = await fetch(`${BASE_URL}/feedback/stats`, { headers: adminHeaders });
    const fbStatsData = await fbStatsRes.json();
    assert(fbStatsData.success === true, 'GET /api/feedback/stats succeeds');
    assert(fbStatsData.averages?.avgOverall >= 4, `Overall average feedback rating computed (${fbStatsData.averages?.avgOverall})`);

    // Create Grievance
    const gRes = await fetch(`${BASE_URL}/grievances`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({
        category: 'facilities',
        subject: 'Air Conditioning in Propulsion Lab',
        description: 'AC unit #2 is making grinding noise and fluctuating in temperature.',
        priority: 'medium',
      }),
    });
    const gData = await gRes.json();
    assert(gData.success === true, 'POST /api/grievances succeeds');
    const gId = gData.grievance?._id;

    // Admin response to grievance
    const respRes = await fetch(`${BASE_URL}/grievances/${gId}/responses`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        message: 'HVAC technician dispatched. Filter and belt scheduled for replacement today.',
      }),
    });
    const respData = await respRes.json();
    assert(respData.success === true, 'POST /api/grievances/:id/responses succeeds');
    assert(respData.grievance?.status === 'in-progress', 'Grievance transitioned to in-progress on staff response');
  }

  console.log('\n============================================================');
  console.log(`SMART CAMPUS SUITE SUMMARY: ${passed}/${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('============================================================\n');

  if (server) {
    server.close();
  }
  await mongoose.disconnect();
  process.exit(passed === total ? 0 : 1);
}

runTests().catch(err => {
  if (server) {
    server.close();
  }
  console.error('Test execution failed:', err);
  process.exit(1);
});
