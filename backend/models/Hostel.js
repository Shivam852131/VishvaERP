const mongoose = require('mongoose');

const hostelSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['boys', 'girls', 'coed'], required: true },
  blockCode: { type: String },
  totalRooms: { type: Number, required: true },
  warden: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  wardenContact: {
    name: String,
    phone: String,
    email: String,
    office: String,
  },
  facilities: [{ type: String }],
  messType: { type: String, enum: ['veg', 'non-veg', 'both'], default: 'both' },
  rules: [{ type: String }],
  curfewTime: { type: String, default: '09:30 PM' },
  address: { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const roomSchema = new mongoose.Schema({
  hostelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  roomNumber: { type: String, required: true },
  floor: { type: Number, default: 1 },
  roomType: {
    type: String,
    enum: ['single', 'double', 'triple', 'four-bed', 'dormitory', 'deluxe'],
    default: 'double',
  },
  capacity: { type: Number, required: true },
  occupants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  feePerTerm: { type: Number, default: 0 },
  amenities: [{ type: String }],
  status: {
    type: String,
    enum: ['available', 'occupied', 'maintenance', 'reserved'],
    default: 'available',
  },
  maintenanceLogs: [{
    date: { type: Date, default: Date.now },
    issue: { type: String, required: true },
    status: { type: String, enum: ['reported', 'in-progress', 'resolved'], default: 'reported' },
    notes: String,
    inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
}, { timestamps: true });

roomSchema.index({ hostelId: 1, roomNumber: 1 }, { unique: true });
roomSchema.index({ collegeId: 1 });
roomSchema.index({ collegeId: 1, status: 1 });

const Hostel = mongoose.model('Hostel', hostelSchema);
const Room = mongoose.model('Room', roomSchema);

module.exports = { Hostel, Room };
