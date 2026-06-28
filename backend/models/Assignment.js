const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  semester: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String },
  dueDate: { type: Date, required: true },
  totalMarks: { type: Number, default: 100 },
  attachments: [{ type: String }], // file paths
  isPublished: { type: Boolean, default: true },
}, { timestamps: true });

const submissionSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  submittedAt: { type: Date, default: Date.now },
  files: [{ type: String }],
  content: { type: String },
  marksObtained: { type: Number },
  feedback: { type: String },
  status: { type: String, enum: ['submitted', 'graded', 'late', 'missing'], default: 'submitted' },
}, { timestamps: true });

const Assignment = mongoose.model('Assignment', assignmentSchema);
const Submission = mongoose.model('Submission', submissionSchema);

module.exports = { Assignment, Submission };
