const asyncHandler = require('../middleware/asyncHandler');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Result = require('../models/Result');
const Fee = require('../models/Fee');
const { PlacementJob, PlacementApplication, PlacementCompany } = require('../models/Placement');
const StudentProfile = require('../models/StudentProfile');
const { CampusSensor, SensorReading } = require('../models/CampusSensor');
const CampusResource = require('../models/CampusResource');
const { EnergyLog, SustainabilityGoal } = require('../models/EnergyLog');
const { SkillAssessment, AssessmentAttempt } = require('../models/SkillAssessment');
const { askAI } = require('../services/aiService');

const getCampusHealth = asyncHandler(async (req, res) => {
  const cid = req.user.collegeId;
  const now = new Date();
  const dayAgo = new Date(now - 24*60*60*1000);
  const weekAgo = new Date(now - 7*24*60*60*1000);

  const [studentCount, facultyCount, activeSensors, alertsToday, pendingFees, totalFees,
    activeJobs, applications, totalApplications, resources, energyToday, sensorAlerts,
    attendanceToday, results, profiles, assessments] = await Promise.all([
    User.countDocuments({ collegeId: cid, role: 'student', isActive: true }),
    User.countDocuments({ collegeId: cid, role: 'faculty', isActive: true }),
    CampusSensor.countDocuments({ collegeId: cid, status: 'active', isActive: true }),
    SensorReading.countDocuments({ collegeId: cid, isAlert: true, timestamp: { $gte: dayAgo } }),
    Fee.countDocuments({ collegeId: cid, status: { $in: ['pending', 'overdue', 'partial'] } }),
    Fee.countDocuments({ collegeId: cid }),
    PlacementJob.countDocuments({ collegeId: cid, status: 'active' }),
    PlacementApplication.countDocuments({ collegeId: cid, createdAt: { $gte: weekAgo } }),
    PlacementApplication.countDocuments({ collegeId: cid }),
    CampusResource.countDocuments({ collegeId: cid, isActive: true }),
    EnergyLog.aggregate([{ $match: { collegeId: cid, date: { $gte: dayAgo } } }, { $group: { _id: null, total: { $sum: '$cost' } } }]),
    SensorReading.countDocuments({ collegeId: cid, isAlert: true, timestamp: { $gte: weekAgo } }),
    Attendance.countDocuments({ collegeId: cid, date: { $gte: dayAgo } }),
    Result.countDocuments({ collegeId: cid }),
    StudentProfile.countDocuments({ collegeId: cid }),
    SkillAssessment.countDocuments({ collegeId: cid, isPublished: true, isActive: true }),
  ]);

  const feeCollection = totalFees > 0 ? await Fee.aggregate([
    { $match: { collegeId: cid, status: { $in: ['paid', 'partial'] } } },
    { $group: { _id: null, collected: { $sum: '$paidAmount' }, total: { $sum: '$amount' } } },
  ]) : [];
  const collected = feeCollection[0]?.collected || 0;
  const totalDue = feeCollection[0]?.total || 0;

  const selectedApps = await PlacementApplication.countDocuments({ collegeId: cid, status: { $in: ['selected', 'offered', 'accepted'] } });
  const selectionRate = totalApplications > 0 ? Math.round((selectedApps / totalApplications) * 100) : 0;

  const attendanceTodayCount = await Attendance.countDocuments({ collegeId: cid, date: { $gte: dayAgo }, status: 'present' });
  const attendanceRate = attendanceToday > 0 ? Math.round((attendanceTodayCount / attendanceToday) * 100) : 0;

  const avgReadiness = profiles > 0 ? await StudentProfile.aggregate([
    { $match: { collegeId: cid } },
    { $group: { _id: null, avg: { $avg: '$careerReadinessScore' } } },
  ]) : [];
  const readinessScore = Math.round(avgReadiness[0]?.avg || 0);

  const energyCost = energyToday[0]?.total || 0;

  const healthScore = Math.min(100, Math.round(
    (attendanceRate * 0.25) +
    (Math.max(0, 100 - alertsToday * 5) * 0.2) +
    (selectionRate * 0.2) +
    (readinessScore * 0.15) +
    (Math.min(100, (1 - pendingFees / Math.max(totalFees, 1)) * 100) * 0.2)
  ));

  res.json({
    success: true,
    health: {
      score: healthScore,
      grade: healthScore >= 80 ? 'A' : healthScore >= 60 ? 'B' : healthScore >= 40 ? 'C' : 'D',
      metrics: {
        students: studentCount,
        faculty: facultyCount,
        activeSensors,
        alertsToday,
        sensorAlertsWeek: sensorAlerts,
        pendingFees,
        feeCollectionRate: totalFees > 0 ? Math.round((1 - pendingFees/totalFees)*100) : 100,
        collectedAmount: collected,
        activeJobs,
        weeklyApplications: applications,
        totalApplications,
        selectionRate,
        resources,
        attendanceRate,
        readinessScore,
        energyCostToday: energyCost,
        assessments,
        profileCompletion: studentCount > 0 ? Math.round((profiles/studentCount)*100) : 0,
      },
    },
  });
});

const getAtRiskStudents = asyncHandler(async (req, res) => {
  const cid = req.user.collegeId;

  const students = await User.find({ collegeId: cid, role: 'student', isActive: true })
    .select('name rollNo department semester email')
    .limit(200);

  const studentIds = students.map(s => s._id);

  const [attendanceData, resultData, feeData, profileData] = await Promise.all([
    Attendance.aggregate([
      { $match: { collegeId: cid, studentId: { $in: studentIds } } },
      { $group: { _id: '$studentId', total: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } } } },
      { $project: { attendanceRate: { $cond: [{ $gt: ['$total', 0] }, { $round: [{ $multiply: [{ $divide: ['$present', '$total'] }, 100] }, 0] }, 100] } } },
    ]),
    Result.aggregate([
      { $match: { collegeId: cid, studentId: { $in: studentIds } } },
      { $group: { _id: '$studentId', avgPct: { $avg: '$percentage' }, failCount: { $sum: { $cond: [{ $eq: ['$status', 'fail'] }, 1, 0] } }, totalExams: { $sum: 1 } } },
    ]),
    Fee.aggregate([
      { $match: { collegeId: cid, studentId: { $in: studentIds }, status: { $in: ['pending', 'overdue', 'partial'] } } },
      { $group: { _id: '$studentId', pendingAmount: { $sum: { $subtract: ['$amount', '$paidAmount'] } }, overdueCount: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } } } },
    ]),
    StudentProfile.aggregate([
      { $match: { collegeId: cid, studentId: { $in: studentIds } } },
      { $project: { readiness: '$careerReadinessScore', skillCount: { $size: { $ifNull: ['$skills', []] } }, hasResume: { $cond: ['$resumeUrl', true, false] } } },
    ]),
  ]);

  const attMap = {}; attendanceData.forEach(a => { attMap[a._id.toString()] = a.attendanceRate; });
  const resMap = {}; resultData.forEach(r => { resMap[r._id.toString()] = r; });
  const feeMap = {}; feeData.forEach(f => { feeMap[f._id.toString()] = f; });
  const proMap = {}; profileData.forEach(p => { proMap[p._id.toString()] = p; });

  const atRisk = students.map(s => {
    const sid = s._id.toString();
    const att = attMap[sid] ?? 100;
    const res = resMap[sid] || { avgPct: 80, failCount: 0, totalExams: 0 };
    const fee = feeMap[sid] || { pendingAmount: 0, overdueCount: 0 };
    const pro = proMap[sid] || { readiness: 0, skillCount: 0, hasResume: false };

    let riskScore = 0;
    const riskFactors = [];

    if (att < 75) { riskScore += 30; riskFactors.push(`Low attendance: ${att}%`); }
    else if (att < 85) { riskScore += 10; riskFactors.push(`Attendance below target: ${att}%`); }

    if (res.failCount > 0) { riskScore += 25 * res.failCount; riskFactors.push(`${res.failCount} failed exam(s)`); }
    if (res.avgPct < 50) { riskScore += 20; riskFactors.push(`Low average: ${Math.round(res.avgPct)}%`); }

    if (fee.overdueCount > 0) { riskScore += 15 * fee.overdueCount; riskFactors.push(`${fee.overdueCount} overdue fee(s)`); }
    if (fee.pendingAmount > 50000) { riskScore += 10; riskFactors.push(`High pending fee: ₹${fee.pendingAmount.toLocaleString()}`); }

    if (pro.readiness < 30) { riskScore += 10; riskFactors.push('Low career readiness'); }
    if (!pro.hasResume) { riskScore += 5; riskFactors.push('No resume uploaded'); }

    return {
      student: { _id: s._id, name: s.name, rollNo: s.rollNo, department: s.department, semester: s.semester },
      riskScore: Math.min(100, riskScore),
      riskLevel: riskScore >= 60 ? 'high' : riskScore >= 30 ? 'medium' : 'low',
      riskFactors,
      attendanceRate: att,
      avgMarks: Math.round(res.avgPct || 0),
      failCount: res.failCount || 0,
      pendingFee: fee.pendingAmount || 0,
      careerReadiness: pro.readiness || 0,
    };
  });

  atRisk.sort((a, b) => b.riskScore - a.riskScore);

  res.json({ success: true, atRisk: atRisk.slice(0, 50), totalStudents: students.length });
});

const getModuleAnalytics = asyncHandler(async (req, res) => {
  const cid = req.user.collegeId;
  const { module } = req.query;

  const analytics = {};

  if (!module || module === 'attendance') {
    const monthly = await Attendance.aggregate([
      { $match: { collegeId: cid, date: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, total: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]);
    analytics.attendance = {
      daily: monthly.map(m => ({ date: m._id, rate: m.total > 0 ? Math.round((m.present/m.total)*100) : 0 })),
      overall: monthly.length > 0 ? Math.round(monthly.reduce((s,m) => s + (m.total > 0 ? m.present/m.total : 0), 0) / monthly.length * 100) : 0,
    };
  }

  if (!module || module === 'academics') {
    const byDept = await Result.aggregate([
      { $match: { collegeId: cid } },
      { $lookup: { from: 'users', localField: 'studentId', foreignField: '_id', as: 'student' } },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$student.department', avg: { $avg: '$percentage' }, pass: { $sum: { $cond: [{ $eq: ['$status', 'pass'] }, 1, 0] } }, total: { $sum: 1 } } },
    ]);
    analytics.academics = {
      byDepartment: byDept.map(d => ({ department: d._id || 'N/A', avgMarks: Math.round(d.avg || 0), passRate: d.total > 0 ? Math.round((d.pass/d.total)*100) : 0, totalResults: d.total })),
    };
  }

  if (!module || module === 'finance') {
    const byType = await Fee.aggregate([
      { $match: { collegeId: cid } },
      { $group: { _id: '$feeType', total: { $sum: '$amount' }, collected: { $sum: '$paidAmount' }, pending: { $sum: { $subtract: ['$amount', '$paidAmount'] } }, count: { $sum: 1 } } },
    ]);
    const byMonth = await Fee.aggregate([
      { $match: { collegeId: cid, createdAt: { $gte: new Date(Date.now() - 6*30*24*60*60*1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, collected: { $sum: '$paidAmount' }, target: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]);
    analytics.finance = {
      byType: byType.map(t => ({ type: t._id, total: t.total, collected: t.collected, pending: t.pending, collectionRate: t.total > 0 ? Math.round((t.collected/t.total)*100) : 0 })),
      monthly: byMonth.map(m => ({ month: m._id, collected: m.collected, target: m.target })),
    };
  }

  if (!module || module === 'placements') {
    const byStatus = await PlacementApplication.aggregate([
      { $match: { collegeId: cid } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const topCompanies = await PlacementApplication.aggregate([
      { $match: { collegeId: cid } },
      { $lookup: { from: 'placementjobs', localField: 'jobId', foreignField: '_id', as: 'job' } },
      { $unwind: { path: '$job', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'placementcompanies', localField: 'job.companyId', foreignField: '_id', as: 'company' } },
      { $unwind: { path: '$company', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$company.name', applications: { $sum: 1 }, selected: { $sum: { $cond: [{ $in: ['$status', ['selected','offered','accepted']] }, 1, 0] } } } },
      { $sort: { applications: -1 } },
      { $limit: 10 },
    ]);
    analytics.placements = {
      byStatus: Object.fromEntries(byStatus.map(s => [s._id, s.count])),
      topCompanies: topCompanies.map(c => ({ name: c._id || 'Unknown', applications: c.applications, selected: c.selected, rate: c.applications > 0 ? Math.round((c.selected/c.applications)*100) : 0 })),
    };
  }

  if (!module || module === 'campus') {
    const sensorAlerts = await SensorReading.aggregate([
      { $match: { collegeId: cid, isAlert: true, timestamp: { $gte: new Date(Date.now() - 7*24*60*60*1000) } } },
      { $lookup: { from: 'campussensors', localField: 'sensorId', foreignField: '_id', as: 'sensor' } },
      { $unwind: { path: '$sensor', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { building: '$sensor.building', type: '$sensor.type' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const energyByType = await EnergyLog.aggregate([
      { $match: { collegeId: cid, date: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
      { $group: { _id: '$type', totalCost: { $sum: '$cost' }, totalReading: { $sum: '$reading' }, count: { $sum: 1 } } },
    ]);
    analytics.campus = {
      sensorAlertsByBuilding: sensorAlerts.map(a => ({ building: a._id?.building || 'Unknown', type: a._id?.type || 'unknown', count: a.count })),
      energyByType: energyByType.map(e => ({ type: e._id, cost: e.totalCost, reading: e.totalReading, entries: e.count })),
    };
  }

  if (!module || module === 'skills') {
    const skillDist = await StudentProfile.aggregate([
      { $match: { collegeId: cid } },
      { $unwind: { path: '$skills', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$skills.name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);
    const readinessDist = await StudentProfile.aggregate([
      { $match: { collegeId: cid } },
      { $group: {
        _id: { $switch: { branches: [
          { case: { $gte: ['$careerReadinessScore', 80] }, then: 'excellent' },
          { case: { $gte: ['$careerReadinessScore', 60] }, then: 'good' },
          { case: { $gte: ['$careerReadinessScore', 40] }, then: 'average' },
        ], default: 'needs_improvement' } },
        count: { $sum: 1 },
      }},
    ]);
    analytics.skills = {
      topSkills: skillDist.map(s => ({ name: s._id || 'Unknown', count: s.count })),
      readinessDistribution: Object.fromEntries(readinessDist.map(r => [r._id, r.count])),
    };
  }

  res.json({ success: true, analytics });
});

const getTrends = asyncHandler(async (req, res) => {
  const cid = req.user.collegeId;
  const { period = '30d' } = req.query;
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [attendance, fees, applications, sensors] = await Promise.all([
    Attendance.aggregate([
      { $match: { collegeId: cid, date: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, total: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    Fee.aggregate([
      { $match: { collegeId: cid, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, amount: { $sum: '$amount' }, collected: { $sum: '$paidAmount' } } },
      { $sort: { _id: 1 } },
    ]),
    PlacementApplication.aggregate([
      { $match: { collegeId: cid, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 }, selected: { $sum: { $cond: [{ $in: ['$status', ['selected','offered','accepted']] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    SensorReading.aggregate([
      { $match: { collegeId: cid, timestamp: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, readings: { $sum: 1 }, alerts: { $sum: { $cond: ['$isAlert', 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({
    success: true,
    trends: {
      period,
      attendance: attendance.map(a => ({ date: a._id, rate: a.total > 0 ? Math.round(a.present/a.total*100) : 0 })),
      fees: fees.map(f => ({ date: f._id, amount: f.amount, collected: f.collected })),
      applications: applications.map(a => ({ date: a._id, count: a.count, selected: a.selected })),
      sensors: sensors.map(s => ({ date: s._id, readings: s.readings, alerts: s.alerts })),
    },
  });
});

const aiQuery = asyncHandler(async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false, message: 'Query is required' });

  const cid = req.user.collegeId;

  const [students, faculty, attendance, results, fees, jobs, applications, sensors, resources, energy, profiles] = await Promise.all([
    User.countDocuments({ collegeId: cid, role: 'student', isActive: true }),
    User.countDocuments({ collegeId: cid, role: 'faculty', isActive: true }),
    Attendance.aggregate([
      { $match: { collegeId: cid, date: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
      { $group: { _id: null, total: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } } } },
    ]),
    Result.aggregate([
      { $match: { collegeId: cid } },
      { $group: { _id: null, avg: { $avg: '$percentage' }, pass: { $sum: { $cond: [{ $eq: ['$status', 'pass'] }, 1, 0] } }, total: { $sum: 1 } } },
    ]),
    Fee.aggregate([
      { $match: { collegeId: cid } },
      { $group: { _id: null, total: { $sum: '$amount' }, collected: { $sum: '$paidAmount' }, pending: { $sum: { $cond: [{ $in: ['$status', ['pending','overdue']] }, 1, 0] } } } },
    ]),
    PlacementJob.countDocuments({ collegeId: cid, status: 'active' }),
    PlacementApplication.aggregate([
      { $match: { collegeId: cid } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    CampusSensor.countDocuments({ collegeId: cid, isActive: true }),
    CampusResource.countDocuments({ collegeId: cid, isActive: true }),
    EnergyLog.aggregate([
      { $match: { collegeId: cid, date: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
      { $group: { _id: '$type', cost: { $sum: '$cost' } } },
    ]),
    StudentProfile.aggregate([
      { $match: { collegeId: cid } },
      { $group: { _id: null, avgReadiness: { $avg: '$careerReadinessScore' }, withResume: { $sum: { $cond: ['$resumeUrl', 1, 0] } }, total: { $sum: 1 } } },
    ]),
  ]);

  const att = attendance[0] || { total: 0, present: 0 };
  const res_ = results[0] || { avg: 0, pass: 0, total: 0 };
  const fee = fees[0] || { total: 0, collected: 0, pending: 0 };
  const prof = profiles[0] || { avgReadiness: 0, withResume: 0, total: 0 };
  const appStatus = Object.fromEntries((applications || []).map(a => [a._id, a.count]));
  const totalApps = Object.values(appStatus).reduce((s,v) => s+v, 0);
  const selectedApps = (appStatus.selected||0) + (appStatus.offered||0) + (appStatus.accepted||0);

  const campusData = `
CAMPUS DATA SUMMARY:
- Students: ${students}, Faculty: ${faculty}
- Attendance (30d): ${att.total} records, ${att.total>0?Math.round(att.present/att.total*100):0}% present rate
- Results: ${res_.total} results, ${Math.round(res_.avg||0)}% avg, ${res_.total>0?Math.round(res_.pass/res_.total*100):0}% pass rate
- Fees: ₹${(fee.total||0).toLocaleString()} total, ₹${(fee.collected||0).toLocaleString()} collected, ${fee.pending} pending
- Placements: ${jobs} active jobs, ${totalApps} applications, ${selectedApps} selected (${totalApps>0?Math.round(selectedApps/totalApps*100):0}% rate)
- IoT: ${sensors} sensors, ${resources} resources
- Energy (30d): ${(energy||[]).map(e=>`${e._id}: ₹${Math.round(e.cost).toLocaleString()}`).join(', ')||'No data'}
- Career: Avg readiness ${Math.round(prof.avgReadiness||0)}/100, ${prof.total>0?Math.round(prof.withResume/prof.total*100):0}% have resume
  `;

  const systemPrompt = `You are the AI intelligence assistant for VishvaERP college management system. You have access to real-time campus data. Provide concise, actionable insights based on the data. Use bullet points. Be specific with numbers. If asked about something not in the data, say so. Respond in 3-5 sentences max unless asked for detail.`;

  const response = await askAI(campusData + '\n\nUser Query: ' + query, systemPrompt, { maxTokens: 800 });

  res.json({ success: true, response, dataSummary: { students, faculty, attendanceRate: att.total>0?Math.round(att.present/att.total*100):0, avgMarks: Math.round(res_.avg||0), passRate: res_.total>0?Math.round(res_.pass/res_.total*100):0, feeCollectionRate: fee.total>0?Math.round(fee.collected/fee.total*100):0, activeJobs: jobs, totalApplications: totalApps, selectionRate: totalApps>0?Math.round(selectedApps/totalApps*100):0 } });
});

const getPredictions = asyncHandler(async (req, res) => {
  const cid = req.user.collegeId;

  const [placementTrend, feeTrend, attendanceTrend] = await Promise.all([
    PlacementApplication.aggregate([
      { $match: { collegeId: cid, createdAt: { $gte: new Date(Date.now() - 90*24*60*60*1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, total: { $sum: 1 }, selected: { $sum: { $cond: [{ $in: ['$status', ['selected','offered','accepted']] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    Fee.aggregate([
      { $match: { collegeId: cid, createdAt: { $gte: new Date(Date.now() - 180*24*60*60*1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, collected: { $sum: '$paidAmount' }, pending: { $sum: { $cond: [{ $in: ['$status', ['pending','overdue']] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    Attendance.aggregate([
      { $match: { collegeId: cid, date: { $gte: new Date(Date.now() - 90*24*60*60*1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, total: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  function predictNext(data, key) {
    if (data.length < 2) return null;
    const values = data.map(d => d[key] || 0);
    const n = values.length;
    const avg = values.reduce((s,v) => s+v, 0) / n;
    const trend = (values[n-1] - values[0]) / n;
    return Math.round(avg + trend * 1.5);
  }

  const nextMonthPlacement = predictNext(placementTrend, 'selected');
  const nextMonthFee = predictNext(feeTrend, 'collected');
  const nextMonthAttendance = predictNext(attendanceTrend.map(a => ({ rate: a.total > 0 ? a.present/a.total*100 : 0 })), 'rate');

  res.json({
    success: true,
    predictions: {
      nextMonthPlacements: nextMonthPlacement,
      nextMonthFeeCollection: nextMonthFee,
      nextMonthAttendanceRate: nextMonthAttendance ? Math.round(nextMonthAttendance) : null,
      confidence: placementTrend.length >= 3 ? 'medium' : 'low',
      basedOnMonths: placementTrend.length,
    },
  });
});

module.exports = { getCampusHealth, getAtRiskStudents, getModuleAnalytics, getTrends, aiQuery, getPredictions };
