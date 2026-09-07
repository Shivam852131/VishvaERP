const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  semester: { type: Number, required: true },
  examType: { type: String, enum: ['internal', 'midterm', 'final', 'quiz', 'practical'], default: 'internal' },
  date: { type: Date, required: true },
  startTime: { type: String },
  duration: { type: Number }, // minutes
  totalMarks: { type: Number, required: true },
  passingMarks: { type: Number, required: true },
  venue: { type: String },
  instructions: { type: String },
  isPublished: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Exam', examSchema);
