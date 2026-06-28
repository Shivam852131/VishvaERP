const asyncHandler = require('../middleware/asyncHandler');
const Fee = require('../models/Fee');
const User = require('../models/User');
const College = require('../models/College');
const Exam = require('../models/Exam');
const Result = require('../models/Result');
const Subject = require('../models/Subject');
const { generateFeeReceipt, generateResultSheet, generateIdCard } = require('../services/pdfService');
const { sendFeeReceiptEmail } = require('../services/emailService');

const downloadFeeReceipt = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne({ _id: req.params.id, collegeId: req.user.collegeId }).populate('studentId');
  if (!fee) {
    return res.status(404).json({ success: false, message: 'Fee record not found' });
  }

  const user = fee.studentId || await User.findById(fee.studentId);
  const college = await College.findById(req.user.collegeId);

  const pdf = await generateFeeReceipt(fee, user, college);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=receipt-${fee.receiptNo || fee._id}.pdf`);
  res.send(pdf);
});

const emailFeeReceipt = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne({ _id: req.params.id, collegeId: req.user.collegeId }).populate('studentId');
  if (!fee) {
    return res.status(404).json({ success: false, message: 'Fee record not found' });
  }

  const user = fee.studentId;
  const college = await College.findById(req.user.collegeId);
  const pdf = await generateFeeReceipt(fee, user, college);

  const result = await sendFeeReceiptEmail(user.email, user.name, fee, pdf);
  if (result.skipped) {
    return res.status(200).json({ success: true, message: 'Email service not configured. Receipt generated but not sent.' });
  }

  res.json({ success: true, message: 'Receipt sent to student email' });
});

const downloadResultSheet = asyncHandler(async (req, res) => {
  const { examId } = req.params;

  const exam = await Exam.findOne({ _id: examId, collegeId: req.user.collegeId });
  if (!exam) {
    return res.status(404).json({ success: false, message: 'Exam not found' });
  }

  const subject = await Subject.findOne({ _id: exam.subjectId, collegeId: req.user.collegeId }).populate('courseId', 'department');
  const students = await User.find({
    collegeId: req.user.collegeId,
    role: 'student',
    ...(subject?.courseId?.department ? { department: subject.courseId.department } : {}),
    ...(exam.semester ? { semester: exam.semester } : {}),
  }).select('name email rollNo department semester').sort({ rollNo: 1 });

  const results = await Result.find({ examId: exam._id, collegeId: req.user.collegeId }).select('studentId marksObtained totalMarks grade status');

  const pdf = await generateResultSheet(exam, subject, students, results);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=results-${exam.name.replace(/\s+/g, '-')}.pdf`);
  res.send(pdf);
});

const downloadIdCard = asyncHandler(async (req, res) => {
  const userId = req.params.userId || req.user._id;

  if (userId !== req.user._id.toString() && !['superadmin', 'collegeAdmin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Not authorized to download ID card for this user' });
  }

  const user = await User.findById(userId).select('-password');
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (req.user.role === 'collegeAdmin' && user.collegeId?.toString() !== req.user.collegeId?.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized: user belongs to a different college' });
  }

  const college = user.collegeId ? await College.findById(user.collegeId) : null;
  const pdf = await generateIdCard(user, college);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=idcard-${user.name.replace(/\s+/g, '-')}.pdf`);
  res.send(pdf);
});

module.exports = { downloadFeeReceipt, emailFeeReceipt, downloadResultSheet, downloadIdCard };
