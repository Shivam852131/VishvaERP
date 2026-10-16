const AuditLog = require('../models/AuditLog');

async function logAudit(req, action, resource, options = {}) {
  try {
    const entry = {
      userId: req.user?._id,
      userEmail: req.user?.email,
      userRole: req.user?.role,
      collegeId: req.user?.collegeId,
      action,
      resource,
      resourceId: options.resourceId || undefined,
      description: options.description || '',
      metadata: options.metadata || {},
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
      userAgent: (req.headers['user-agent'] || '').slice(0, 500),
      status: options.status || 'success',
    };

    await AuditLog.create(entry);
  } catch {
    // Audit should never block the main operation
  }
}

async function getAuditLogs(query = {}, options = {}) {
  const { page = 1, limit = 50, sort = '-createdAt' } = options;
  const skip = (page - 1) * limit;

  const [total, logs] = await Promise.all([
    AuditLog.countDocuments(query),
    AuditLog.find(query)
      .populate('userId', 'name email role')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return {
    data: logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

module.exports = { logAudit, getAuditLogs };
