const cron = require('node-cron');
const User = require('../models/User');
const { sendBulkParentNotifications } = require('./parentNotificationService');

let scheduledJobs = [];

function startScheduledJobs() {
  stopScheduledJobs();

  // Daily fee reminders at 9:00 AM IST
  scheduledJobs.push(cron.schedule('0 9 * * *', async () => {
    console.log('[Scheduler] Running daily fee reminders...');
    try {
      await sendFeeReminders();
    } catch (err) {
      console.error('[Scheduler] Fee reminder error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' }));

  // Weekly attendance summary every Monday at 8:00 AM IST
  scheduledJobs.push(cron.schedule('0 8 * * 1', async () => {
    console.log('[Scheduler] Running weekly attendance summary...');
    try {
      await sendAttendanceSummary();
    } catch (err) {
      console.error('[Scheduler] Attendance summary error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' }));

  // Daily assignment reminders at 4:00 PM IST
  scheduledJobs.push(cron.schedule('0 16 * * *', async () => {
    console.log('[Scheduler] Running assignment reminders...');
    try {
      await sendAssignmentReminders();
    } catch (err) {
      console.error('[Scheduler] Assignment reminder error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' }));

  console.log('[Scheduler] Parent notification jobs started (fee: 9AM daily, attendance: Mon 8AM, assignments: 4PM daily)');
}

function stopScheduledJobs() {
  scheduledJobs.forEach((job) => job.stop());
  scheduledJobs = [];
}

async function sendFeeReminders() {
  try {
    const Fee = require('../models/Fee');
    const now = new Date();
    const reminderDate = new Date(now);
    reminderDate.setDate(reminderDate.getDate() + 7);

    const pendingFees = await Fee.find({
      status: { $in: ['pending', 'partial'] },
      dueDate: { $lte: reminderDate, $gte: now },
    }).populate('studentId', 'name parentId collegeId');

    const parentNotifs = {};
    for (const fee of pendingFees) {
      if (!fee.studentId?.parentId) continue;
      const parentId = String(fee.studentId.parentId);
      if (!parentNotifs[parentId]) parentNotifs[parentId] = [];
      parentNotifs[parentId].push({
        studentName: fee.studentId.name,
        feeType: fee.feeType || fee.type || 'Tuition Fee',
        amount: fee.amount || fee.totalAmount,
        dueDate: fee.dueDate?.toLocaleDateString() || 'N/A',
        status: fee.status,
        overdue: new Date(fee.dueDate) < now,
        paymentUrl: '/pages/parent/fees.html',
      });
    }

    let sent = 0;
    for (const [parentId, fees] of Object.entries(parentNotifs)) {
      for (const fee of fees) {
        await sendBulkParentNotifications([parentId], 'fees', fee, { link: '/pages/parent/fees.html' });
        sent++;
      }
    }
    console.log(`[Scheduler] Sent ${sent} fee reminders to ${Object.keys(parentNotifs).length} parents`);
  } catch (err) {
    console.error('[Scheduler] sendFeeReminders error:', err.message);
  }
}

async function sendAttendanceSummary() {
  try {
    const Attendance = require('../models/Attendance');
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const students = await User.find({ role: 'student', isActive: true }).select('name parentId collegeId');
    const parentNotifs = {};

    for (const student of students) {
      if (!student.parentId) continue;
      const records = await Attendance.find({
        studentId: student._id,
        date: { $gte: weekAgo, $lte: now },
      });

      if (records.length === 0) continue;

      const present = records.filter((r) => r.status === 'present').length;
      const total = records.length;
      const percentage = Math.round((present / total) * 100);

      const parentId = String(student.parentId);
      parentNotifs[parentId] = {
        studentName: student.name,
        attendance: percentage,
        week: `${weekAgo.toLocaleDateString()} - ${now.toLocaleDateString()}`,
        avgScore: null,
        assignmentsDone: 0,
        assignmentsTotal: 0,
        remarks: percentage < 75 ? 'Attendance below 75% threshold' : null,
      };
    }

    let sent = 0;
    for (const [parentId, data] of Object.entries(parentNotifs)) {
      await sendBulkParentNotifications([parentId], 'progressReport', data, { link: '/pages/parent/attendance.html' });
      sent++;
    }
    console.log(`[Scheduler] Sent ${sent} attendance summaries`);
  } catch (err) {
    console.error('[Scheduler] sendAttendanceSummary error:', err.message);
  }
}

async function sendAssignmentReminders() {
  try {
    const Assignment = require('../models/Assignment');
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dueSoon = await Assignment.find({
      dueDate: { $lte: tomorrow, $gte: now },
    }).populate('courseId', 'name')
      .populate('assignedTo', 'name parentId');

    const parentNotifs = {};
    for (const assignment of dueSoon) {
      if (!assignment.assignedTo?.parentId) continue;
      const parentId = String(assignment.assignedTo.parentId);
      if (!parentNotifs[parentId]) parentNotifs[parentId] = [];

      parentNotifs[parentId].push({
        studentName: assignment.assignedTo.name,
        title: assignment.title,
        subject: assignment.courseId?.name || 'N/A',
        dueDate: assignment.dueDate?.toLocaleDateString() || 'N/A',
        description: assignment.description?.slice(0, 200) || '',
        eventType: 'due soon',
      });
    }

    let sent = 0;
    for (const [parentId, assignments] of Object.entries(parentNotifs)) {
      for (const assignment of assignments) {
        await sendBulkParentNotifications([parentId], 'assignments', assignment, { link: '/pages/student/assignments.html' });
        sent++;
      }
    }
    console.log(`[Scheduler] Sent ${sent} assignment reminders`);
  } catch (err) {
    console.error('[Scheduler] sendAssignmentReminders error:', err.message);
  }
}

module.exports = { startScheduledJobs, stopScheduledJobs, sendFeeReminders, sendAttendanceSummary, sendAssignmentReminders };
