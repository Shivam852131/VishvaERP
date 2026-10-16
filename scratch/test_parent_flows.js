const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { generateToken } = require('../backend/config/jwt');

const User = require('../backend/models/User');
const College = require('../backend/models/College');
const Course = require('../backend/models/Course');
const Subject = require('../backend/models/Subject');
const Attendance = require('../backend/models/Attendance');
const Result = require('../backend/models/Result');
const Exam = require('../backend/models/Exam');
const Fee = require('../backend/models/Fee');
const { Room, Hostel } = require('../backend/models/Hostel');
const TransportRoute = require('../backend/models/Transport');
const ParentNotificationPreference = require('../backend/models/ParentNotificationPreference');

const http = require('http');
process.env.VERCEL = 'true'; // prevent auto listen in server.js
const app = require('../backend/server');

let BASE_URL = '';
let server = null;

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║      STARTING SUITE 11: PARENT PORTAL & CHILD 360 SUITE    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/vishva_erp');
  console.log(' Connected to MongoDB');

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  BASE_URL = `http://127.0.0.1:${port}/api`;
  console.log(` Test server listening at ${BASE_URL}`);

  let college = await College.findOne({ isActive: true });
  if (!college) {
    college = await College.create({
      name: 'Parent Portal Test University',
      code: 'PPTU-01',
      address: 'University Campus, Mumbai',
      email: 'admin@pptu.edu',
      phone: '9876543210',
      isActive: true,
    });
  }

  // 1. Create or ensure Faculty mentor
  let faculty = await User.findOne({ collegeId: college._id, role: 'faculty' });
  if (!faculty) {
    faculty = await User.create({
      name: 'Dr. Ramesh Sharma',
      email: 'dr.sharma@pptu.edu',
      password: 'Password123!',
      role: 'faculty',
      collegeId: college._id,
      designation: 'Professor & Head',
      phone: '9820011223',
    });
  }

  // 2. Create Course & Subjects
  let course = await Course.findOne({ collegeId: college._id, department: 'Computer Science' });
  if (!course) {
    course = await Course.create({
      collegeId: college._id,
      name: 'B.Tech Computer Science & Engineering',
      code: 'CSE-UG',
      department: 'Computer Science',
    });
  }

  let subject1 = await Subject.findOne({ collegeId: college._id, code: 'CS501' });
  if (!subject1) {
    subject1 = await Subject.create({
      collegeId: college._id,
      courseId: course._id,
      name: 'Data Structures & Algorithms',
      code: 'CS501',
      department: 'Computer Science',
      semester: 5,
      credits: 4,
      facultyId: faculty._id,
    });
  } else {
    subject1.facultyId = faculty._id;
    await subject1.save();
  }

  let subject2 = await Subject.findOne({ collegeId: college._id, code: 'CS502' });
  if (!subject2) {
    subject2 = await Subject.create({
      collegeId: college._id,
      courseId: course._id,
      name: 'Database Management Systems',
      code: 'CS502',
      department: 'Computer Science',
      semester: 5,
      credits: 4,
      facultyId: faculty._id,
    });
  } else {
    subject2.facultyId = faculty._id;
    await subject2.save();
  }

  // 3. Create Student and Parent
  const studentEmail = `student.parent.test.${Date.now()}@pptu.edu`;
  const parentEmail = `parent.test.${Date.now()}@pptu.edu`;

  const student = await User.create({
    name: 'Aarav Verma',
    email: studentEmail,
    password: 'Password123!',
    role: 'student',
    collegeId: college._id,
    rollNo: `CS-2026-${Date.now().toString().slice(-4)}`,
    enrollmentNo: `ENR-${Date.now().toString().slice(-6)}`,
    department: 'Computer Science',
    semester: 5,
    gender: 'male',
    bloodGroup: 'O+',
    dateOfBirth: new Date('2004-05-15'),
    phone: '9811122233',
    address: '104, Green Heights, Andheri West, Mumbai',
  });

  const parent = await User.create({
    name: 'Mr. Rajesh Verma',
    email: parentEmail,
    password: 'Password123!',
    role: 'parent',
    collegeId: college._id,
    phone: '9899988877',
    children: [student._id],
  });

  student.parentId = parent._id;
  await student.save();

  // 4. Create Hostel & Room
  let hostel = await Hostel.findOne({ collegeId: college._id });
  if (!hostel) {
    hostel = await Hostel.create({
      collegeId: college._id,
      name: 'Kailash Boys Hostel Block A',
      type: 'boys',
      totalRooms: 50,
      facilities: ['Wi-Fi', 'Gym', 'Laundry'],
    });
  }

  let room = await Room.findOne({ collegeId: college._id, roomNumber: '304' });
  if (!room) {
    room = await Room.create({
      collegeId: college._id,
      hostelId: hostel._id,
      roomNumber: '304',
      capacity: 2,
      feePerTerm: 35000,
      occupants: [student._id],
    });
  } else {
    room.occupants = [student._id];
    await room.save();
  }

  // 5. Create Transport Route
  let route = await TransportRoute.findOne({ collegeId: college._id, routeName: 'Route 12 - Powai Express' });
  if (!route) {
    route = await TransportRoute.create({
      collegeId: college._id,
      routeName: 'Route 12 - Powai Express',
      busNumber: 'MH-02-CE-8899',
      driverName: 'Mohan Lal',
      driverPhone: '9877766655',
      capacity: 40,
      stops: [
        { stopName: 'Hiranandani Gardens', time: '07:30 AM', order: 1 },
        { stopName: 'IIT Main Gate', time: '07:45 AM', order: 2 },
        { stopName: 'University Campus', time: '08:15 AM', order: 3 },
      ],
      enrolledStudents: [student._id],
      isActive: true,
    });
  } else {
    if (!route.enrolledStudents.includes(student._id)) {
      route.enrolledStudents.push(student._id);
      await route.save();
    }
  }

  // 6. Create Attendance records
  const today = new Date();
  for (let i = 0; i < 10; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    await Attendance.create({
      collegeId: college._id,
      studentId: student._id,
      subjectId: subject1._id,
      facultyId: faculty._id,
      date: d,
      status: i === 2 ? 'absent' : (i === 4 ? 'late' : 'present'),
      source: i % 2 === 0 ? 'smart-location' : 'manual',
    });
  }

  // 7. Create Exams & Results
  const exam1 = await Exam.create({
    collegeId: college._id,
    name: 'Mid-Semester Exam - DSA',
    subjectId: subject1._id,
    courseId: course._id,
    examType: 'midterm',
    date: new Date(),
    totalMarks: 100,
    passingMarks: 40,
    semester: 5,
  });

  const exam2 = await Exam.create({
    collegeId: college._id,
    name: 'Mid-Semester Exam - DBMS',
    subjectId: subject2._id,
    courseId: course._id,
    examType: 'midterm',
    date: new Date(),
    totalMarks: 100,
    passingMarks: 40,
    semester: 5,
  });

  await Result.create({
    collegeId: college._id,
    studentId: student._id,
    examId: exam1._id,
    subjectId: subject1._id,
    marksObtained: 86,
    totalMarks: 100,
    percentage: 86,
    grade: 'A',
    gradePoints: 9,
    status: 'pass',
    remarks: 'Consistent analytical problem solving',
  });

  await Result.create({
    collegeId: college._id,
    studentId: student._id,
    examId: exam2._id,
    subjectId: subject2._id,
    marksObtained: 92,
    totalMarks: 100,
    percentage: 92,
    grade: 'A+',
    gradePoints: 10,
    status: 'pass',
    remarks: 'Outstanding database design project',
  });

  // 8. Create Fee record
  const due = new Date();
  due.setDate(due.getDate() + 15);
  await Fee.create({
    collegeId: college._id,
    studentId: student._id,
    feeType: 'tuition',
    amount: 45000,
    paidAmount: 25000,
    dueDate: due,
    status: 'partial',
    semester: 5,
    academicYear: '2026-2027',
    department: 'Computer Science',
  });

  const parentToken = generateToken({ id: parent._id, role: 'parent', collegeId: college._id });

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${parentToken}`,
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

  console.log('--- Phase 1: Authentication & Linked Ward Validation ---');
  {
    const res = await fetch(`${BASE_URL}/auth/me`, { headers });
    const data = await res.json();
    assert(data.success === true, 'GET /api/auth/me succeeds');
    assert(data.user?.children?.length > 0, 'Parent has children populated');
    assert(String(data.user?.children?.[0]?._id) === String(student._id), 'Populated child matches student ID');
    assert(data.user?.children?.[0]?.name === 'Aarav Verma', 'Child name correctly populated');
  }

  console.log('\n--- Phase 2: Child 360° Academic Profile ---');
  {
    const res = await fetch(`${BASE_URL}/academics/student-profile`, { headers });
    const data = await res.json();
    assert(data.success === true, 'GET /api/academics/student-profile succeeds');
    assert(data.profile?.student?.name === 'Aarav Verma', 'Student name in 360 profile');
    assert(Boolean(data.profile?.mentor?.name), `Mentor faculty assigned in profile (${data.profile?.mentor?.name})`);
    assert(data.profile?.hostelRoom?.roomNumber === '304', 'Hostel room allocated in profile');
    assert(data.profile?.transportRoute?.routeName === 'Route 12 - Powai Express', 'Transport route allocated in profile');
    assert(data.profile?.vitals?.attendancePercentage > 0, `Attendance vitals calculated (${data.profile?.vitals?.attendancePercentage}%)`);
    assert(data.profile?.vitals?.cgpa !== 'N/A', `Cumulative CGPA calculated (${data.profile?.vitals?.cgpa})`);
    assert(data.profile?.vitals?.outstandingFees === 20000, `Outstanding fee calculated (₹${data.profile?.vitals?.outstandingFees})`);
    assert(data.profile?.assignedSubjects?.length >= 2, `Enrolled subjects present (${data.profile?.assignedSubjects?.length} subjects)`);
  }

  console.log('\n--- Phase 3: Ward Attendance Suite (Summary, Calendar, Streak, Ledger) ---');
  {
    // Summary
    const sumRes = await fetch(`${BASE_URL}/attendance/summary`, { headers });
    const sumData = await sumRes.json();
    assert(sumData.success === true, 'GET /api/attendance/summary succeeds');
    assert(sumData.summary?.length > 0, 'Subject-wise attendance breakdown returned');
    assert(sumData.student?.name === 'Aarav Verma', 'Student metadata returned in summary');

    // Calendar
    const calRes = await fetch(`${BASE_URL}/attendance/calendar?days=30`, { headers });
    const calData = await calRes.json();
    assert(calData.success === true, 'GET /api/attendance/calendar succeeds');
    assert(calData.calendar?.length > 0, 'Calendar daily status array returned');

    // Streak
    const streakRes = await fetch(`${BASE_URL}/attendance/streak`, { headers });
    const streakData = await streakRes.json();
    assert(streakData.success === true, 'GET /api/attendance/streak succeeds');
    assert(streakData.currentStreak !== undefined, 'Current streak calculated');

    // Ledger records
    const attRes = await fetch(`${BASE_URL}/attendance`, { headers });
    const attData = await attRes.json();
    assert(attData.success === true, 'GET /api/attendance succeeds for parent');
    assert(attData.attendance?.length >= 10, `Attendance records retrieved (${attData.attendance?.length})`);
  }

  console.log('\n--- Phase 4: Ward Academic Results & Marksheets ---');
  {
    const res = await fetch(`${BASE_URL}/exams/results`, { headers });
    const data = await res.json();
    assert(data.success === true, 'GET /api/exams/results succeeds for parent');
    assert(data.student?.name === 'Aarav Verma', 'Results contains student metadata');
    assert(data.semesters?.length > 0, 'Semesters breakdown populated');
    assert(data.cgpa !== 'N/A', `CGPA calculated for ward: ${data.cgpa}`);
    assert(data.standing === 'First Class with Distinction', `Academic standing evaluated: ${data.standing}`);
    assert(data.results?.length >= 2, `Subject results retrieved (${data.results?.length} records)`);
  }

  console.log('\n--- Phase 5: Ward Fee Payments & Statements ---');
  {
    const res = await fetch(`${BASE_URL}/fees`, { headers });
    const data = await res.json();
    assert(data.success === true, 'GET /api/fees succeeds for parent');
    assert(data.fees?.length > 0, 'Ward fee records retrieved');
    const feeItem = data.fees.find(f => f.feeType === 'tuition');
    assert(feeItem && feeItem.amount === 45000, 'Tuition fee found with correct amount');
    assert(feeItem && feeItem.paidAmount === 25000, 'Partial payment reflected');
    assert(feeItem && feeItem.status === 'partial', 'Partial fee status evaluated');
  }

  console.log('\n--- Phase 6: Notification Preferences & Channels ---');
  {
    // Preferences GET
    const prefRes = await fetch(`${BASE_URL}/notification-preferences/preferences`, { headers });
    const prefData = await prefRes.json();
    assert(prefData.success === true, 'GET /api/notification-preferences/preferences succeeds');

    // Preferences PUT
    const updatePayload = {
      channels: { push: true, email: true, whatsapp: true },
      whatsappPhone: '+919899988877',
      preferences: {
        attendance: { push: true, email: true, whatsapp: true, threshold: 80 },
        fees: { push: true, email: true, whatsapp: true, reminderDaysBefore: 5 },
      },
      quietHours: {
        enabled: true,
        start: '23:00',
        end: '06:00',
        timezone: 'Asia/Kolkata',
      },
    };
    const putRes = await fetch(`${BASE_URL}/notification-preferences/preferences`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updatePayload),
    });
    const putData = await putRes.json();
    assert(putData.success === true, 'PUT /api/notification-preferences/preferences succeeds');
    assert(putData.prefs?.whatsappPhone === '+919899988877', 'WhatsApp phone saved');
    assert(putData.prefs?.quietHours?.enabled === true, 'Quiet hours saved');

    // Channel Status
    const chRes = await fetch(`${BASE_URL}/notification-preferences/channels`, { headers });
    const chData = await chRes.json();
    assert(chData.success === true, 'GET /api/notification-preferences/channels succeeds');
    assert(chData.channels !== undefined, 'Channel health status returned');

    // Notifications history
    const notifRes = await fetch(`${BASE_URL}/notifications`, { headers });
    const notifData = await notifRes.json();
    assert(notifData.success === true, 'GET /api/notifications succeeds for parent');
  }

  console.log('\n--- Phase 7: Bi-directional Fallback Resilience ---');
  {
    // Clear parent.children in DB to simulate parent registered without explicit children array
    await User.findByIdAndUpdate(parent._id, { $set: { children: [] } });

    // 1. Profile retrieval should still find the student via student.parentId
    const profRes = await fetch(`${BASE_URL}/academics/student-profile`, { headers });
    const profData = await profRes.json();
    assert(profData.success === true && profData.profile?.student?.name === 'Aarav Verma', 'Profile succeeds via bi-directional student.parentId fallback');

    // 2. Attendance summary should still work
    const sumRes = await fetch(`${BASE_URL}/attendance/summary`, { headers });
    const sumData = await sumRes.json();
    assert(sumData.success === true && sumData.summary?.length > 0, 'Attendance summary succeeds via student.parentId fallback');

    // 3. Results should still work
    const resRes = await fetch(`${BASE_URL}/exams/results`, { headers });
    const resData = await resRes.json();
    assert(resData.success === true && resData.results?.length > 0, 'Results succeeds via student.parentId fallback');

    // 4. Fees should still work
    const feeRes = await fetch(`${BASE_URL}/fees`, { headers });
    const feeData = await feeRes.json();
    assert(feeData.success === true && feeData.fees?.length > 0, 'Fees succeeds via student.parentId fallback');
  }

  console.log('\n============================================================');
  console.log(`PARENT PORTAL SUITE SUMMARY: ${passed}/${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
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
