const mongoose = require('mongoose');

const transportRouteSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  routeName: { type: String, required: true },
  busNumber: { type: String, required: true },
  driverName: { type: String },
  driverPhone: { type: String },
  stops: [{
    stopName: String,
    pickupTime: String,
    dropTime: String,
    feePerTerm: Number
  }],
  capacity: { type: Number, required: true },
  enrolledStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

transportRouteSchema.index({ collegeId: 1, isActive: 1 });

module.exports = mongoose.model('TransportRoute', transportRouteSchema);
