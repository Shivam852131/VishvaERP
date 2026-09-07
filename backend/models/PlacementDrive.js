const mongoose = require('mongoose');

const placementDriveSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementCompany', required: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementJob', required: true },
  title: { type: String, required: true },
  description: { type: String },
  driveDate: { type: Date, required: true },
  registrationDeadline: { type: Date },
  venue: { type: String },
  mode: { type: String, enum: ['offline', 'online', 'hybrid'], default: 'offline' },
  eligibility: {
    departments: [{ type: String }],
    minCgpa: { type: Number },
    minPercentage: { type: Number },
    maxBacklogs: { type: Number, default: 0 },
    yearOfPassing: [Number],
  },
  rounds: [{
    name: String,
    type: { type: String, enum: ['aptitude', 'technical', 'group_discussion', 'interview', 'hr', 'coding', 'case_study', 'other'] },
    date: Date,
    duration: Number,
    venue: String,
    description: String,
    resultDate: Date,
  }],
  totalRegistrations: { type: Number, default: 0 },
  totalSelected: { type: Number, default: 0 },
  status: { type: String, enum: ['upcoming', 'ongoing', 'completed', 'cancelled'], default: 'upcoming' },
  attachments: [{ type: String }],
  notes: { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

placementDriveSchema.index({ collegeId: 1, driveDate: -1 });
placementDriveSchema.index({ collegeId: 1, status: 1 });

const PlacementDrive = mongoose.model('PlacementDrive', placementDriveSchema);

module.exports = { PlacementDrive };
