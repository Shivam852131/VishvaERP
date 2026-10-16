const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  marksObtained: { type: Number, required: true },
  totalMarks: { type: Number, required: true },
  percentage: { type: Number },
  grade: { type: String },
  gradePoints: { type: Number },
  status: { type: String, enum: ['pass', 'fail', 'absent', 'withheld'], default: 'pass' },
  remarks: { type: String },
  publishedAt: { type: Date },
}, { timestamps: true });

resultSchema.index({ examId: 1, studentId: 1 }, { unique: true });
resultSchema.index({ collegeId: 1, studentId: 1 });

// Auto-calculate percentage and grade before save
resultSchema.pre('save', function (next) {
  this.percentage = (this.marksObtained / this.totalMarks) * 100;
  
  const pct = this.percentage;
  if (pct >= 90) { this.grade = 'O'; this.gradePoints = 10; }
  else if (pct >= 80) { this.grade = 'A+'; this.gradePoints = 9; }
  else if (pct >= 70) { this.grade = 'A'; this.gradePoints = 8; }
  else if (pct >= 60) { this.grade = 'B+'; this.gradePoints = 7; }
  else if (pct >= 50) { this.grade = 'B'; this.gradePoints = 6; }
  else if (pct >= 40) { this.grade = 'C'; this.gradePoints = 5; }
  else { this.grade = 'F'; this.gradePoints = 0; this.status = 'fail'; }
  
  next();
});

module.exports = mongoose.model('Result', resultSchema);
