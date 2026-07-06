const asyncHandler = require('../middleware/asyncHandler');
const College = require('../models/College');
const User = require('../models/User');
const Fee = require('../models/Fee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Broadcast = require('../models/Broadcast');
const PlatformSetting = require('../models/PlatformSetting');
const Subscription = require('../models/Subscription');
const mongoose = require('mongoose');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

const DEFAULT_TRIAL_DAYS = 30;

const buildTrialWindow = (days = DEFAULT_TRIAL_DAYS) => {
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days);
  return { startDate, endDate };
};

const ensureCollegeTrialSubscription = async (collegeId, plan = 'basic') => {
  if (!collegeId) return null;

  const activeSubscription = await Subscription.findOne({
    collegeId,
    status: 'active',
    endDate: { $gt: new Date() },
  });
  if (activeSubscription) {
    return activeSubscription;
  }

  const { startDate, endDate } = buildTrialWindow();
  const subscription = await Subscription.create({
    collegeId,
    plan,
    amount: 0,
    currency: 'INR',
    status: 'active',
    startDate,
    endDate,
    billingCycle: 'monthly',
  });

  await College.findByIdAndUpdate(collegeId, { plan, planExpiry: endDate }, { runValidators: false });
  return subscription;
};

const buildCollegeCode = (name = '') => {
  const base = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8);
  return base || `COL${Date.now().toString().slice(-4)}`;
};

const maskSecret = (value = '') => {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(value.length - 8, 4))}${value.slice(-4)}`;
};

const ensurePlatformSettings = () => PlatformSetting.findOneAndUpdate(
  { key: 'platform' },
  { $setOnInsert: { key: 'platform' } },
  { new: true, upsert: true }
);

const sanitizeSettings = (settings) => ({
  general: settings.general,
  security: settings.security,
  email: settings.email,
  storage: settings.storage,
  ai: {
    defaultModel: settings.ai?.defaultModel || 'gemini-1.5-pro',
    enabled: settings.ai?.enabled !== false,
    apiKeyMasked: maskSecret(settings.ai?.apiKey || ''),
    apiKeyConfigured: Boolean(settings.ai?.apiKey),
  },
  updatedAt: settings.updatedAt,
});

const asPlain = (value) => (value && typeof value.toObject === 'function' ? value.toObject() : value || {});

// ─────────────────────────────────────────────
// COLLEGE MANAGEMENT
// ─────────────────────────────────────────────

const createCollege = asyncHandler(async (req, res) => {
    const {
      name,
      code,
      email,
      phone,
      address,
      city,
      state,
      country,
      plan,
      adminName,
      adminEmail,
      adminPassword,
      adminPhone,
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'College name is required' });
    }

    const normalizedCode = (code || buildCollegeCode(name)).toUpperCase();
    const existingCollege = await College.findOne({ code: normalizedCode });
    if (existingCollege) {
      return res.status(400).json({ success: false, message: 'College code already exists' });
    }

    if (adminEmail) {
      const existingAdmin = await User.findOne({ email: adminEmail });
      if (existingAdmin) {
        return res.status(400).json({ success: false, message: 'Admin email already exists' });
      }
    }

    const college = await College.create({
      name,
      code: normalizedCode,
      email: email || adminEmail,
      phone,
      address,
      city,
      state,
      country,
      plan,
    });

    let admin = null;
    if (adminName && adminEmail && adminPassword) {
      admin = await User.create({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        phone: adminPhone,
        role: 'collegeAdmin',
        collegeId: college._id,
      });

      college.adminId = admin._id;
      await college.save();
    }

    await ensureCollegeTrialSubscription(college._id, college.plan || 'basic');

    logAudit(req, 'create', 'college', { resourceId: college._id, description: `Created college: ${name}`, metadata: { code: normalizedCode } });

    emitDataChange(req, {
      roles: ['superadmin'],
      resource: 'colleges',
      action: 'created',
      collegeId: String(college._id),
    });

    res.status(201).json({
      success: true,
      message: 'College created',
      college: {
        ...college.toObject(),
        adminName: admin?.name || null,
        adminEmail: admin?.email || college.email || null,
        status: college.isActive ? 'active' : 'suspended',
      },
    });
  });

const getColleges = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search = '', isActive, plan } = req.query;
    const query = {};
    if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { code: { $regex: search, $options: 'i' } }, { city: { $regex: search, $options: 'i' } }];
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (plan) query.plan = plan;

    const colleges = await College.find(query)
      .populate('adminId', 'name email phone')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await College.countDocuments(query);
    const enriched = await Promise.all(colleges.map(async (college) => {
      const [students, faculty, parents] = await Promise.all([
        User.countDocuments({ collegeId: college._id, role: 'student' }),
        User.countDocuments({ collegeId: college._id, role: 'faculty' }),
        User.countDocuments({ collegeId: college._id, role: 'parent' }),
      ]);

      return {
        ...college.toObject(),
        adminName: college.adminId?.name || null,
        adminEmail: college.adminId?.email || college.email || null,
        students,
        faculty,
        parents,
        studentsCount: students,
        status: college.isActive ? 'active' : 'suspended',
      };
    }));

    res.json({ success: true, colleges: enriched, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  });

const getCollegeById = asyncHandler(async (req, res) => {
    const college = await College.findById(req.params.id).populate('adminId', 'name email phone lastLogin');
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });

    // Fetch counts from User model
    const [students, faculty, parents] = await Promise.all([
      User.countDocuments({ collegeId: college._id, role: 'student' }),
      User.countDocuments({ collegeId: college._id, role: 'faculty' }),
      User.countDocuments({ collegeId: college._id, role: 'parent' }),
    ]);

    res.json({ success: true, college, stats: { students, faculty, parents } });
  });

const updateCollege = asyncHandler(async (req, res) => {
    const college = await College.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });
    emitDataChange(req, { roles: ['superadmin'], resource: 'colleges', action: 'updated', collegeId: String(college._id) });
    res.json({ success: true, message: 'College updated', college });
  });

const deleteCollege = asyncHandler(async (req, res) => {
    const college = await College.findById(req.params.id);
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });
    // Cascade: deactivate all users in the college
    await User.updateMany({ collegeId: college._id }, { isActive: false });
    await College.findByIdAndDelete(req.params.id);
    emitDataChange(req, { roles: ['superadmin'], resource: 'colleges', action: 'deleted', collegeId: String(college._id) });
    logAudit(req, 'delete', 'college', { resourceId: college._id, description: `Deleted college: ${college.name}`, status: 'success' });
    res.json({ success: true, message: 'College deleted and all associated users deactivated' });
  });

const toggleCollege = asyncHandler(async (req, res) => {
    const college = await College.findById(req.params.id);
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });
    college.isActive = !college.isActive;
    await college.save();
    // Also deactivate/activate all users
    await User.updateMany({ collegeId: college._id }, { isActive: college.isActive });
    emitDataChange(req, { roles: ['superadmin'], resource: 'colleges', action: 'toggled', collegeId: String(college._id) });
    logAudit(req, 'status_toggle', 'college', { resourceId: college._id, description: `${college.isActive ? 'Activated' : 'Suspended'} college: ${college.name}` });
    res.json({ success: true, message: `College ${college.isActive ? 'activated' : 'suspended'}`, college });
  });

const updateCollegePlan = asyncHandler(async (req, res) => {
    const { plan, planExpiry } = req.body;
    const college = await College.findByIdAndUpdate(req.params.id, { plan, planExpiry }, { new: true });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });
    emitDataChange(req, { roles: ['superadmin'], resource: 'colleges', action: 'plan-updated', collegeId: String(college._id) });
    res.json({ success: true, message: `Plan updated to ${plan}`, college });
  });

const assignCollegeAdmin = asyncHandler(async (req, res) => {
    const { adminEmail } = req.body;
    const admin = await User.findOne({ email: adminEmail, role: 'collegeAdmin' });
    if (!admin) return res.status(404).json({ success: false, message: 'College admin not found' });
    const college = await College.findByIdAndUpdate(req.params.id, { adminId: admin._id }, { new: true });
    admin.collegeId = college._id;
    await admin.save();
    emitDataChange(req, { roles: ['superadmin'], resource: 'colleges', action: 'admin-assigned', collegeId: String(college._id) });
    res.json({ success: true, message: 'Admin assigned successfully', college });
  });

// ─────────────────────────────────────────────
// USER MANAGEMENT (ALL PLATFORM USERS)
// ─────────────────────────────────────────────

const getAllUsers = asyncHandler(async (req, res) => {
    const { page = 1, limit = 15, search = '', role, isActive, collegeId } = req.query;
    const query = {};
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { rollNo: { $regex: search, $options: 'i' } },
    ];
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (collegeId) query.collegeId = collegeId;

    const users = await User.find(query)
      .select('-password')
      .populate('collegeId', 'name code')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);
    const formatted = users.map((user) => ({
      ...user.toObject(),
      college: user.collegeId?.name || 'Platform',
      active: user.isActive,
    }));
    res.json({ success: true, users: formatted, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  });

const createUser = asyncHandler(async (req, res) => {
    const { name, email, password, role, collegeId, phone, department, rollNo, semester } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already registered' });
    const user = await User.create({ name, email, password, role, collegeId: collegeId || null, phone, department, rollNo, semester });
    emitDataChange(req, { roles: ['superadmin'], resource: 'users', action: 'created', collegeId: collegeId ? String(collegeId) : null });
    logAudit(req, 'create', 'user', { resourceId: user._id, description: `Created user: ${name} (${role})`, metadata: { email, role } });
    res.status(201).json({ success: true, message: 'User created', user });
  });

const updateUser = asyncHandler(async (req, res) => {
    const { password, ...updateData } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    emitDataChange(req, { roles: ['superadmin'], resource: 'users', action: 'updated', collegeId: user.collegeId ? String(user.collegeId) : null });
    res.json({ success: true, message: 'User updated', user });
  });

const resetUserPassword = asyncHandler(async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.password = newPassword;
    await user.save();
    emitDataChange(req, { roles: ['superadmin'], resource: 'users', action: 'password-reset', collegeId: user.collegeId ? String(user.collegeId) : null });
    logAudit(req, 'password_change', 'user', { resourceId: user._id, description: `Reset password for ${user.email}`, metadata: { email: user.email } });
    res.json({ success: true, message: 'Password reset successfully' });
  });

const toggleUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'superadmin') return res.status(403).json({ success: false, message: 'Cannot deactivate superadmin' });
    user.isActive = !user.isActive;
    await user.save();
    emitDataChange(req, { roles: ['superadmin'], resource: 'users', action: 'toggled', collegeId: user.collegeId ? String(user.collegeId) : null });
    logAudit(req, 'status_toggle', 'user', { resourceId: user._id, description: `${user.isActive ? 'Activated' : 'Deactivated'} user: ${user.name} (${user.role})`, metadata: { email: user.email, role: user.role } });
    res.json({ success: true, message: `User ${user.isActive ? 'activated' : 'deactivated'}`, user });
  });

const deleteUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'superadmin') return res.status(403).json({ success: false, message: 'Cannot delete superadmin' });
    await User.findByIdAndDelete(req.params.id);
    emitDataChange(req, { roles: ['superadmin'], resource: 'users', action: 'deleted', collegeId: user.collegeId ? String(user.collegeId) : null });
    logAudit(req, 'delete', 'user', { resourceId: user._id, description: `Deleted user: ${user.name} (${user.email})`, metadata: { email: user.email, role: user.role } });
    res.json({ success: true, message: 'User permanently deleted' });
  });

// ─────────────────────────────────────────────
// DATABASE OVERVIEW (LIVE MONGODB STATS)
// ─────────────────────────────────────────────

const getDatabaseStats = asyncHandler(async (req, res) => {
    const db = mongoose.connection.db;
    const dbStats = await db.command({ dbStats: 1 });
    const collections = await db.listCollections().toArray();

    // Get per-collection document counts
    const collectionStats = await Promise.all(
      collections.map(async (col) => {
        const count = await db.collection(col.name).countDocuments();
        const stats = await db.command({ collStats: col.name });
        return {
          name: col.name,
          count,
          sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
          avgDocSize: stats.avgObjSize ? Math.round(stats.avgObjSize) : 0,
          indexes: stats.nindexes || 0,
        };
      })
    );

    res.json({
      success: true,
      database: {
        name: dbStats.db,
        collections: dbStats.collections,
        objects: dbStats.objects,
        dataSize: (dbStats.dataSize / (1024 * 1024)).toFixed(2),
        storageSize: (dbStats.storageSize / (1024 * 1024)).toFixed(2),
        indexes: dbStats.indexes,
      },
      collectionStats,
    });
  });

const getCollectionData = asyncHandler(async (req, res) => {
    const { collection } = req.params;
    const { page = 1, limit = 20, search = '' } = req.query;

    // Whitelist allowed collections
    const allowed = ['users', 'colleges', 'fees', 'attendances', 'leaves', 'courses', 'exams', 'results', 'subjects', 'notices', 'timetables', 'transports', 'hostels', 'libraries', 'assignments', 'communications'];
    if (!allowed.includes(collection)) return res.status(403).json({ success: false, message: 'Access to this collection is restricted' });

    const db = mongoose.connection.db;
    const col = db.collection(collection);

    let query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await col.countDocuments(query);
    const docs = await col.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .toArray();

    res.json({ success: true, collection, docs, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  });

const deleteCollectionDocument = asyncHandler(async (req, res) => {
    const { collection, docId } = req.params;
    const allowed = ['fees', 'attendances', 'leaves', 'courses', 'exams', 'results', 'subjects', 'notices', 'timetables', 'transports', 'hostels', 'libraries', 'assignments', 'communications'];
    if (!allowed.includes(collection)) return res.status(403).json({ success: false, message: 'Cannot delete from this collection via this endpoint' });

    const db = mongoose.connection.db;
    const result = await db.collection(collection).deleteOne({ _id: new mongoose.Types.ObjectId(docId) });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Document not found' });
    res.json({ success: true, message: 'Document deleted successfully' });
  });

// ─────────────────────────────────────────────
// AUDIT LOGS
// ─────────────────────────────────────────────

const getAuditLogs = asyncHandler(async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const { getAuditLogs: fetchAuditLogs } = require('../services/auditService');

    const result = await fetchAuditLogs({}, { page: parseInt(page), limit: parseInt(limit) });

    if (result.data.length > 0) {
      return res.json({ success: true, ...result });
    }

    // Fallback: simulate from user logins
    const recentUsers = await User.find({ lastLogin: { $exists: true, $ne: null } })
      .select('name email role lastLogin isActive collegeId')
      .populate('collegeId', 'name')
      .sort({ lastLogin: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const logs = recentUsers.map(u => ({
      _id: u._id,
      user: u.name,
      email: u.email,
      role: u.role,
      college: u.collegeId?.name || 'Platform',
      action: 'Login',
      timestamp: u.lastLogin,
      status: u.isActive ? 'success' : 'blocked',
    }));

  const total = await User.countDocuments({ lastLogin: { $exists: true, $ne: null } });
  res.json({ success: true, data: logs, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) } });
  });

const getBroadcastHistory = asyncHandler(async (req, res) => {
    const broadcasts = await Broadcast.find()
      .populate('sentBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({ success: true, broadcasts });
  });

const getPlatformSettings = asyncHandler(async (req, res) => {
    const settings = await ensurePlatformSettings();
    res.json({ success: true, settings: sanitizeSettings(settings) });
  });

const updatePlatformSettings = asyncHandler(async (req, res) => {
    const settings = await ensurePlatformSettings();
    const { general, security, email, storage, ai } = req.body;

    if (general) settings.general = { ...asPlain(settings.general), ...general };
    if (security) settings.security = { ...asPlain(settings.security), ...security };
    if (email) settings.email = { ...asPlain(settings.email), ...email };
    if (storage) settings.storage = { ...asPlain(settings.storage), ...storage };
    if (ai) {
      settings.ai = {
        ...asPlain(settings.ai),
        ...ai,
        apiKey: ai.apiKey !== undefined && ai.apiKey !== '' ? ai.apiKey : settings.ai.apiKey,
      };
    }

    await settings.save();
    emitDataChange(req, { roles: ['superadmin'], resource: 'platform-settings', action: 'updated' });

    res.json({ success: true, message: 'Platform settings updated', settings: sanitizeSettings(settings) });
  });

// ─────────────────────────────────────────────
// GLOBAL ANALYTICS
// ─────────────────────────────────────────────

const getGlobalAnalytics = asyncHandler(async (req, res) => {
    const [totalColleges, activeColleges, totalUsers, totalStudents, totalFaculty, totalParents, recentColleges] = await Promise.all([
      College.countDocuments(),
      College.countDocuments({ isActive: true }),
      User.countDocuments(),
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'faculty' }),
      User.countDocuments({ role: 'parent' }),
      College.find().sort({ createdAt: -1 }).limit(5).populate('adminId', 'name email'),
    ]);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const [monthlyRegistrations, planDistribution, roleDistribution, feeSummary, monthlyCollections] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      College.aggregate([
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
      ]),
      Fee.aggregate([
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            paidAmount: { $sum: '$paidAmount' },
            pendingCount: {
              $sum: {
                $cond: [{ $in: ['$status', ['pending', 'partial', 'overdue']] }, 1, 0],
              },
            },
          },
        },
      ]),
      Fee.aggregate([
        { $match: { paidDate: { $gte: sixMonthsAgo }, status: 'paid' } },
        { $group: { _id: { month: { $month: '$paidDate' }, year: { $year: '$paidDate' } }, amount: { $sum: '$paidAmount' } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ]);

    const revenue = feeSummary[0] || { totalAmount: 0, paidAmount: 0, pendingCount: 0 };

    res.json({
      success: true,
      analytics: {
        totalColleges, activeColleges, totalUsers, totalStudents, totalFaculty, totalParents,
        inactiveColleges: totalColleges - activeColleges,
        revenue,
        recentColleges, monthlyRegistrations, monthlyCollections, planDistribution, roleDistribution,
      },
    });
  });

// ─────────────────────────────────────────────
// SYSTEM HEALTH
// ─────────────────────────────────────────────

const getSystemHealth = asyncHandler(async (req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStates = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    res.json({
      success: true,
      health: {
        status: dbState === 1 ? 'healthy' : 'degraded',
        database: { status: dbStates[dbState], name: mongoose.connection.name },
        server: {
          uptime: Math.floor(uptime),
          uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
          nodeVersion: process.version,
          platform: process.platform,
        },
        memory: {
          heapUsedMB: (memUsage.heapUsed / 1024 / 1024).toFixed(1),
          heapTotalMB: (memUsage.heapTotal / 1024 / 1024).toFixed(1),
          rssMB: (memUsage.rss / 1024 / 1024).toFixed(1),
          usagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
        },
        timestamp: new Date().toISOString(),
      },
    });
  });

// ─────────────────────────────────────────────
// PLATFORM-WIDE BROADCAST NOTICE
// ─────────────────────────────────────────────

const broadcastNotice = asyncHandler(async (req, res) => {
    const { title, message, targetRoles, priority } = req.body;
    if (!title || !message) return res.status(400).json({ success: false, message: 'Title and message are required' });

    const broadcast = await Broadcast.create({
      title,
      message,
      targetRoles: Array.isArray(targetRoles) && targetRoles.length ? targetRoles : ['all'],
      priority: priority || 'info',
      sentBy: req.user._id,
    });

    // Emit via Socket.io
    if (req.io) {
      req.io.emit('platform_notice', {
        _id: broadcast._id,
        title,
        message,
        targetRoles: broadcast.targetRoles,
        priority: broadcast.priority,
        sentAt: broadcast.createdAt,
        sentBy: req.user.name,
      });
    }

    emitDataChange(req, { roles: ['superadmin'], resource: 'broadcasts', action: 'created' });

    logAudit(req, 'broadcast_send', 'broadcast', { resourceId: broadcast._id, description: `Broadcast: ${title}`, metadata: { targetRoles: broadcast.targetRoles, priority: broadcast.priority } });

    res.json({ success: true, message: `Broadcast sent to ${broadcast.targetRoles.join(', ')}`, title, broadcast });
  });

// ─────────────────────────────────────────────
// BULK OPERATIONS
// ─────────────────────────────────────────────

const bulkToggleUsers = asyncHandler(async (req, res) => {
    const { userIds, isActive } = req.body;
    if (!userIds || !userIds.length) return res.status(400).json({ success: false, message: 'No user IDs provided' });
    const result = await User.updateMany({ _id: { $in: userIds }, role: { $ne: 'superadmin' } }, { isActive });
    logAudit(req, 'bulk_action', 'user', { description: `Bulk ${isActive ? 'activated' : 'deactivated'} ${result.modifiedCount} users`, metadata: { count: result.modifiedCount, isActive } });
    res.json({ success: true, message: `${result.modifiedCount} users ${isActive ? 'activated' : 'deactivated'}` });
  });

module.exports = {
  createCollege, getColleges, getCollegeById, updateCollege, deleteCollege,
  toggleCollege, updateCollegePlan, assignCollegeAdmin,
  getAllUsers, createUser, updateUser, resetUserPassword, toggleUser, deleteUser,
  getDatabaseStats, getCollectionData, deleteCollectionDocument,
  getAuditLogs, getBroadcastHistory, getPlatformSettings, updatePlatformSettings,
  getGlobalAnalytics, getSystemHealth, broadcastNotice, bulkToggleUsers,
};
