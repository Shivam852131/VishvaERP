const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true, index: true },
  visitorName: { type: String, required: true, trim: true },
  visitorPhone: { type: String, trim: true },
  visitorEmail: { type: String, trim: true, lowercase: true },
  visitorPhoto: { type: String },
  idType: { type: String, enum: ['aadhaar', 'pan', 'driving_license', 'voter_id', 'passport', 'other'], default: 'aadhaar' },
  idNumber: { type: String, trim: true },
  purpose: { type: String, required: true, trim: true },
  category: { type: String, enum: ['parent', 'vendor', 'contractor', 'interviewee', 'guest', 'delivery', 'other'], default: 'other' },
  hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hostName: { type: String, trim: true },
  department: { type: String, trim: true },
  meetingRoom: { type: String, trim: true },
  vehicleNumber: { type: String, trim: true },
  vehicleType: { type: String, enum: ['car', 'bike', 'auto', 'bus', 'truck', 'other', 'none'], default: 'none' },
  itemsCarried: { type: String, trim: true },
  checkInTime: { type: Date, default: Date.now },
  checkOutTime: { type: Date },
  expectedDuration: { type: String, trim: true },
  status: { type: String, enum: ['checked-in', 'checked-out', 'cancelled', 'pre-registered'], default: 'checked-in' },
  gatePass: { type: String, unique: true, sparse: true },
  badgeNumber: { type: String },
  securityNotes: { type: String, trim: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isBlacklisted: { type: Boolean, default: false },
  blacklistReason: { type: String, trim: true },
  feedback: { type: String, trim: true },
  rating: { type: Number, min: 1, max: 5 },
}, { timestamps: true });

visitorSchema.index({ collegeId: 1, status: 1 });
visitorSchema.index({ collegeId: 1, checkInTime: -1 });
visitorSchema.index({ collegeId: 1, hostUserId: 1 });

visitorSchema.pre('save', function (next) {
  if (!this.gatePass) {
    this.gatePass = `VIS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('Visitor', visitorSchema);
