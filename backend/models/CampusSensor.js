const mongoose = require('mongoose');

const sensorReadingSchema = new mongoose.Schema({
  sensorId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampusSensor', required: true },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  value: { type: Number, required: true },
  unit: { type: String },
  timestamp: { type: Date, default: Date.now },
  isAlert: { type: Boolean, default: false },
  alertMessage: { type: String },
}, { timestamps: false });

sensorReadingSchema.index({ sensorId: 1, timestamp: -1 });
sensorReadingSchema.index({ collegeId: 1, timestamp: -1 });
sensorReadingSchema.index({ collegeId: 1, sensorId: 1, timestamp: -1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const campusSensorSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['temperature', 'humidity', 'air_quality', 'energy_meter', 'water_meter', 'noise', 'occupancy', 'light', 'co2', 'motion'], required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampusResource' },
  location: { type: String, trim: true },
  building: { type: String, trim: true },
  floor: { type: String },
  room: { type: String },
  model: { type: String },
  manufacturer: { type: String },
  serialNumber: { type: String },
  status: { type: String, enum: ['active', 'inactive', 'maintenance', 'error'], default: 'active' },
  lastReading: { type: Number },
  lastReadingAt: { type: Date },
  unit: { type: String },
  minThreshold: { type: Number },
  maxThreshold: { type: Number },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

campusSensorSchema.index({ collegeId: 1, type: 1 });
campusSensorSchema.index({ collegeId: 1, status: 1 });
campusSensorSchema.index({ collegeId: 1, building: 1 });

const CampusSensor = mongoose.model('CampusSensor', campusSensorSchema);
const SensorReading = mongoose.model('SensorReading', sensorReadingSchema);

module.exports = { CampusSensor, SensorReading };
