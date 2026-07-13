const mongoose = require('mongoose');

const skillSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, enum: ['technical', 'soft', 'domain', 'tool', 'language', 'other'], default: 'technical' },
  level: { type: String, enum: ['beginner', 'intermediate', 'advanced', 'expert'], default: 'beginner' },
  yearsOfExperience: { type: Number, default: 0 },
  endorsedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  verified: { type: Boolean, default: false },
}, { _id: false });

const certificationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  issuer: { type: String },
  issueDate: { type: Date },
  expiryDate: { type: Date },
  credentialId: { type: String },
  credentialUrl: { type: String },
}, { _id: false });

const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  technologies: [{ type: String }],
  url: { type: String },
  githubUrl: { type: String },
  imageUrl: { type: String },
  startDate: { type: Date },
  endDate: { type: Date },
  isOngoing: { type: Boolean, default: false },
}, { _id: false });

const studentProfileSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  headline: { type: String, trim: true },
  bio: { type: String, trim: true },
  skills: [skillSchema],
  interests: [{ type: String, trim: true }],
  careerGoals: [{ type: String, trim: true }],
  certifications: [certificationSchema],
  projects: [projectSchema],
  resumeUrl: { type: String },
  linkedinUrl: { type: String },
  githubUrl: { type: String },
  portfolioUrl: { type: String },
  desiredRole: { type: String },
  desiredSalary: { type: String },
  willingToRelocate: { type: Boolean, default: true },
  preferredLocations: [{ type: String }],
  skillAssessmentScore: { type: Number, default: 0 },
  careerReadinessScore: { type: Number, default: 0 },
  profileViews: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

studentProfileSchema.index({ collegeId: 1, studentId: 1 }, { unique: true });
studentProfileSchema.index({ collegeId: 1, 'skills.name': 1 });
studentProfileSchema.index({ collegeId: 1, careerReadinessScore: -1 });

module.exports = mongoose.model('StudentProfile', studentProfileSchema);
