const asyncHandler = require('../middleware/asyncHandler');
const { CampusSensor, SensorReading } = require('../models/CampusSensor');
const CampusResource = require('../models/CampusResource');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

const getSensors = asyncHandler(async (req, res) => {
  const { type, building, status } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };
  if (type) query.type = type;
  if (building) query.building = building;
  if (status) query.status = status;

  const sensors = await CampusSensor.find(query).populate('resourceId', 'name type building room').sort({ building: 1, name: 1 });
  res.json({ success: true, sensors });
});

const createSensor = asyncHandler(async (req, res) => {
  const sensor = await CampusSensor.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'campus-sensor', { resourceId: sensor._id, description: `Added sensor: ${sensor.name}` });
  res.status(201).json({ success: true, sensor });
});

const updateSensor = asyncHandler(async (req, res) => {
  const sensor = await CampusSensor.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true, runValidators: true }
  );
  if (!sensor) return res.status(404).json({ success: false, message: 'Sensor not found' });
  res.json({ success: true, sensor });
});

const deleteSensor = asyncHandler(async (req, res) => {
  const sensor = await CampusSensor.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!sensor) return res.status(404).json({ success: false, message: 'Sensor not found' });
  logAudit(req, 'delete', 'campus-sensor', { resourceId: sensor._id, description: `Deleted sensor: ${sensor.name}` });
  res.json({ success: true, message: 'Sensor deleted' });
});

const recordReading = asyncHandler(async (req, res) => {
  const { sensorId, value, unit, isAlert, alertMessage } = req.body;
  if (!sensorId || value === undefined) {
    return res.status(400).json({ success: false, message: 'sensorId and value are required' });
  }

  const sensor = await CampusSensor.findOne({ _id: sensorId, collegeId: req.user.collegeId });
  if (!sensor) return res.status(404).json({ success: false, message: 'Sensor not found' });

  const alertDetected = isAlert || (sensor.maxThreshold && value > sensor.maxThreshold) || (sensor.minThreshold && value < sensor.minThreshold);

  const reading = await SensorReading.create({
    sensorId,
    collegeId: req.user.collegeId,
    value,
    unit: unit || sensor.unit,
    isAlert: alertDetected,
    alertMessage,
  });

  await CampusSensor.findByIdAndUpdate(sensorId, { lastReading: value, lastReadingAt: new Date() });

  const sensorPayload = {
    sensorId: sensor._id,
    name: sensor.name,
    type: sensor.type,
    building: sensor.building,
    room: sensor.room,
    value,
    unit: reading.unit,
    isAlert: alertDetected,
    alertMessage,
    timestamp: reading.timestamp,
  };

  if (req.io) {
    req.io.to(`college:${req.user.collegeId}`).emit('sensor_reading', sensorPayload);
    if (alertDetected) {
      req.io.to(`college:${req.user.collegeId}`).emit('sensor_alert', {
        ...sensorPayload,
        severity: getAlertSeverity(sensor.type, value, sensor.maxThreshold, sensor.minThreshold),
        message: alertMessage || `Alert: ${sensor.name} reading ${value}${reading.unit} at ${sensor.building || ''} ${sensor.room || ''}`.trim(),
      });
    }
  }

  res.status(201).json({ success: true, reading });
});

function getAlertSeverity(type, value, max, min) {
  if (max && value > max * 1.5) return 'critical';
  if (min && value < min * 0.5) return 'critical';
  if (max && value > max * 1.2) return 'high';
  if (type === 'air_quality' && value > 200) return 'critical';
  if (type === 'air_quality' && value > 150) return 'high';
  if (type === 'co2' && value > 1000) return 'high';
  if (type === 'temperature' && (value > 40 || value < 5)) return 'high';
  return 'medium';
}

const getSensorReadings = asyncHandler(async (req, res) => {
  const { sensorId, from, to, limit = 100 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (sensorId) query.sensorId = sensorId;
  if (from || to) {
    query.timestamp = {};
    if (from) query.timestamp.$gte = new Date(from);
    if (to) query.timestamp.$lte = new Date(to);
  }

  const readings = await SensorReading.find(query).sort({ timestamp: -1 }).limit(Number(limit));
  res.json({ success: true, readings });
});

const getSensorDashboard = asyncHandler(async (req, res) => {
  const sensors = await CampusSensor.find({ collegeId: req.user.collegeId, isActive: true });
  const sensorIds = sensors.map(s => s._id);

  const alerts = await SensorReading.find({
    collegeId: req.user.collegeId, isAlert: true,
    timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  }).populate('sensorId', 'name type building room').sort({ timestamp: -1 }).limit(20);

  const statusCounts = { active: 0, inactive: 0, maintenance: 0, error: 0 };
  sensors.forEach(s => { if (statusCounts[s.status] !== undefined) statusCounts[s.status]++; });

  const typeCounts = {};
  sensors.forEach(s => { typeCounts[s.type] = (typeCounts[s.type] || 0) + 1; });

  const latestByType = {};
  const typeOrder = ['temperature', 'humidity', 'air_quality', 'energy_meter', 'water_meter', 'co2'];
  for (const type of typeOrder) {
    const typeSensors = sensors.filter(s => s.type === type);
    if (typeSensors.length > 0) {
      const readings = await SensorReading.find({
        sensorId: { $in: typeSensors.map(s => s._id) },
        collegeId: req.user.collegeId,
      }).sort({ timestamp: -1 }).limit(typeSensors.length);
      latestByType[type] = {
        sensors: typeSensors.length,
        avgValue: readings.length > 0 ? Math.round(readings.reduce((s, r) => s + r.value, 0) / readings.length * 10) / 10 : 0,
        unit: typeSensors[0].unit || '',
      };
    }
  }

  const buildings = [...new Set(sensors.map(s => s.building).filter(Boolean))];

  res.json({
    success: true,
    dashboard: {
      totalSensors: sensors.length,
      statusCounts,
      typeCounts,
      buildings,
      latestByType,
      recentAlerts: alerts,
    },
  });
});

const getResources = asyncHandler(async (req, res) => {
  const { type, building, status } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };
  if (type) query.type = type;
  if (building) query.building = building;
  if (status) query.status = status;

  const resources = await CampusResource.find(query).sort({ building: 1, name: 1 });
  res.json({ success: true, resources });
});

const createResource = asyncHandler(async (req, res) => {
  const resource = await CampusResource.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'campus-resource', { resourceId: resource._id, description: `Added: ${resource.name}` });
  res.status(201).json({ success: true, resource });
});

const updateResource = asyncHandler(async (req, res) => {
  const resource = await CampusResource.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true, runValidators: true }
  );
  if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

  if (req.io) {
    req.io.to(`college:${req.user.collegeId}`).emit('resource_update', {
      resourceId: resource._id,
      name: resource.name,
      type: resource.type,
      building: resource.building,
      status: resource.status,
      currentOccupancy: resource.currentOccupancy,
      capacity: resource.capacity,
    });
  }

  res.json({ success: true, resource });
});

const deleteResource = asyncHandler(async (req, res) => {
  const resource = await CampusResource.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });
  logAudit(req, 'delete', 'campus-resource', { resourceId: resource._id, description: `Deleted: ${resource.name}` });
  res.json({ success: true, message: 'Resource deleted' });
});

const getResourceStats = asyncHandler(async (req, res) => {
  const stats = await CampusResource.aggregate([
    { $match: { collegeId: req.user.collegeId, isActive: true } },
    { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const byType = await CampusResource.aggregate([
    { $match: { collegeId: req.user.collegeId, isActive: true } },
    { $group: { _id: '$type', total: { $sum: 1 }, totalCapacity: { $sum: '$capacity' }, totalOccupancy: { $sum: '$currentOccupancy' } } },
  ]);

  const buildings = await CampusResource.aggregate([
    { $match: { collegeId: req.user.collegeId, isActive: true, building: { $exists: true, $ne: '' } } },
    { $group: { _id: '$building', rooms: { $sum: 1 }, totalCapacity: { $sum: '$capacity' }, totalOccupancy: { $sum: '$currentOccupancy' } } },
    { $sort: { _id: 1 } },
  ]);

  res.json({ success: true, stats: { statusBreakdown: stats, byType, buildings } });
});

module.exports = {
  getSensors, createSensor, updateSensor, deleteSensor,
  recordReading, getSensorReadings, getSensorDashboard,
  getResources, createResource, updateResource, deleteResource, getResourceStats,
};
