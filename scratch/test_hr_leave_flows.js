require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');

const User = require('../backend/models/User');
const College = require('../backend/models/College');
const Subscription = require('../backend/models/Subscription');
const Leave = require('../backend/models/Leave');
const Timetable = require('../backend/models/Timetable');
const Course = require('../backend/models/Course');
const Subject = require('../backend/models/Subject');
const { generateToken } = require('../backend/config/jwt');

process.env.VERCEL = 'true';
const app = require('../backend/server');

let BASE_URL = '';
let server = null;

async function runHRLeaveTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       SUITE 16: HR, WORKLOAD & LEAVE MANAGEMENT SUITE       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/vishva_erp');
  console.log(' Connected to MongoDB');

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  BASE_URL = `http://127.0.0.1:${port}`;
  console.log(` Test server listening at ${BASE_URL}\n`);

  let college = await College.findOne({ isActive: true });
  if (!college) {
    college = await College.create({
      name: 'Vishwa Institute of Technology',
      code: 'VIT-HR-01',
      address: 'Tech Corridor, Bengaluru',
      email: 'admin@vit-hr.edu',
      phone: '9876500991',
      isActive: true,
    });
  }

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

  // Create Admin
  const admin = await User.create({
    name: 'HR Director Admin',
    email: `hradmin_${uniqueSuffix}@example.com`,
    password: 'password123',
    role: 'collegeAdmin',
    collegeId: college._id,
    isActive: true,
  });
  const adminToken = generateToken({ id: admin._id, role: admin.role, collegeId: college._id });

  // Create Faculty 1 (Applicant)
  const faculty1 = await User.create({
    name: 'Dr. Alan Turing',
    email: `alan_${uniqueSuffix}@example.com`,
    password: 'password123',
    role: 'faculty',
    department: 'Computer Science',
    designation: 'Professor & Head',
    collegeId: college._id,
    phone: '9876543210',
    isActive: true,
  });
  const faculty1Token = generateToken({ id: faculty1._id, role: faculty1.role, collegeId: college._id });

  // Create Faculty 2 (Substitute Colleague)
  const faculty2 = await User.create({
    name: 'Dr. Grace Hopper',
    email: `grace_${uniqueSuffix}@example.com`,
    password: 'password123',
    role: 'faculty',
    department: 'Computer Science',
    designation: 'Associate Professor',
    collegeId: college._id,
    phone: '9876543211',
    isActive: true,
  });
  const faculty2Token = generateToken({ id: faculty2._id, role: faculty2.role, collegeId: college._id });

  // Create Student
  const student = await User.create({
    name: 'Ada Lovelace',
    email: `ada_${uniqueSuffix}@example.com`,
    password: 'password123',
    role: 'student',
    rollNo: `CS-HR-${uniqueSuffix.slice(-4)}`,
    department: 'Computer Science',
    semester: 4,
    collegeId: college._id,
    phone: '9876543212',
    isActive: true,
  });
  const studentToken = generateToken({ id: student._id, role: student.role, collegeId: college._id });

  // Helper request function
  async function request(method, path, body = null, token = null) {
    const url = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    };

    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, headers: res.headers, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, body: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  let facultyLeaveId = null;
  let studentLeaveId = null;

  try {
    // --- Phase 1: Faculty Leave Application with Substitute Colleague ---
    console.log('--- Phase 1: Faculty Leave Application with Substitute Assignment ---');
    const leaveStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const leaveEnd = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    const applyRes = await request('POST', '/api/leave/apply', {
      leaveType: 'casual',
      startDate: leaveStart.toISOString(),
      endDate: leaveEnd.toISOString(),
      reason: 'Attending IEEE AI International Symposium in Tokyo',
      substituteFacultyId: faculty2._id,
      substituteNotes: 'Please cover CS401 Lecture on Monday 10am',
      contactDuringLeave: '+81-90-1234-5678',
    }, faculty1Token);

    console.assert(applyRes.status === 201, `Expected status 201, got ${applyRes.status}`);
    console.assert(applyRes.body.success === true, 'Expected success true');
    console.assert(applyRes.body.leave.leaveType === 'casual', 'Expected leaveType casual');
    console.assert(applyRes.body.leave.substituteStatus === 'pending', 'Expected substituteStatus pending');
    console.assert(applyRes.body.leave.totalDays === 2, `Expected totalDays 2, got ${applyRes.body.leave.totalDays}`);
    facultyLeaveId = applyRes.body.leave._id;
    console.log('  ✓ Faculty successfully applied for 2 days Casual Leave');
    console.log(`  ✓ Substitute assigned: ${faculty2.name}, status: pending\n`);

    // --- Phase 2: Date Overlap Prevention Check ---
    console.log('--- Phase 2: Date Overlap Conflict Safeguard ---');
    const overlapRes = await request('POST', '/api/leave/apply', {
      leaveType: 'sick',
      startDate: leaveStart.toISOString(),
      endDate: leaveEnd.toISOString(),
      reason: 'Overlapping application attempt',
    }, faculty1Token);

    console.assert(overlapRes.status === 400, `Expected status 400, got ${overlapRes.status}`);
    console.assert(overlapRes.body.success === false, 'Expected success false for overlap');
    console.log('  ✓ Overlap detected and rejected with HTTP 400 Bad Request\n');

    // --- Phase 3: Substitute Colleague Coverage Request Handshake ---
    console.log('--- Phase 3: Substitute Colleague Handshake (Accept / Decline) ---');
    const subReqRes = await request('GET', '/api/leave/substitute-requests', null, faculty2Token);
    console.assert(subReqRes.status === 200, `Expected status 200, got ${subReqRes.status}`);
    console.assert(subReqRes.body.count >= 1, 'Expected at least 1 substitute request');
    console.log(`  ✓ Colleague received substitute request for ${subReqRes.body.requests[0].userId.name}`);

    // Respond Accepted
    const respondRes = await request('PATCH', `/api/leave/${facultyLeaveId}/substitute-response`, {
      response: 'accepted',
      notes: 'Happy to cover the AI lecture slot!',
    }, faculty2Token);

    console.assert(respondRes.status === 200, `Expected status 200, got ${respondRes.status}`);
    console.assert(respondRes.body.leave.substituteStatus === 'accepted', 'Expected substituteStatus accepted');
    console.log('  ✓ Substitute colleague accepted coverage request\n');

    // --- Phase 4: Student Leave Application (Medical / OD) with Proof Attachment ---
    console.log('--- Phase 4: Student Medical / On-Duty Leave Application ---');
    const studentStart = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const studentEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const studentApplyRes = await request('POST', '/api/leave/apply', {
      leaveType: 'medical',
      startDate: studentStart.toISOString(),
      endDate: studentEnd.toISOString(),
      isHalfDay: true,
      halfDaySession: 'second_half',
      reason: 'Scheduled Dental Surgery',
      attachments: [{
        name: 'Dentist_Doctor_Prescription.pdf',
        url: 'https://cdn.vishvaerp.edu/docs/dentist_cert.pdf',
        fileType: 'pdf',
      }],
    }, studentToken);

    console.assert(studentApplyRes.status === 201, `Expected status 201, got ${studentApplyRes.status}`);
    console.assert(studentApplyRes.body.leave.totalDays === 0.5, `Expected 0.5 days, got ${studentApplyRes.body.leave.totalDays}`);
    console.assert(studentApplyRes.body.leave.isHalfDay === true, 'Expected isHalfDay true');
    console.assert(studentApplyRes.body.leave.attachments.length === 1, 'Expected 1 attachment');
    studentLeaveId = studentApplyRes.body.leave._id;
    console.log('  ✓ Student applied for half-day Medical Leave with certificate attachment\n');

    // --- Phase 5: Student Leave Cancellation Prior to Approval ---
    console.log('--- Phase 5: Applicant Leave Cancellation ---');
    const cancelRes = await request('PUT', `/api/leave/${studentLeaveId}/cancel`, {
      reason: 'Appointment rescheduled by clinic',
    }, studentToken);

    console.assert(cancelRes.status === 200, `Expected status 200, got ${cancelRes.status}`);
    console.assert(cancelRes.body.leave.status === 'cancelled', 'Expected status cancelled');
    console.log('  ✓ Student successfully cancelled pending leave application\n');

    // Student re-applies for a sports On-Duty (OD) leave
    const odStart = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const odEnd = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    const odApplyRes = await request('POST', '/api/leave/apply', {
      leaveType: 'duty',
      startDate: odStart.toISOString(),
      endDate: odEnd.toISOString(),
      reason: 'Representing University at Inter-College Hackathon',
    }, studentToken);
    studentLeaveId = odApplyRes.body.leave._id;
    console.log('  ✓ Student applied for 2-day On-Duty (OD) hackathon leave\n');

    // --- Phase 6: Admin Leave Review & Approval ---
    console.log('--- Phase 6: Institutional Admin Review & Approval ---');
    const allLeavesRes = await request('GET', '/api/leave/all?status=pending', null, adminToken);
    console.assert(allLeavesRes.status === 200, `Expected status 200, got ${allLeavesRes.status}`);
    console.assert(allLeavesRes.body.leaves.length >= 2, 'Expected at least 2 pending leaves');
    console.log(`  ✓ Admin retrieved ${allLeavesRes.body.leaves.length} pending leave requests`);

    // Approve Faculty Leave
    const approveFacultyRes = await request('PUT', `/api/leave/${facultyLeaveId}/status`, {
      status: 'approved',
      remarks: 'Approved. Dean notified for international travel.',
    }, adminToken);

    console.assert(approveFacultyRes.status === 200, `Expected status 200, got ${approveFacultyRes.status}`);
    console.assert(approveFacultyRes.body.leave.status === 'approved', 'Expected status approved');
    console.assert(approveFacultyRes.body.leave.approvedBy.name === admin.name, 'Expected approvedBy admin');
    console.log('  ✓ Admin approved faculty casual leave');

    // Reject Student OD with remarks
    const rejectStudentRes = await request('PUT', `/api/leave/${studentLeaveId}/status`, {
      status: 'rejected',
      remarks: 'Hackathon conflicts with Mid-Term Examination schedule',
    }, adminToken);

    console.assert(rejectStudentRes.status === 200, `Expected status 200, got ${rejectStudentRes.status}`);
    console.assert(rejectStudentRes.body.leave.status === 'rejected', 'Expected status rejected');
    console.assert(rejectStudentRes.body.leave.rejectionReason.includes('Mid-Term'), 'Expected rejectionReason');
    console.log('  ✓ Admin rejected student OD request with formal reason\n');

    // --- Phase 7: Faculty Quotas & Annual Balances Verification ---
    console.log('--- Phase 7: Faculty Quota Ledger & Deductions ---');
    const myLeavesRes = await request('GET', '/api/leave/my-leaves', null, faculty1Token);
    console.assert(myLeavesRes.status === 200, `Expected status 200, got ${myLeavesRes.status}`);
    console.assert(myLeavesRes.body.balances.casual.used === 2, `Expected 2 casual days used, got ${myLeavesRes.body.balances.casual.used}`);
    console.assert(myLeavesRes.body.balances.casual.remaining === 10, `Expected 10 casual days remaining, got ${myLeavesRes.body.balances.casual.remaining}`);
    console.log('  ✓ Faculty quota updated: 2 days used, 10 days remaining for Casual Leave\n');

    // --- Phase 8: HR & Leave Aggregate Statistics ---
    console.log('--- Phase 8: Executive HR & Absenteeism Analytics ---');
    const statsRes = await request('GET', '/api/leave/stats', null, adminToken);
    console.assert(statsRes.status === 200, `Expected status 200, got ${statsRes.status}`);
    console.assert(statsRes.body.stats.totalStaff >= 2, 'Expected totalStaff >= 2');
    console.assert('presentToday' in statsRes.body.stats, 'Expected presentToday');
    console.assert('onLeaveToday' in statsRes.body.stats, 'Expected onLeaveToday');
    console.assert('attendanceRateToday' in statsRes.body.stats, 'Expected attendanceRateToday');
    console.log('  ✓ HR stats: total staff, present count, on-leave count, attendance rate\n');

    // --- Phase 9: Faculty Teaching Workload Metrics ---
    console.log('--- Phase 9: Faculty Teaching Workload Calculation ---');
    // Create course and subject for timetable
    const course = await Course.create({
      collegeId: college._id,
      name: 'Computer Science & Engineering',
      code: `CSE-HR-${uniqueSuffix.slice(-4)}`,
      department: 'Computer Science',
      duration: 4,
    });
    const subject = await Subject.create({
      collegeId: college._id,
      courseId: course._id,
      name: 'Advanced Operating Systems',
      code: `CS501-HR`,
      semester: 4,
      credits: 4,
    });
    // Create 2 timetable slots for faculty1
    await Timetable.create([
      {
        collegeId: college._id,
        courseId: course._id,
        subjectId: subject._id,
        facultyId: faculty1._id,
        semester: 4,
        dayOfWeek: 'Monday',
        startTime: '09:00',
        endTime: '10:30', // 1.5 hours
        room: 'Hall 101',
        type: 'lecture',
      },
      {
        collegeId: college._id,
        courseId: course._id,
        subjectId: subject._id,
        facultyId: faculty1._id,
        semester: 4,
        dayOfWeek: 'Wednesday',
        startTime: '11:00',
        endTime: '12:00', // 1.0 hour
        room: 'Lab 2',
        type: 'lab',
      },
    ]);

    const workloadRes = await request('GET', '/api/hr/faculty-workload', null, adminToken);
    console.assert(workloadRes.status === 200, `Expected status 200, got ${workloadRes.status}`);
    const turingWorkload = workloadRes.body.facultyWorkload.find(w => String(w.facultyId) === String(faculty1._id));
    console.assert(turingWorkload !== undefined, 'Expected Turing workload found');
    console.assert(turingWorkload.weeklyClasses === 2, `Expected 2 weekly classes, got ${turingWorkload.weeklyClasses}`);
    console.assert(turingWorkload.weeklyHours === 2.5, `Expected 2.5 contact hours, got ${turingWorkload.weeklyHours}`);
    console.assert(turingWorkload.distinctSubjects === 1, 'Expected 1 distinct subject');
    console.log(`  ✓ Workload calculated for ${turingWorkload.name}: ${turingWorkload.weeklyClasses} classes, ${turingWorkload.weeklyHours}h/week\n`);

    // --- Phase 10: Institutional RFC CSV Export ---
    console.log('--- Phase 10: Institutional Leave CSV Export ---');
    const csvRes = await request('GET', '/api/leave/export', null, adminToken);
    console.assert(csvRes.status === 200, `Expected status 200, got ${csvRes.status}`);
    console.assert(csvRes.headers['content-type'].includes('text/csv'), 'Expected text/csv content type');
    console.assert(csvRes.body.includes('Application ID,Applicant Name,Role'), 'Expected CSV headers');
    console.assert(csvRes.body.includes('Dr. Alan Turing'), 'Expected Turing in CSV');
    console.assert(csvRes.body.includes('Ada Lovelace'), 'Expected Ada in CSV');
    console.log('  ✓ Leave ledger exported cleanly in RFC 4180 CSV format\n');

    // --- Phase 11: Route Parity Across All Mounts ---
    console.log('--- Phase 11: Route Parity Across Prefixes ---');
    const parityEndpoints = [
      ['GET', '/api/leave/all'],
      ['GET', '/api/hr/all'],
      ['GET', '/api/v1/leave/all'],
      ['GET', '/api/v1/hr/all'],
      ['GET', '/api/leave/stats'],
      ['GET', '/api/hr/stats'],
      ['GET', '/api/v1/leave/stats'],
      ['GET', '/api/v1/hr/stats'],
      ['GET', '/api/hr/faculty-workload'],
      ['GET', '/api/v1/hr/faculty-workload'],
    ];

    for (const [method, endpoint] of parityEndpoints) {
      const res = await request(method, endpoint, null, adminToken);
      console.assert(res.status === 200, `Parity check failed for ${endpoint}: expected 200, got ${res.status}`);
      console.log(`  ✓ ${method} ${endpoint} parity verified (status 200)`);
    }

    console.log('\n================================================================');
    console.log('🎉 ALL SUITE 16 ASSERTIONS PASSED WITH 100% SUCCESS!');
    console.log('================================================================\n');

  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  } finally {
    console.log('--- Phase 12: Teardown & Hygiene ---');
    await Leave.deleteMany({ collegeId: college._id });
    await Timetable.deleteMany({ collegeId: college._id });
    await Course.deleteMany({ collegeId: college._id });
    await Subject.deleteMany({ collegeId: college._id });
    await User.deleteMany({ email: { $in: [admin.email, faculty1.email, faculty2.email, student.email] } });
    console.log(' Cleaned up test records.');

    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    await mongoose.connection.close();
    console.log(' Closed server and MongoDB connection.');
    process.exit(0);
  }
}

runHRLeaveTests();
