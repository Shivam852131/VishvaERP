const asyncHandler = require('../middleware/asyncHandler');
const Leave = require('../models/Leave');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

// @desc    Apply for leave (Faculty/Students)
const applyLeave = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const overlap = await Leave.findOne({
      collegeId: req.user.collegeId,
      userId: userId,
      status: { $ne: 'rejected' },
      $or: [
        { startDate: { $lte: req.body.endDate }, endDate: { $gte: req.body.startDate } },
      ],
    });
    if (overlap) {
      return res.status(400).json({ success: false, message: 'Leave dates overlap with an existing leave application' });
    }

    const leave = await Leave.create({ ...req.body, userId, collegeId: req.user.collegeId });
    logAudit(req, 'create', 'leave', { resourceId: leave._id, description: `Leave application submitted`, metadata: { startDate: leave.startDate, endDate: leave.endDate } });
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'leaves', action: 'created' });
    res.status(201).json({ success: true, message: 'Leave application submitted successfully', leave });
  });

// @desc    Get leave requests for a user
const getMyLeaves = asyncHandler(async (req, res) => {
    const leaves = await Leave.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, leaves });
  });

// @desc    Get all pending leave requests (Admin)
const getAllLeaves = asyncHandler(async (req, res) => {
    const { status } = req.query;
    const query = { collegeId: req.user.collegeId };
    if (status) query.status = status;

    const leaves = await Leave.find(query).populate('userId', 'name role department designation').sort({ createdAt: -1 });
    res.json({ success: true, leaves });
  });

// @desc    Approve or Reject leave (Admin)
const updateLeaveStatus = asyncHandler(async (req, res) => {
    const { status, remarks } = req.body;
    const leave = await Leave.findOneAndUpdate(
      { _id: req.params.id, collegeId: req.user.collegeId },
      { status, remarks, approvedBy: req.user._id },
      { new: true }
    );
    if (!leave) return res.status(404).json({ success: false, message: 'Leave record not found' });
    logAudit(req, 'update', 'leave', { resourceId: leave._id, description: `Leave ${status}`, metadata: { status, remarks } });
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'leaves', action: 'updated' });
    
    res.json({ success: true, message: `Leave ${status} successfully`, leave });
  });

module.exports = { applyLeave, getMyLeaves, getAllLeaves, updateLeaveStatus };
