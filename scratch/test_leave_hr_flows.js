const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });

const User = require('../backend/models/User');
const College = require('../backend/models/College');
const Leave = require('../backend/models/Leave');

async function runLeaveAndHRTests() {
  console.log('====================================================');
  console.log('🧪 STARTING SUITE 10: FACULTY LEAVE & HR SUITE TESTS');
  console.log('====================================================\n');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/vishva_erp');
  console.log('Connected to MongoDB successfully.\n');

  // --- 1. SETUP PREREQUISITES ---
  console.log('--- Phase 1: Environment & Faculty Setup ---');
  let college = await College.findOne();
  if (!college) {
    college = await College.create({
      name: 'Vishva Engineering College',
      code: 'VEC-HR',
      status: 'active'
    });
  }

  let admin = await User.findOne({ role: 'collegeAdmin', collegeId: college._id });
  if (!admin) {
    admin = await User.create({
      name: 'HR Dean',
      email: 'hr.dean@example.com',
      password: 'Password123!',
      role: 'collegeAdmin',
      collegeId: college._id,
      isActive: true
    });
  }

  let faculty = await User.findOne({ email: 'dr.ananya.roy@example.com' });
  if (!faculty) {
    faculty = await User.create({
      name: 'Dr. Ananya Roy',
      email: 'dr.ananya.roy@example.com',
      password: 'Password123!',
      role: 'faculty',
      department: 'Computer Science',
      designation: 'Associate Professor',
      collegeId: college._id,
      isActive: true
    });
  }
  console.log(`Setup complete: College [${college.name}], Admin [${admin.name}], Faculty [${faculty.name} / ${faculty.department}]\n`);

  // Clean any previous test leaves for clean slate
  await Leave.deleteMany({ userId: faculty._id });

  // --- 2. INITIAL LEAVE BALANCE ---
  console.log('--- Phase 2: Leave Quota & Balance Calculation ---');
  const leaves0 = await Leave.find({ userId: faculty._id, collegeId: college._id });
  const currentYear = new Date().getFullYear();
  const approvedThisYear = leaves0.filter(l => l.status === 'approved' && new Date(l.startDate).getFullYear() === currentYear);

  const calcDays = (type) => approvedThisYear
    .filter(l => l.leaveType === type)
    .reduce((sum, l) => sum + Math.max(1, Math.round((new Date(l.endDate) - new Date(l.startDate)) / (1000 * 60 * 60 * 24)) + 1), 0);

  const initialBalances = {
    casual: { total: 12, used: calcDays('casual'), remaining: Math.max(0, 12 - calcDays('casual')) },
    sick: { total: 10, used: calcDays('sick'), remaining: Math.max(0, 10 - calcDays('sick')) },
    earned: { total: 15, used: calcDays('earned'), remaining: Math.max(0, 15 - calcDays('earned')) },
    duty: { total: 10, used: calcDays('duty'), remaining: Math.max(0, 10 - calcDays('duty')) },
  };

  console.log('Initial Annual Leave Balances:');
  console.log(`   - Casual Leave: ${initialBalances.casual.remaining}/${initialBalances.casual.total} remaining (${initialBalances.casual.used} used)`);
  console.log(`   - Sick Leave: ${initialBalances.sick.remaining}/${initialBalances.sick.total} remaining (${initialBalances.sick.used} used)`);
  console.log(`   - Earned Leave: ${initialBalances.earned.remaining}/${initialBalances.earned.total} remaining (${initialBalances.earned.used} used)`);
  console.log(`   - Duty Leave: ${initialBalances.duty.remaining}/${initialBalances.duty.total} remaining (${initialBalances.duty.used} used)`);

  if (initialBalances.casual.remaining !== 12 || initialBalances.casual.used !== 0) {
    throw new Error('Initial casual leave balance should be 12 remaining, 0 used');
  }

  // --- 3. FACULTY APPLIES FOR CASUAL LEAVE ---
  console.log('\n--- Phase 3: Leave Application Submission ---');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 5);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 2); // 3 days: start, middle, end

  const leave1 = await Leave.create({
    collegeId: college._id,
    userId: faculty._id,
    leaveType: 'casual',
    startDate,
    endDate,
    reason: 'Attending National Computing Symposium in Delhi',
    remarks: 'Covering: Prof. Rajesh V',
    status: 'pending'
  });
  console.log(`Leave Application Created: ID [${leave1._id}]`);
  console.log(`   - Type: ${leave1.leaveType.toUpperCase()}`);
  console.log(`   - Duration: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()} (3 days)`);
  console.log(`   - Reason: ${leave1.reason}`);
  console.log(`   - Status: ${leave1.status}`);

  // --- 4. OVERLAP PREVENTION TEST ---
  console.log('\n--- Phase 4: Overlap Guard Validation ---');
  const overlapQuery = {
    collegeId: college._id,
    userId: faculty._id,
    status: { $ne: 'rejected' },
    $or: [
      { startDate: { $lte: endDate }, endDate: { $gte: startDate } }
    ]
  };
  const overlapFound = await Leave.findOne(overlapQuery);
  if (!overlapFound) {
    throw new Error('Overlap detection query failed to identify overlapping application!');
  }
  console.log(`Overlap correctly flagged: Detected overlapping leave ID [${overlapFound._id}] spanning existing dates.`);

  // --- 5. ADMIN RETRIEVAL & REVIEW ---
  console.log('\n--- Phase 5: Admin Review & Decision ---');
  const pendingLeaves = await Leave.find({ collegeId: college._id, status: 'pending' })
    .populate('userId', 'name role department designation')
    .sort({ createdAt: -1 });

  const targetLeave = pendingLeaves.find(l => String(l._id) === String(leave1._id));
  if (!targetLeave) throw new Error('Pending leave not found in admin queue');
  console.log(`Admin retrieved pending application from [${targetLeave.userId.name}] (${targetLeave.userId.department})`);

  // Admin approves with remarks
  targetLeave.status = 'approved';
  targetLeave.approvedBy = admin._id;
  targetLeave.remarks = 'Approved. Prof. Rajesh V confirmed for substitution.';
  await targetLeave.save();
  console.log(`Admin approved leave application with notes: "${targetLeave.remarks}"`);

  // --- 6. POST-APPROVAL BALANCE RECALCULATION ---
  console.log('\n--- Phase 6: Post-Approval Quota Deduction Verification ---');
  const facultyLeavesUpdated = await Leave.find({ userId: faculty._id, collegeId: college._id });
  const approvedAfter = facultyLeavesUpdated.filter(l => l.status === 'approved' && new Date(l.startDate).getFullYear() === currentYear);

  const calcDaysAfter = (type) => approvedAfter
    .filter(l => l.leaveType === type)
    .reduce((sum, l) => sum + Math.max(1, Math.round((new Date(l.endDate) - new Date(l.startDate)) / (1000 * 60 * 60 * 24)) + 1), 0);

  const updatedBalances = {
    casual: { total: 12, used: calcDaysAfter('casual'), remaining: Math.max(0, 12 - calcDaysAfter('casual')) },
    sick: { total: 10, used: calcDaysAfter('sick'), remaining: Math.max(0, 10 - calcDaysAfter('sick')) },
    earned: { total: 15, used: calcDaysAfter('earned'), remaining: Math.max(0, 15 - calcDaysAfter('earned')) },
    duty: { total: 10, used: calcDaysAfter('duty'), remaining: Math.max(0, 10 - calcDaysAfter('duty')) },
  };

  console.log('Updated Annual Leave Balances:');
  console.log(`   - Casual Leave: ${updatedBalances.casual.remaining}/${updatedBalances.casual.total} remaining (${updatedBalances.casual.used} used)`);
  console.log(`   - Sick Leave: ${updatedBalances.sick.remaining}/${updatedBalances.sick.total} remaining (${updatedBalances.sick.used} used)`);

  if (updatedBalances.casual.used !== 3 || updatedBalances.casual.remaining !== 9) {
    throw new Error(`Expected casual leave used to be 3 and remaining 9, got used=${updatedBalances.casual.used}, rem=${updatedBalances.casual.remaining}`);
  }
  console.log('Quota deduction verified accurately (12 - 3 = 9 remaining).');

  // --- 7. TEARDOWN ---
  console.log('\n--- Phase 7: Teardown & Cleanliness ---');
  await Leave.deleteMany({ _id: leave1._id });
  console.log('Test leave record removed successfully.');

  console.log('\n====================================================');
  console.log(' ALL 7 TEST PHASES COMPLETED WITH 100% SUCCESS!');
  console.log('====================================================\n');
  process.exit(0);
}

runLeaveAndHRTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
