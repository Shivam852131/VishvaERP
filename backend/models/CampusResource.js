const mongoose = require('mongoose');

const campusResourceSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['building', 'classroom', 'lab', 'auditorium', 'library', 'hostel', 'cafeteria', 'sports', 'office', 'parking', 'other'], required: true },
  building: { type: String, trim: true },
  floor: { type: String },
  roomNumber: { type: String },
  capacity: { type: Number, default: 0 },
  area: { type: Number },
  areaUnit: { type: String, default: 'sqft' },
  amenities: [{ type: String }],
  status: { type: String, enum: ['available', 'occupied', 'maintenance', 'reserved', 'closed'], default: 'available' },
  currentOccupancy: { type: Number, default: 0 },
  maxOccupancy: { type: Number, default: 0 },
  openingTime: { type: String },
  closingTime: { type: String },
  contactPerson: { type: String },
  contactPhone: { type: String },
  description: { type: String },
  hasAC: { type: Boolean, default: false },
  hasProjector: { type: Boolean, default: false },
  hasWifi: { type: Boolean, default: true },
  hasWhiteboard: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

campusResourceSchema.index({ collegeId: 1, type: 1 });
campusResourceSchema.index({ collegeId: 1, building: 1 });
campusResourceSchema.index({ collegeId: 1, status: 1 });

module.exports = mongoose.model('CampusResource', campusResourceSchema);
