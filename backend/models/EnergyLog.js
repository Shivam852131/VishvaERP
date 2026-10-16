const mongoose = require('mongoose');

const energyLogSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampusResource' },
  sensorId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampusSensor' },
  type: { type: String, enum: ['electricity', 'water', 'gas', 'waste', 'solar', 'recycling'], required: true },
  reading: { type: Number, required: true },
  unit: { type: String, required: true },
  cost: { type: Number },
  currency: { type: String, default: 'INR' },
  building: { type: String },
  date: { type: Date, default: Date.now },
  period: { type: String, enum: ['hourly', 'daily', 'weekly', 'monthly'], default: 'daily' },
  source: { type: String, enum: ['manual', 'sensor', 'meter', 'bill'], default: 'sensor' },
  metadata: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

energyLogSchema.index({ collegeId: 1, type: 1, date: -1 });
energyLogSchema.index({ collegeId: 1, building: 1, date: -1 });
energyLogSchema.index({ collegeId: 1, date: -1, period: 1 });

const sustainabilityGoalSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  title: { type: String, required: true },
  description: { type: String },
  type: { type: String, enum: ['electricity', 'water', 'gas', 'waste', 'solar', 'recycling', 'carbon'], required: true },
  targetValue: { type: Number, required: true },
  currentValue: { type: Number, default: 0 },
  unit: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['on_track', 'behind', 'achieved', 'missed'], default: 'on_track' },
  milestones: [{
    title: String,
    targetDate: Date,
    completed: { type: Boolean, default: false },
    completedAt: Date,
  }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

sustainabilityGoalSchema.index({ collegeId: 1, type: 1, isActive: 1 });

const EnergyLog = mongoose.model('EnergyLog', energyLogSchema);
const SustainabilityGoal = mongoose.model('SustainabilityGoal', sustainabilityGoalSchema);

module.exports = { EnergyLog, SustainabilityGoal };
