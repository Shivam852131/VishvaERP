const mongoose = require('mongoose');

const alumniSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  graduationYear: { type: Number, required: true },
  department: { type: String },
  course: { type: String },
  rollNo: { type: String },
  currentCompany: { type: String },
  designation: { type: String },
  location: { type: String },
  linkedin: { type: String },
  achievements: [String],
  isMentor: { type: Boolean, default: false },
  isAvailableForMentoring: { type: Boolean, default: false },
  batch: { type: String },
  profileImage: { type: String },
  bio: { type: String },
}, { timestamps: true });

const alumniEventSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  title: { type: String, required: true },
  description: { type: String },
  date: { type: Date, required: true },
  venue: { type: String },
  type: { type: String, enum: ['reunion', 'webinar', 'meetup', 'workshop', 'other'], default: 'reunion' },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  attendees: [{
    alumniId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alumni' },
    status: { type: String, enum: ['registered', 'attended', 'cancelled'], default: 'registered' },
  }],
  maxAttendees: { type: Number },
  isVirtual: { type: Boolean, default: false },
  meetingLink: { type: String },
}, { timestamps: true });

const alumniDonationSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  alumniId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alumni', required: true },
  amount: { type: Number, required: true },
  purpose: { type: String, required: true },
  category: { type: String, enum: ['scholarship', 'infrastructure', 'research', 'general', 'other'], default: 'general' },
  paymentMethod: { type: String, enum: ['cash', 'online', 'cheque', 'dd'], default: 'online' },
  transactionId: { type: String },
  receiptNo: { type: String },
  status: { type: String, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'pending' },
  remarks: { type: String },
}, { timestamps: true });

alumniSchema.index({ collegeId: 1, graduationYear: 1 });
alumniSchema.index({ collegeId: 1, department: 1 });
alumniEventSchema.index({ collegeId: 1, date: 1 });
alumniDonationSchema.index({ collegeId: 1, alumniId: 1 });

module.exports = {
  Alumni: mongoose.model('Alumni', alumniSchema),
  AlumniEvent: mongoose.model('AlumniEvent', alumniEventSchema),
  AlumniDonation: mongoose.model('AlumniDonation', alumniDonationSchema),
};
