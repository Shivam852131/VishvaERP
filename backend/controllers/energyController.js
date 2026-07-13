const asyncHandler = require('../middleware/asyncHandler');
const { EnergyLog, SustainabilityGoal } = require('../models/EnergyLog');
const { logAudit } = require('../services/auditService');

const logEnergy = asyncHandler(async (req, res) => {
  const log = await EnergyLog.create({ collegeId: req.user.collegeId, ...req.body });
  res.status(201).json({ success: true, log });
});

const getEnergyLogs = asyncHandler(async (req, res) => {
  const { type, building, from, to, period, page = 1, limit = 50 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (type) query.type = type;
  if (building) query.building = building;
  if (period) query.period = period;
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = new Date(from);
    if (to) query.date.$lte = new Date(to);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [logs, total] = await Promise.all([
    EnergyLog.find(query).populate('resourceId', 'name building').sort({ date: -1 }).skip(skip).limit(Number(limit)),
    EnergyLog.countDocuments(query),
  ]);

  res.json({ success: true, logs, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } });
});

const getEnergyDashboard = asyncHandler(async (req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

  const types = ['electricity', 'water', 'gas', 'waste', 'solar', 'recycling'];

  const consumptionByType = await EnergyLog.aggregate([
    { $match: { collegeId: req.user.collegeId, date: { $gte: thirtyDaysAgo } } },
    { $group: { _id: '$type', totalReading: { $sum: '$reading' }, totalCost: { $sum: '$cost' }, count: { $sum: 1 } } },
  ]);

  const dailyTrend = await EnergyLog.aggregate([
    { $match: { collegeId: req.user.collegeId, date: { $gte: thirtyDaysAgo }, period: 'daily' } },
    { $group: { _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, type: '$type' }, total: { $sum: '$reading' } } },
    { $sort: { '_id.date': 1 } },
  ]);

  const buildingConsumption = await EnergyLog.aggregate([
    { $match: { collegeId: req.user.collegeId, date: { $gte: thirtyDaysAgo }, building: { $exists: true, $ne: '' } } },
    { $group: { _id: { building: '$building', type: '$type' }, total: { $sum: '$reading' }, cost: { $sum: '$cost' } } },
    { $sort: { total: -1 } },
  ]);

  const totalCost = await EnergyLog.aggregate([
    { $match: { collegeId: req.user.collegeId, date: { $gte: thirtyDaysAgo } } },
    { $group: { _id: null, total: { $sum: '$cost' } } },
  ]);

  const goals = await SustainabilityGoal.find({ collegeId: req.user.collegeId, isActive: true });
  const goalsProgress = goals.map(g => ({
    ...g.toObject(),
    progress: g.targetValue > 0 ? Math.round((g.currentValue / g.targetValue) * 100) : 0,
    remaining: Math.max(0, g.targetValue - g.currentValue),
  }));

  const previousPeriod = await EnergyLog.aggregate([
    { $match: { collegeId: req.user.collegeId, date: { $gte: ninetyDaysAgo, $lt: thirtyDaysAgo } } },
    { $group: { _id: '$type', total: { $sum: '$reading' } } },
  ]);

  const currentPeriod = await EnergyLog.aggregate([
    { $match: { collegeId: req.user.collegeId, date: { $gte: thirtyDaysAgo } } },
    { $group: { _id: '$type', total: { $sum: '$reading' } } },
  ]);

  const trends = {};
  types.forEach(type => {
    const curr = currentPeriod.find(c => c._id === type)?.total || 0;
    const prev = previousPeriod.find(p => p._id === type)?.total || 0;
    trends[type] = { current: curr, previous: prev, change: prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0 };
  });

  res.json({
    success: true,
    dashboard: {
      consumptionByType,
      dailyTrend,
      buildingConsumption,
      totalCostLast30Days: totalCost[0]?.total || 0,
      goals: goalsProgress,
      trends,
    },
  });
});

const createGoal = asyncHandler(async (req, res) => {
  const goal = await SustainabilityGoal.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'sustainability-goal', { resourceId: goal._id, description: `Goal: ${goal.title}` });
  res.status(201).json({ success: true, goal });
});

const getGoals = asyncHandler(async (req, res) => {
  const goals = await SustainabilityGoal.find({ collegeId: req.user.collegeId }).sort({ endDate: 1 });
  const enriched = goals.map(g => ({
    ...g.toObject(),
    progress: g.targetValue > 0 ? Math.round((g.currentValue / g.targetValue) * 100) : 0,
  }));
  res.json({ success: true, goals: enriched });
});

const updateGoal = asyncHandler(async (req, res) => {
  const goal = await SustainabilityGoal.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true, runValidators: true }
  );
  if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });
  res.json({ success: true, goal });
});

const deleteGoal = asyncHandler(async (req, res) => {
  const goal = await SustainabilityGoal.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });
  logAudit(req, 'delete', 'sustainability-goal', { resourceId: goal._id, description: `Deleted: ${goal.title}` });
  res.json({ success: true, message: 'Goal deleted' });
});

module.exports = { logEnergy, getEnergyLogs, getEnergyDashboard, createGoal, getGoals, updateGoal, deleteGoal };
