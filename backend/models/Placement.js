const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true },
  industry: { type: String },
  website: { type: String },
  email: { type: String },
  phone: { type: String },
  address: { type: String },
  logo: { type: String },
  description: { type: String },
  size: { type: String, enum: ['startup', 'small', 'medium', 'large', 'enterprise'] },
  isVerified: { type: Boolean, default: false },
}, { timestamps: true });

const jobSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementCompany', required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  type: { type: String, enum: ['full-time', 'part-time', 'internship', 'contract', 'freelance'], required: true },
  location: { type: String },
  isRemote: { type: Boolean, default: false },
  salary: { type: String },
  salaryMin: { type: Number },
  salaryMax: { type: Number },
  currency: { type: String, default: 'INR' },
  eligibility: {
    departments: [String],
    minCgpa: { type: Number },
    minPercentage: { type: Number },
    backlogsAllowed: { type: Number, default: 0 },
    yearOfPassing: [Number],
  },
  skills: [String],
  applicationDeadline: { type: Date },
  driveDate: { type: Date },
  totalPositions: { type: Number },
  filledPositions: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'active', 'closed', 'cancelled'], default: 'active' },
  attachments: [{ type: String }],
}, { timestamps: true });

const applicationSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementJob', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['applied', 'shortlisted', 'interview', 'selected', 'rejected', 'offered', 'accepted', 'declined'], default: 'applied' },
  resume: { type: String },
  coverLetter: { type: String },
  notes: { type: String },
  interviewDate: { type: Date },
  interviewFeedback: { type: String },
  offerDetails: {
    salary: { type: String },
    designation: { type: String },
    joiningDate: { type: Date },
    location: { type: String },
  },
  timeline: [{
    status: { type: String },
    date: { type: Date, default: Date.now },
    note: { type: String },
  }],
}, { timestamps: true });

applicationSchema.index({ collegeId: 1, jobId: 1, studentId: 1 }, { unique: true });
applicationSchema.index({ collegeId: 1, studentId: 1 });
jobSchema.index({ collegeId: 1, status: 1 });
companySchema.index({ collegeId: 1, name: 1 });

module.exports = {
  PlacementCompany: mongoose.model('PlacementCompany', companySchema),
  PlacementJob: mongoose.model('PlacementJob', jobSchema),
  PlacementApplication: mongoose.model('PlacementApplication', applicationSchema),
};
