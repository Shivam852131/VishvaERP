const asyncHandler = require('../middleware/asyncHandler');
const Notice = require('../models/Notice');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

const typeMap = {
  academic: 'exam',
  exam: 'exam',
  urgent: 'urgent',
  event: 'event',
  holiday: 'holiday',
  general: 'general',
};

const targetRoleMap = {
  all: ['all'],
  'students only': ['student'],
  'faculty only': ['faculty'],
  'parents only': ['parent'],
  'college admins only': ['collegeAdmin'],
};

const normalizeTargetRoles = (value) => {
  if (!value) return ['all'];
  if (Array.isArray(value)) return value;

  const normalized = String(value).trim().toLowerCase();
  return targetRoleMap[normalized] || ['all'];
};

const getNotices = asyncHandler(async (req, res) => {
  const { type, search = '' } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };

  if (type && type !== 'all') {
    query.type = typeMap[type] || type;
  }

  if (req.user.role !== 'collegeAdmin') {
    query.$or = [
      { targetRoles: 'all' },
      { targetRoles: req.user.role },
    ];
  }

  if (search) {
    query.$and = query.$and || [];
    query.$and.push({
      $or: [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
      ],
    });
  }

  const notices = await Notice.find(query)
    .populate('createdBy', 'name role')
    .sort({ isPinned: -1, createdAt: -1 });

  res.json({ success: true, notices });
});

const createNotice = asyncHandler(async (req, res) => {
  const notice = await Notice.create({
    collegeId: req.user.collegeId,
    title: req.body.title,
    content: req.body.content || req.body.body,
    type: typeMap[req.body.type || req.body.category] || 'general',
    targetRoles: normalizeTargetRoles(req.body.targetRoles || req.body.target),
    createdBy: req.user._id,
    expiryDate: req.body.expiryDate || req.body.expiry || null,
    isPinned: Boolean(req.body.isPinned),
    attachments: req.body.attachments || [],
  });

  logAudit(req, 'create', 'notice', { resourceId: notice._id, description: `Created notice: ${notice.title}`, metadata: { type: notice.type } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'notices',
    action: 'created',
  });

  res.status(201).json({ success: true, notice });
});

const updateNotice = asyncHandler(async (req, res) => {
  const update = {};

  if (req.body.title !== undefined) update.title = req.body.title;
  if (req.body.content !== undefined || req.body.body !== undefined) update.content = req.body.content || req.body.body;
  if (req.body.type !== undefined || req.body.category !== undefined) update.type = typeMap[req.body.type || req.body.category] || 'general';
  if (req.body.targetRoles !== undefined || req.body.target !== undefined) update.targetRoles = normalizeTargetRoles(req.body.targetRoles || req.body.target);
  if (req.body.expiryDate !== undefined || req.body.expiry !== undefined) update.expiryDate = req.body.expiryDate || req.body.expiry || null;
  if (req.body.isPinned !== undefined) update.isPinned = req.body.isPinned;
  if (req.body.isActive !== undefined) update.isActive = req.body.isActive;

  const notice = await Notice.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    update,
    { new: true, runValidators: true }
  );

  if (!notice) {
    return res.status(404).json({ success: false, message: 'Notice not found' });
  }

  logAudit(req, 'update', 'notice', { resourceId: notice._id, description: `Updated notice: ${notice.title}`, metadata: { type: notice.type } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'notices',
    action: 'updated',
  });

  res.json({ success: true, notice });
});

const deleteNotice = asyncHandler(async (req, res) => {
  const notice = await Notice.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!notice) {
    return res.status(404).json({ success: false, message: 'Notice not found' });
  }

  logAudit(req, 'delete', 'notice', { resourceId: notice._id, description: `Deleted notice: ${notice.title}`, metadata: { type: notice.type } });
  emitDataChange(req, {
    collegeId: String(req.user.collegeId),
    roles: ['superadmin'],
    resource: 'notices',
    action: 'deleted',
  });

  res.json({ success: true, message: 'Notice deleted' });
});

module.exports = {
  getNotices,
  createNotice,
  updateNotice,
  deleteNotice,
};
