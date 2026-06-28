const mongoose = require('mongoose');

const hostelSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['boys', 'girls', 'coed'], required: true },
  totalRooms: { type: Number, required: true },
  warden: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  facilities: [{ type: String }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const roomSchema = new mongoose.Schema({
  hostelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  roomNumber: { type: String, required: true },
  capacity: { type: Number, required: true },
  occupants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  feePerTerm: { type: Number, required: true }
}, { timestamps: true });

roomSchema.index({ hostelId: 1, roomNumber: 1 }, { unique: true });
roomSchema.index({ collegeId: 1 });

const Hostel = mongoose.model('Hostel', hostelSchema);
const Room = mongoose.model('Room', roomSchema);

module.exports = { Hostel, Room };
