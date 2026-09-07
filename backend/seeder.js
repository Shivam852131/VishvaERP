require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const College = require('./models/College');
const Course = require('./models/Course');
const Subject = require('./models/Subject');
const Attendance = require('./models/Attendance');
const Exam = require('./models/Exam');
const Result = require('./models/Result');
const Fee = require('./models/Fee');
const Leave = require('./models/Leave');
const Timetable = require('./models/Timetable');
const Assignment = require('./models/Assignment');
const Notice = require('./models/Notice');
const { Book } = require('./models/Library');
const Hostel = require('./models/Hostel');
const { Room } = require('./models/Hostel');
const TransportRoute = require('./models/Transport');
const PlatformSetting = require('./models/PlatformSetting');

const DEPARTMENTS = ['Computer Science', 'Electronics', 'Mechanical', 'Civil', 'Business Administration'];
const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const TIMES = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00'];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomDate(s, e) { return new Date(s.getTime() + Math.random() * (e.getTime() - s.getTime())); }

async function seed() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/vishvaerp';
  await mongoose.connect(uri);
  console.log('\n=== VishvaERP Database Seeder ===\n');

  const args = process.argv.slice(2);
  if (args.includes('--drop')) {
    const cols = await mongoose.connection.db.listCollections().toArray();
    for (const c of cols) await mongoose.connection.db.dropCollection(c.name);
    console.log('All collections dropped.\n');
  }

  // 1. Platform Settings
  console.log('1. Creating platform settings...');
  await PlatformSetting.findOneAndUpdate({ key: 'platform' }, {
    key: 'platform',
    general: { appName: 'VishvaERP', appVersion: '2.0.0', supportEmail: 'support@vishvaerp.com', timezone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY' },
    security: { maxLoginAttempts: 5, sessionTimeout: 60, passwordMinLength: 6 },
    ai: { enabled: true, defaultModel: 'gpt-4o-mini', features: ['chat', 'tutor', 'notes', 'exam-generator'] },
  }, { upsert: true, new: true });

  // 2. Super Admin
  console.log('2. Creating super admin...');
  const saEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@vishvaerp.com';
  const saPass = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
  let sa = await User.findOne({ email: saEmail });
  if (!sa) sa = await User.create({ name: 'Super Admin', email: saEmail, password: saPass, role: 'superadmin', isActive: true });
  console.log('   Super Admin: ' + sa.email);

  if (args.includes('--no-sample')) {
    console.log('\nSeeder finished (--no-sample, base only).');
    await mongoose.connection.close(); process.exit(0);
  }

  // 3. College
  console.log('3. Creating sample college...');
  const [college] = await College.insertMany([
    { name: 'Tech University', code: 'TECH001', email: 'admin@techuniversity.edu', phone: '+91-9876543210', address: '123 Tech Park', city: 'Bangalore', state: 'Karnataka', country: 'India', isActive: true, plan: 'enterprise', departments: DEPARTMENTS },
  ]);

  // 4. Users
  console.log('4. Creating sample users...');
  const ca = await User.create({ name: 'Dr. A. Sharma', email: 'admin@techuniversity.edu', password: 'Admin@123', role: 'collegeAdmin', collegeId: college._id, isActive: true });
  college.adminId = ca._id; await college.save();

  const fData = [
    { name: 'Prof. Rajesh Kumar', email: 'rajesh@techuniversity.edu', department: 'Computer Science' },
    { name: 'Dr. Sunita Verma', email: 'sunita@techuniversity.edu', department: 'Computer Science' },
    { name: 'Prof. Amit Patel', email: 'amit@techuniversity.edu', department: 'Electronics' },
    { name: 'Dr. Priya Singh', email: 'priya@techuniversity.edu', department: 'Mechanical' },
  ];
  const faculty = await User.insertMany(fData.map(function(f) { return Object.assign({}, f, { password: 'Faculty@123', role: 'faculty', collegeId: college._id, subjects: [], isActive: true }); }));

  const sNames = ['Aarav Gupta','Diya Patel','Arjun Singh','Ananya Sharma','Rohan Verma','Ishita Kumar','Vivaan Reddy','Myra Joshi','Aditya Nair','Sara Khan'];
  const students = [];
  for (let i = 0; i < sNames.length; i++) {
    const s = await User.create({
      name: sNames[i], email: 'student' + (i+1) + '@techuniversity.edu', password: 'Student@123', role: 'student',
      collegeId: college._id, rollNo: 'TECH' + String(i+1).padStart(4,'0'), semester: SEMESTERS[i % SEMESTERS.length],
      department: DEPARTMENTS[i % DEPARTMENTS.length], isActive: true, gender: i % 2 === 0 ? 'male' : 'female',
      enrollmentNo: 'ENR24' + String(i+1).padStart(5,'0'),
      admissionDate: randomDate(new Date('2023-06-01'), new Date('2024-08-01')),
      dateOfBirth: randomDate(new Date('2000-01-01'), new Date('2006-12-31')),
    });
    students.push(s);
  }

  for (let i = 0; i < 2; i++) {
    const p = await User.create({ name: 'Parent ' + (i+1), email: 'parent' + (i+1) + '@example.com', password: 'Parent@123', role: 'parent', collegeId: college._id, children: [students[i]._id], isActive: true });
    students[i].parentId = p._id; await students[i].save();
  }
  console.log('   ' + faculty.length + ' faculty, ' + students.length + ' students');

  // 5. Courses & Subjects
  console.log('5. Creating courses and subjects...');
  const courses = await Course.insertMany([
    { collegeId: college._id, name: 'B.Tech Computer Science', code: 'BTCS', department: 'Computer Science', duration: 4, totalSemesters: 8 },
    { collegeId: college._id, name: 'B.Tech Electronics', code: 'BTEC', department: 'Electronics', duration: 4, totalSemesters: 8 },
  ]);

  const subjects = [];
  const sData = [
    { name: 'Data Structures', code: 'CS201', course: 'BTCS', sem: 3, credits: 4, type: 'theory' },
    { name: 'Algorithms', code: 'CS202', course: 'BTCS', sem: 3, credits: 4, type: 'theory' },
    { name: 'Database Systems', code: 'CS301', course: 'BTCS', sem: 4, credits: 3, type: 'theory' },
    { name: 'Operating Systems', code: 'CS401', course: 'BTCS', sem: 5, credits: 4, type: 'theory' },
    { name: 'Digital Electronics', code: 'EC201', course: 'BTEC', sem: 3, credits: 4, type: 'theory' },
  ];
  for (const sd of sData) {
    const c = courses.find(function(x) { return x.code === sd.course; });
    const f = pick(faculty);
    const sub = await Subject.create({ collegeId: college._id, courseId: c ? c._id : null, name: sd.name, code: sd.code, semester: sd.sem, credits: sd.credits, facultyId: f._id, type: sd.type, isActive: true });
    subjects.push(sub);
    f.subjects.push(sub._id); await f.save();
  }
  console.log('   ' + subjects.length + ' subjects across ' + courses.length + ' courses');

  // 6. Timetable
  console.log('6. Creating timetable...');
  const ttData = subjects.map(function(s) {
    return { collegeId: college._id, subjectId: s._id, facultyId: pick(faculty)._id, courseId: s.courseId, semester: s.semester, dayOfWeek: pick(DAYS), startTime: pick(TIMES), endTime: '11:00', room: 'Room-' + Math.floor(100+Math.random()*200), type: 'lecture', isActive: true };
  });
  await Timetable.insertMany(ttData);
  console.log('   ' + ttData.length + ' timetable slots');

  // 7. Attendance
  console.log('7. Creating attendance records...');
  const attRecords = [];
  for (const st of students) {
    const ss = subjects.filter(function(s) { return s.semester === st.semester; });
    for (const sub of ss.slice(0, 2)) {
      for (let d = 0; d < 10; d++) {
        const date = new Date(); date.setDate(date.getDate() - d*2);
        if (date.getDay() === 0 || date.getDay() === 6) continue;
        attRecords.push({ collegeId: college._id, studentId: st._id, subjectId: sub._id, facultyId: pick(faculty)._id, date: date, status: pick(['present','present','present','absent','late']), source: 'manual' });
      }
    }
  }
  if (attRecords.length > 0) {
    try { await Attendance.insertMany(attRecords, { ordered: false }); } catch (e) { console.log('   (some attendance records skipped)'); }
  }
  console.log('   ' + attRecords.length + ' attendance records');

  // 8. Exams & Results
  console.log('8. Creating exams and results...');
  for (const sub of subjects) {
    const exam = await Exam.create({ collegeId: college._id, subjectId: sub._id, courseId: sub.courseId, semester: sub.semester, name: sub.name + ' - Mid Term', examType: 'midterm', date: randomDate(new Date('2024-09-01'), new Date('2024-11-30')), startTime: '10:00', duration: 180, totalMarks: 50, passingMarks: 20, venue: 'Hall-' + Math.floor(1+Math.random()*5), isPublished: true });
    const es = students.filter(function(st) { return st.semester === sub.semester; });
    const results = es.map(function(st) {
      const marks = Math.floor(Math.random() * 46) + 5;
      const pct = (marks / 50) * 100;
      const grade = pct >= 90 ? 'O' : pct >= 80 ? 'A+' : pct >= 70 ? 'A' : pct >= 60 ? 'B+' : pct >= 50 ? 'B' : pct >= 40 ? 'C' : 'F';
      return { collegeId: college._id, studentId: st._id, examId: exam._id, subjectId: sub._id, marksObtained: marks, totalMarks: 50, percentage: Number(pct.toFixed(2)), grade: grade, gradePoints: grade === 'O' ? 10 : grade === 'A+' ? 9 : grade === 'A' ? 8 : grade === 'B+' ? 7 : grade === 'B' ? 6 : grade === 'C' ? 5 : 0, publishedAt: new Date() };
    });
    if (results.length > 0) { try { await Result.insertMany(results, { ordered: false }); } catch (e) {} }
  }

  // 9. Fees
  console.log('9. Creating fee records...');
  const feeRecords = students.map(function(st) {
    return { collegeId: college._id, studentId: st._id, feeType: 'tuition', amount: 25000, dueDate: new Date('2024-07-15'), paidDate: new Date('2024-07-10'), paidAmount: 25000, status: 'paid', receiptNo: 'RCPT-' + st.rollNo, paymentMethod: 'online', semester: st.semester, academicYear: '2024-2025' };
  });
  if (feeRecords.length > 0) { try { await Fee.insertMany(feeRecords, { ordered: false }); } catch (e) {} }

  // 10. Leaves
  console.log('10. Creating leave records...');
  for (const f of faculty.slice(0, 2)) {
    await Leave.create({ collegeId: college._id, userId: f._id, leaveType: 'casual', startDate: new Date('2024-08-01'), endDate: new Date('2024-08-02'), reason: 'Personal', status: 'approved', approvedBy: ca._id });
  }

  // 11. Library
  console.log('11. Creating library books...');
  try {
    await Book.insertMany([
      { collegeId: college._id, title: 'Introduction to Algorithms', author: 'CLRS', isbn: '978-0262033848', category: 'Computer Science', totalCopies: 10, availableCopies: 8, location: 'CS-Shelf-A1', isActive: true },
      { collegeId: college._id, title: 'Database System Concepts', author: 'Silberschatz', isbn: '978-0073523323', category: 'Computer Science', totalCopies: 8, availableCopies: 6, location: 'CS-Shelf-B2', isActive: true },
    ]);
  } catch (e) {}

  // 12. Notices
  console.log('12. Creating notices...');
  try {
    await Notice.insertMany([
      { collegeId: college._id, title: 'Holiday Notice - Diwali', content: 'College closed Oct 30 to Nov 3.', type: 'holiday', targetRoles: ['student','faculty'], isPinned: true, isActive: true, createdBy: ca._id },
      { collegeId: college._id, title: 'Exam Schedule', content: 'Mid-term exam schedule published.', type: 'exam', targetRoles: ['student'], isActive: true, createdBy: ca._id },
    ]);
  } catch (e) {}

  college.totalStudents = students.length;
  college.totalFaculty = faculty.length;
  await college.save();

  console.log('\n=== Seeding Complete ===');
  console.log('   College: ' + college.name);
  console.log('   Users: ' + (await User.countDocuments()) + ' total');
  console.log('   Subjects: ' + subjects.length);
  console.log('   Attendance: ' + attRecords.length);
  console.log('\nSample Login Credentials:');
  console.log('   Super Admin: ' + saEmail + ' / ' + saPass);
  console.log('   College Admin: admin@techuniversity.edu / Admin@123');
  console.log('   Faculty: rajesh@techuniversity.edu / Faculty@123');
  console.log('   Student: student1@techuniversity.edu / Student@123');
  console.log('   Parent: parent1@example.com / Parent@123\n');
  await mongoose.connection.close();
  process.exit(0);
}

seed().catch(function(err) { console.error('Seeder failed:', err.message); process.exit(1); });
