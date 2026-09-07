const asyncHandler = require('../middleware/asyncHandler');
const InventoryItem = require('../models/Inventory');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');

const createItem = asyncHandler(async (req, res) => {
  const { name, category, description, quantity, unit, location, department, purchaseDate, purchasePrice, currentValue, vendor, warrantyExpiry } = req.body;
  if (!name || !category) return res.status(400).json({ success: false, message: 'Name and category are required' });
  const item = await InventoryItem.create({
    collegeId: req.user.collegeId, name, category, description, quantity, unit, location, department,
    purchaseDate, purchasePrice, currentValue, vendor, warrantyExpiry,
  });
  logAudit(req, 'create', 'inventory', { resourceId: item._id, description: `Added inventory item: ${name}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['collegeAdmin'], resource: 'inventory', action: 'created' });
  res.status(201).json({ success: true, item });
});

const getItems = asyncHandler(async (req, res) => {
  const { category, status, search, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (category) query.category = category;
  if (status) query.status = status;
  if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { itemId: { $regex: search, $options: 'i' } }];
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    InventoryItem.find(query).populate('assignedTo', 'name').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    InventoryItem.countDocuments(query),
  ]);
  res.json({ success: true, items, total, pages: Math.ceil(total / Number(limit)) });
});

const getItemById = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('assignedTo', 'name email')
    .populate('assets.assignedTo', 'name');
  if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
  res.json({ success: true, item });
});

const updateItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findOneAndUpdate({ _id: req.params.id, collegeId: req.user.collegeId }, req.body, { new: true });
  if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
  logAudit(req, 'update', 'inventory', { resourceId: item._id, description: `Updated inventory item: ${item.name}` });
  res.json({ success: true, item });
});

const deleteItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
  logAudit(req, 'delete', 'inventory', { resourceId: item._id, description: `Deleted inventory item: ${item.name}` });
  res.json({ success: true, message: 'Item deleted' });
});

const assignItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
  const { assignedTo } = req.body;
  item.assignedTo = assignedTo;
  item.status = assignedTo ? 'in-use' : 'available';
  await item.save();
  res.json({ success: true, item });
});

const addMaintenanceLog = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
  const { type, description, cost, performedBy } = req.body;
  item.maintenanceLogs.push({ type, description, cost, performedBy });
  item.lastMaintenance = new Date();
  if (type === 'repair') item.status = 'maintenance';
  await item.save();
  res.json({ success: true, item });
});

const getInventoryStats = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  const [categoryCounts, statusCounts, totalValue, maintenanceDue] = await Promise.all([
    InventoryItem.aggregate([{ $match: query }, { $group: { _id: '$category', count: { $sum: '$quantity' }, value: { $sum: { $multiply: ['$quantity', { $ifNull: ['$currentValue', 0] }] } } } }]),
    InventoryItem.aggregate([{ $match: query }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    InventoryItem.aggregate([{ $match: query }, { $group: { _id: null, total: { $sum: { $multiply: ['$quantity', { $ifNull: ['$currentValue', 0] }] } } } }]),
    InventoryItem.countDocuments({ ...query, nextMaintenance: { $lte: new Date() }, status: { $ne: 'retired' } }),
  ]);
  res.json({
    success: true,
    byCategory: categoryCounts,
    byStatus: Object.fromEntries(statusCounts.map(s => [s._id, s.count])),
    totalValue: totalValue[0]?.total || 0,
    maintenanceDue,
  });
});

module.exports = { createItem, getItems, getItemById, updateItem, deleteItem, assignItem, addMaintenanceLog, getInventoryStats };
