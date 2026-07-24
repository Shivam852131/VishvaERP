const { Notification } = require('../models/Communication');
const ParentNotificationPreference = require('../models/ParentNotificationPreference');
const User = require('../models/User');
const pushService = require('./pushNotificationService');
const emailService = require('./emailService');
const whatsappService = require('./whatsappService');

const TEMPLATES = {
  attendance: {
    push: (data) => ({ title: `Attendance Alert - ${data.studentName}`, body: `${data.studentName} was marked ${data.status} on ${data.date}. Current: ${data.percentage}%` }),
    email: (data) => ({
      subject: `Attendance Alert - ${data.studentName}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:${data.status === 'Absent' ? '#FEF2F2' : '#F0FDF4'};border-left:4px solid ${data.status === 'Absent' ? '#EF4444' : '#10B981'};padding:16px;border-radius:8px;margin-bottom:16px">
          <h3 style="margin:0;color:${data.status === 'Absent' ? '#991B1B' : '#065F46'}">Attendance ${data.status === 'Absent' ? 'Absent' : 'Update'}</h3>
        </div>
        <p><strong>Student:</strong> ${data.studentName}</p>
        <p><strong>Date:</strong> ${data.date}</p>
        <p><strong>Status:</strong> ${data.status}</p>
        <p><strong>Subject:</strong> ${data.subject || 'N/A'}</p>
        <p><strong>Current Attendance:</strong> <span style="color:${data.percentage < 75 ? '#EF4444' : '#10B981'};font-weight:bold">${data.percentage}%</span></p>
        ${data.percentage < 75 ? '<p style="color:#DC2626;font-weight:bold">⚠ Below 75% threshold. Action required.</p>' : ''}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
        <p style="color:#64748b;font-size:12px">VishvaERP - Parent Notification</p>
      </div>`,
    }),
    whatsapp: (data) => `📋 *Attendance Alert*\n\nStudent: ${data.studentName}\nDate: ${data.date}\nStatus: ${data.status}\nSubject: ${data.subject || 'N/A'}\nCurrent: ${data.percentage}%${data.percentage < 75 ? '\n\n⚠️ Below 75% threshold!' : ''}\n\n- VishvaERP`,
  },
  fees: {
    push: (data) => ({ title: 'Fee Reminder', body: `Fee of ₹${data.amount} due on ${data.dueDate} for ${data.studentName}` }),
    email: (data) => ({
      subject: `Fee Reminder - ₹${data.amount} Due ${data.dueDate}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:16px;border-radius:8px;margin-bottom:16px">
          <h3 style="margin:0;color:#92400E">Fee Payment Reminder</h3>
        </div>
        <p><strong>Student:</strong> ${data.studentName}</p>
        <p><strong>Fee Type:</strong> ${data.feeType}</p>
        <p><strong>Amount:</strong> ₹${data.amount}</p>
        <p><strong>Due Date:</strong> ${data.dueDate}</p>
        <p><strong>Status:</strong> ${data.status || 'Pending'}</p>
        ${data.overdue ? '<p style="color:#DC2626;font-weight:bold">⚠ Payment overdue. Please pay immediately to avoid late fees.</p>' : ''}
        <p style="margin-top:16px"><a href="${data.paymentUrl || '#'}" style="display:inline-block;padding:12px 24px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Pay Now</a></p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
        <p style="color:#64748b;font-size:12px">VishvaERP - Parent Notification</p>
      </div>`,
    }),
    whatsapp: (data) => `💰 *Fee Reminder*\n\nStudent: ${data.studentName}\nType: ${data.feeType}\nAmount: ₹${data.amount}\nDue: ${data.dueDate}${data.overdue ? '\n\n⚠️ OVERDUE - Pay now!' : ''}\n\n- VishvaERP`,
  },
  exams: {
    push: (data) => ({ title: `Exam ${data.eventType || 'Notice'}`, body: `${data.examName} - ${data.message}` }),
    email: (data) => ({
      subject: `Exam ${data.eventType || 'Notice'} - ${data.examName}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:#EEF2FF;border-left:4px solid #4F46E5;padding:16px;border-radius:8px;margin-bottom:16px">
          <h3 style="margin:0;color:#3730A3">Exam ${data.eventType || 'Notice'}</h3>
        </div>
        <p><strong>Student:</strong> ${data.studentName}</p>
        <p><strong>Exam:</strong> ${data.examName}</p>
        <p><strong>Message:</strong> ${data.message}</p>
        ${data.startDate ? `<p><strong>Date:</strong> ${data.startDate}${data.endDate ? ` to ${data.endDate}` : ''}</p>` : ''}
        ${data.schedule ? `<p><strong>Schedule:</strong> ${data.schedule}</p>` : ''}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
        <p style="color:#64748b;font-size:12px">VishvaERP - Parent Notification</p>
      </div>`,
    }),
    whatsapp: (data) => `📝 *Exam Notice*\n\nStudent: ${data.studentName}\nExam: ${data.examName}\n${data.message}${data.startDate ? `\nDate: ${data.startDate}` : ''}\n\n- VishvaERP`,
  },
  results: {
    push: (data) => ({ title: 'Results Published', body: `${data.studentName}'s ${data.examName} results are out. SGPA: ${data.sgpa || 'N/A'}` }),
    email: (data) => ({
      subject: `Results Published - ${data.examName}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:#D1FAE5;border-left:4px solid #10B981;padding:16px;border-radius:8px;margin-bottom:16px">
          <h3 style="margin:0;color:#065F46">Results Published</h3>
        </div>
        <p><strong>Student:</strong> ${data.studentName}</p>
        <p><strong>Exam:</strong> ${data.examName}</p>
        ${data.sgpa ? `<p><strong>SGPA:</strong> <span style="font-size:20px;font-weight:bold;color:#4F46E5">${data.sgpa}</span></p>` : ''}
        ${data.cgpa ? `<p><strong>CGPA:</strong> ${data.cgpa}</p>` : ''}
        ${data.percentage ? `<p><strong>Percentage:</strong> ${data.percentage}%</p>` : ''}
        ${data.resultUrl ? `<p><a href="${data.resultUrl}" style="display:inline-block;padding:12px 24px;background:#10B981;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">View Results</a></p>` : ''}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
        <p style="color:#64748b;font-size:12px">VishvaERP - Parent Notification</p>
      </div>`,
    }),
    whatsapp: (data) => `🏆 *Results Published*\n\nStudent: ${data.studentName}\nExam: ${data.examName}${data.sgpa ? `\nSGPA: ${data.sgpa}` : ''}${data.cgpa ? `\nCGPA: ${data.cgpa}` : ''}\n\n- VishvaERP`,
  },
  assignments: {
    push: (data) => ({ title: `Assignment ${data.eventType || 'Update'}`, body: `${data.title} - Due: ${data.dueDate}` }),
    email: (data) => ({
      subject: `Assignment ${data.eventType || 'Update'} - ${data.title}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:16px;border-radius:8px;margin-bottom:16px">
          <h3 style="margin:0;color:#92400E">Assignment ${data.eventType || 'Update'}</h3>
        </div>
        <p><strong>Student:</strong> ${data.studentName}</p>
        <p><strong>Title:</strong> ${data.title}</p>
        <p><strong>Subject:</strong> ${data.subject}</p>
        <p><strong>Due Date:</strong> ${data.dueDate}</p>
        ${data.description ? `<p><strong>Description:</strong> ${data.description}</p>` : ''}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
        <p style="color:#64748b;font-size:12px">VishvaERP - Parent Notification</p>
      </div>`,
    }),
    whatsapp: (data) => `📚 *Assignment ${data.eventType || 'Update'}*\n\nStudent: ${data.studentName}\nTitle: ${data.title}\nSubject: ${data.subject}\nDue: ${data.dueDate}\n\n- VishvaERP`,
  },
  notices: {
    push: (data) => ({ title: data.title || 'New Notice', body: data.message }),
    email: (data) => ({
      subject: data.title || 'College Notice',
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:#F1F5F9;border-left:4px solid #64748B;padding:16px;border-radius:8px;margin-bottom:16px">
          <h3 style="margin:0;color:#1E293B">${data.title || 'College Notice'}</h3>
        </div>
        <p><strong>Student:</strong> ${data.studentName}</p>
        <p>${data.message}</p>
        ${data.priority ? `<p><strong>Priority:</strong> ${data.priority}</p>` : ''}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
        <p style="color:#64748b;font-size:12px">VishvaERP - Parent Notification</p>
      </div>`,
    }),
    whatsapp: (data) => `📢 *${data.title || 'College Notice'}*\n\n${data.message}\n\n- VishvaERP`,
  },
  liveClasses: {
    push: (data) => ({ title: 'Live Class', body: `${data.subject} starting at ${data.startTime}` }),
    email: (data) => ({
      subject: `Live Class - ${data.subject}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:#DBEAFE;border-left:4px solid #3B82F6;padding:16px;border-radius:8px;margin-bottom:16px">
          <h3 style="margin:0;color:#1E40AF">Live Class Starting</h3>
        </div>
        <p><strong>Student:</strong> ${data.studentName}</p>
        <p><strong>Subject:</strong> ${data.subject}</p>
        <p><strong>Teacher:</strong> ${data.teacher}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        ${data.meetingUrl ? `<p><a href="${data.meetingUrl}" style="display:inline-block;padding:12px 24px;background:#3B82F6;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Join Class</a></p>` : ''}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
        <p style="color:#64748b;font-size:12px">VishvaERP - Parent Notification</p>
      </div>`,
    }),
    whatsapp: (data) => `🎥 *Live Class*\n\nStudent: ${data.studentName}\nSubject: ${data.subject}\nTeacher: ${data.teacher}\nTime: ${data.startTime}${data.meetingUrl ? `\nJoin: ${data.meetingUrl}` : ''}\n\n- VishvaERP`,
  },
  messages: {
    push: (data) => ({ title: `Message from ${data.senderName}`, body: data.preview || 'You have a new message' }),
    email: null,
    whatsapp: null,
  },
  progressReport: {
    push: (data) => ({ title: 'Progress Report', body: `Weekly report for ${data.studentName} is ready` }),
    email: (data) => ({
      subject: `Weekly Progress Report - ${data.studentName}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
        <div style="background:#FDF4FF;border-left:4px solid #A855F7;padding:16px;border-radius:8px;margin-bottom:16px">
          <h3 style="margin:0;color:#7E22CE">Weekly Progress Report</h3>
        </div>
        <p><strong>Student:</strong> ${data.studentName}</p>
        <p><strong>Week:</strong> ${data.week}</p>
        <p><strong>Attendance:</strong> ${data.attendance}%</p>
        <p><strong>Avg Score:</strong> ${data.avgScore || 'N/A'}</p>
        <p><strong>Assignments Done:</strong> ${data.assignmentsDone}/${data.assignmentsTotal}</p>
        ${data.remarks ? `<p><strong>Remarks:</strong> ${data.remarks}</p>` : ''}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
        <p style="color:#64748b;font-size:12px">VishvaERP - Parent Notification</p>
      </div>`,
    }),
    whatsapp: (data) => `📊 *Weekly Progress Report*\n\nStudent: ${data.studentName}\nWeek: ${data.week}\nAttendance: ${data.attendance}%\nAvg Score: ${data.avgScore || 'N/A'}\nAssignments: ${data.assignmentsDone}/${data.assignmentsTotal}${data.remarks ? `\nRemarks: ${data.remarks}` : ''}\n\n- VishvaERP`,
  },
};

function isQuietHours(prefs) {
  if (!prefs?.quietHours?.enabled) return false;
  const now = new Date();
  const tz = prefs.quietHours.timezone || 'Asia/Kolkata';
  const options = { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false };
  const currentTime = new Intl.DateTimeFormat('en-GB', options).format(now);
  const [startH, startM] = (prefs.quietHours.start || '22:00').split(':').map(Number);
  const [endH, endM] = (prefs.quietHours.end || '07:00').split(':').map(Number);
  const [curH, curM] = currentTime.split(':').map(Number);
  const curMin = curH * 60 + curM;
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  if (startMin > endMin) {
    return curMin >= startMin || curMin < endMin;
  }
  return curMin >= startMin && curMin < endMin;
}

async function getPreferences(parentId) {
  let prefs = await ParentNotificationPreference.findOne({ userId: parentId });
  if (!prefs) {
    const parent = await User.findById(parentId).select('collegeId');
    if (parent) {
      prefs = await ParentNotificationPreference.create({
        userId: parentId,
        collegeId: parent.collegeId,
      });
    }
  }
  return prefs;
}

async function sendParentNotification(parentId, eventType, data, options = {}) {
  const prefs = await getPreferences(parentId);
  if (!prefs) return { success: false, message: 'Parent preferences not found' };

  const quiet = isQuietHours(prefs);
  const pref = prefs.preferences[eventType] || {};
  const template = TEMPLATES[eventType];
  if (!template) return { success: false, message: `Unknown event type: ${eventType}` };

  const results = { inApp: null, push: null, email: null, whatsapp: null };
  const parent = await User.findById(parentId).select('name email phone');

  // In-app notification (always)
  const inAppPayload = template.push ? template.push(data) : { title: eventType, body: JSON.stringify(data) };
  const notification = await Notification.create({
    userId: parentId,
    collegeId: prefs.collegeId,
    title: inAppPayload.title,
    body: inAppPayload.body,
    type: eventType === 'fees' ? 'fee' : eventType === 'attendance' ? 'attendance' : eventType === 'results' ? 'exam' : eventType === 'assignments' ? 'assignment' : 'info',
    link: options.link || '/',
  });
  results.inApp = { success: true, notificationId: notification._id };

  // Push notification
  if (prefs.channels.push && pref.push && !quiet) {
    const pushPayload = template.push(data);
    results.push = await pushService.sendToUser(parentId, { ...pushPayload, url: options.link || '/' });
  } else {
    results.push = { skipped: true, reason: quiet ? 'quiet hours' : 'disabled' };
  }

  // Email notification
  if (prefs.channels.email && pref.email && parent?.email) {
    const emailPayload = template.email(data);
    if (emailPayload) {
      const emails = prefs.emailAddresses.length > 0 ? prefs.emailAddresses : [parent.email];
      results.email = await emailService.sendMail({ to: emails.join(','), ...emailPayload });
    }
  } else {
    results.email = { skipped: true, reason: 'disabled' };
  }

  // WhatsApp notification
  if (prefs.channels.whatsapp && pref.whatsapp && (prefs.whatsappPhone || parent?.phone)) {
    const whatsappText = template.whatsapp(data);
    if (whatsappText) {
      const phone = prefs.whatsappPhone || parent.phone;
      results.whatsapp = await whatsappService.sendWhatsApp(phone, whatsappText);
    }
  } else {
    results.whatsapp = { skipped: true, reason: 'disabled' };
  }

  // Socket.IO real-time
  if (options.io) {
    options.io.to(`user:${parentId}`).emit('notification', notification);
  }

  return { success: true, results };
}

async function sendBulkParentNotifications(parentIds, eventType, data, options = {}) {
  const results = await Promise.allSettled(
    parentIds.map((id) => sendParentNotification(id, eventType, data, options))
  );
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
  return { success: true, sent, failed: results.length - sent, total: results.length };
}

async function updatePreferences(parentId, updates) {
  const prefs = await ParentNotificationPreference.findOneAndUpdate(
    { userId: parentId },
    { $set: updates },
    { new: true, upsert: true }
  );
  return prefs;
}

module.exports = {
  sendParentNotification,
  sendBulkParentNotifications,
  getPreferences,
  updatePreferences,
  TEMPLATES,
  isQuietHours,
};
