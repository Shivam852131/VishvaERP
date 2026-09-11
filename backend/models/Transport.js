const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema({
  stopName: { type: String, required: true },
  pickupTime: { type: String, default: '' },
  dropTime: { type: String, default: '' },
  feePerTerm: { type: Number, default: 0 },
  lat: { type: Number },
  lng: { type: Number },
}, { _id: true });

const passSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  passNumber: { type: String, required: true },
  issueDate: { type: Date, default: Date.now },
  expiryDate: { type: Date },
  stopName: { type: String },
  feePaid: { type: Boolean, default: true },
  qrCode: { type: String },
  status: {
    type: String,
    enum: ['active', 'expired', 'suspended'],
    default: 'active',
  },
}, { timestamps: true });

const transportRouteSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  routeName: { type: String, required: true },
  routeCode: { type: String },
  busNumber: { type: String, required: true },
  vehicleModel: { type: String },
  driverName: { type: String },
  driverPhone: { type: String },
  driverLicense: { type: String },
  helperName: { type: String },
  helperPhone: { type: String },
  stops: [stopSchema],
  capacity: { type: Number, required: true, default: 40 },
  enrolledStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  passes: [passSchema],
  currentLocation: {
    lat: { type: Number, default: 0 },
    lng: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    heading: { type: Number, default: 0 },
    lastUpdated: { type: Date },
    currentStopIndex: { type: Number, default: 0 },
    isLive: { type: Boolean, default: false },
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

transportRouteSchema.index({ collegeId: 1, isActive: 1 });
transportRouteSchema.index({ collegeId: 1, 'passes.passNumber': 1 });

module.exports = mongoose.model('TransportRoute', transportRouteSchema);
