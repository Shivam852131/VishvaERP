const express = require('express');
const College = require('../models/College');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Fee = require('../models/Fee');
const Course = require('../models/Course');
const Notice = require('../models/Notice');
const { getDbHealth } = require('../config/db');

const router = express.Router();

// @desc    Get live real-world overview for landing page and public telemetry
// @route   GET /api/public/live-overview
// @access  Public
router.get('/live-overview', async (req, res) => {
  try {
    const dbHealth = await getDbHealth();
    const isDbConnected = dbHealth.status === 'healthy';

    if (!isDbConnected) {
      return res.status(200).json({
        success: true,
        isLive: false,
        message: 'Database offline or connecting',
        college: { name: 'Vishva ERP Institution', code: 'MAIN', city: 'Campus', state: '' },
        counts: { totalStudents: 0, totalFaculty: 0, totalColleges: 0, totalCourses: 0, totalAttendance: 0 },
        attendance: { rate: 0, markedToday: 0, presentToday: 0 },
        fees: { totalAmount: 0, paidAmount: 0, totalFormatted: '₹0', paidFormatted: '₹0', collectionRate: 0 },
        recentStudents: [],
        departments: [],
        adminUser: { name: 'Administrator', role: 'admin' },
        uptimeSeconds: Math.round(process.uptime()),
      });
    }

    // 1. Fetch Primary College (Active)
    const college = await College.findOne({ isActive: true }).select('name code city state email departments phone').lean();

    // 2. Aggregate Live Entity Counts
    const collegeFilter = college ? { collegeId: college._id } : {};

    const [
      totalStudents,
      totalFaculty,
      totalColleges,
      totalCourses,
      totalAttendance,
      recentStudentsRaw,
      adminUserRaw,
      feeAggregate,
      recentNotices,
    ] = await Promise.all([
      User.countDocuments({ ...collegeFilter, role: 'student', isActive: true }),
      User.countDocuments({ ...collegeFilter, role: 'faculty', isActive: true }),
      College.countDocuments({ isActive: true }),
      Course.countDocuments({ ...(college ? { collegeId: college._id } : {}), isActive: true }),
      Attendance.countDocuments(collegeFilter),
      User.find({ ...collegeFilter, role: 'student' })
        .select('name rollNo department semester gender email createdAt isActive')
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
      User.findOne({ ...collegeFilter, role: { $in: ['collegeAdmin', 'superadmin'] } })
        .select('name email role')
        .lean(),
      Fee.aggregate([
        { $match: collegeFilter },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            paidAmount: { $sum: '$paidAmount' },
            count: { $sum: 1 },
            paidCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          },
        },
      ]),
      Notice.find({ ...(college ? { collegeId: college._id } : {}), isActive: true })
        .select('title content priority createdAt')
        .sort({ createdAt: -1 })
        .limit(3)
        .lean(),
    ]);

    // 3. Compute Real Attendance Rate
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [todayMarked, todayPresent] = await Promise.all([
      Attendance.countDocuments({ ...collegeFilter, date: { $gte: startOfDay, $lte: endOfDay } }),
      Attendance.countDocuments({ ...collegeFilter, date: { $gte: startOfDay, $lte: endOfDay }, status: 'present' }),
    ]);

    let attendanceRate = 0;
    if (todayMarked > 0) {
      attendanceRate = Math.round((todayPresent / todayMarked) * 1000) / 10;
    } else if (totalAttendance > 0) {
      const overallPresent = await Attendance.countDocuments({ ...collegeFilter, status: 'present' });
      attendanceRate = Math.round((overallPresent / totalAttendance) * 1000) / 10;
    }

    // 4. Financials formatting
    const feeData = feeAggregate[0] || { totalAmount: 0, paidAmount: 0, count: 0, paidCount: 0 };
    const feeRate = feeData.totalAmount > 0
      ? Math.round((feeData.paidAmount / feeData.totalAmount) * 1000) / 10
      : 0;

    const formatINR = (val) => {
      const num = Number(val || 0);
      if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`;
      if (num >= 100000) return `₹${(num / 100000).toFixed(2)} L`;
      return `₹${num.toLocaleString('en-IN')}`;
    };

    // 5. Distinct Departments
    let departments = college?.departments || [];
    if (!departments.length) {
      departments = await User.distinct('department', { ...collegeFilter, role: 'student' });
    }

    res.status(200).json({
      success: true,
      isLive: true,
      college: college || {
        name: 'Vishva ERP Main Campus',
        code: 'CAMPUS01',
        city: 'Institution Center',
        state: '',
        departments,
      },
      counts: {
        totalStudents,
        totalFaculty,
        totalColleges,
        totalCourses,
        totalAttendance,
      },
      attendance: {
        rate: attendanceRate || 0,
        markedToday: todayMarked,
        presentToday: todayPresent,
        totalRecords: totalAttendance,
      },
      fees: {
        totalAmount: feeData.totalAmount,
        paidAmount: feeData.paidAmount,
        totalFormatted: formatINR(feeData.totalAmount),
        paidFormatted: formatINR(feeData.paidAmount),
        collectionRate: feeRate,
      },
      recentStudents: recentStudentsRaw || [],
      recentNotices: recentNotices || [],
      departments: departments || [],
      adminUser: adminUserRaw || { name: 'Dr. A. Sharma', role: 'collegeAdmin' },
      system: {
        status: 'healthy',
        uptimeSeconds: Math.round(process.uptime()),
        database: 'connected',
        nodeVersion: process.version,
      },
    });
  } catch (error) {
    console.error('Error in /api/public/live-overview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch public live overview',
      error: error.message,
    });
  }
});

module.exports = router;
