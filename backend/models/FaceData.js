const mongoose = require('mongoose');

const faceDataSchema = new mongoose.Schema({
  collegeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'College',
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  descriptors: [{
    type: [Number],
    required: true,
  }],
  registeredAt: {
    type: Date,
    default: Date.now,
  },
  lastVerifiedAt: {
    type: Date,
  },
  verificationCount: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  livenessVersion: {
    type: String,
    default: 'v2',
  },
  avgLivenessScore: {
    type: Number,
    default: 0,
  },
  spoofAttempts: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

faceDataSchema.index({ collegeId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('FaceData', faceDataSchema);
