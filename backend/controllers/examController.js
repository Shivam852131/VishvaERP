const asyncHandler = require('../middleware/asyncHandler');
const Exam = require('../models/Exam');
const Result = require('../models/Result');
const User = require('../models/User');
const Subject = require('../models/Subject');
const { emitDataChange } = require('../utils/realtime');
const { parseSemester } = require('../utils/parseHelpers');
const { logAudit } = require('../services/auditService');

const calculateResultFields = (marksObtained, totalMarks) => {
    const percentage = totalMarks > 0 ? Number(((marksObtained / totalMarks) * 100).toFixed(2)) : 0;

    if (percentage >= 90) return { percentage, grade: 'O', gradePoints: 10, status: 'pass' };
    if (percentage >= 80) return { percentage, grade: 'A+', gradePoints: 9, status: 'pass' };
    if (percentage >= 70) return { percentage, grade: 'A', gradePoints: 8, status: 'pass' };
    if (percentage >= 60) return { percentage, grade: 'B+', gradePoints: 7, status: 'pass' };
    if (percentage >= 50) return { percentage, grade: 'B', gradePoints: 6, status: 'pass' };
    if (percentage >= 40) return { percentage, grade: 'C', gradePoints: 5, status: 'pass' };
    return { percentage, grade: 'F', gradePoints: 0, status: 'fail' };
  };

async function resolveSubject(collegeId, payload) {
    if (payload.subjectId) {
      return Subject.findOne({ _id: payload.subjectId, collegeId });
    }

    if (!payload.subject && !payload.subjectName) {
      return null;
    }

    return Subject.findOne({
      collegeId,
      $or: [
        { name: { $regex: payload.subject || payload.subjectName, $options: 'i' } },
        { code: { $regex: payload.subject || payload.subjectName, $options: 'i' } },
      ],
      ...(parseSemester(payload.semester || payload.batch) ? { semester: parseSemester(payload.semester || payload.batch) } : {}),
    });
  }

// @desc    Create exam
const createExam = asyncHandler(async (req, res) => {
    const subject = await resolveSubject(req.user.collegeId, req.body);
    if (!subject && !req.body.subjectId) {
      return res.status(400).json({ success: false, message: 'Valid subject is required' });
    }

    const exam = await Exam.create({
      collegeId: req.user.collegeId,
      name: req.body.name || req.body.examName,
      subjectId: subject?._id || req.body.subjectId,
      courseId: subject?.courseId || req.body.courseId,
      semester: parseSemester(req.body.semester || req.body.batch) || subject?.semester,
      examType: req.body.examType || 'internal',
      date: req.body.date,
      startTime: req.body.startTime || req.body.time,
      duration: req.body.duration,
      totalMarks: req.body.totalMarks || req.body.maxMarks,
      passingMarks: req.body.passingMarks || Math.ceil((req.body.totalMarks || req.body.maxMarks || 0) * 0.4),
      venue: req.body.venue || req.body.room,
      instructions: req.body.instructions,
      isPublished: req.body.isPublished || false,
    });

    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'exams', action: 'created' });
    logAudit(req, 'create', 'exam', { resourceId: exam._id, description: `Created exam: ${exam.name}`, metadata: { subjectId: exam.subjectId } });
    res.status(201).json({ success: true, message: 'Exam created', exam });
  });

// @desc    Get exams
const getExams = asyncHandler(async (req, res) => {
    const { semester, courseId, examType } = req.query;
    const query = { collegeId: req.user.collegeId };
    if (semester) query.semester = parseInt(semester);
    if (courseId) query.courseId = courseId;
    if (examType) query.examType = examType;

    const exams = await Exam.find(query)
      .populate('subjectId', 'name code')
      .populate('courseId', 'name code')
      .sort({ date: -1 });

    res.json({ success: true, exams });
  });

// @desc    Add/update results (bulk)
const addResults = asyncHandler(async (req, res) => {
    const { results = [] } = req.body;
    let exam = req.body.examId ? await Exam.findById(req.body.examId) : null;

    if (!exam) {
      const subject = await resolveSubject(req.user.collegeId, req.body);
      if (!subject) {
        return res.status(400).json({ success: false, message: 'Exam or subject is required' });
      }

      exam = await Exam.create({
        collegeId: req.user.collegeId,
        name: req.body.examName || req.body.name || req.body.examType || 'Assessment',
        subjectId: subject._id,
        courseId: subject.courseId,
        semester: parseSemester(req.body.semester || req.body.batch) || subject.semester,
        examType: req.body.examType || 'internal',
        date: req.body.date || new Date(),
        startTime: req.body.startTime || req.body.time,
        duration: req.body.duration,
        totalMarks: req.body.totalMarks || req.body.maxMarks || 50,
        passingMarks: req.body.passingMarks || Math.ceil((req.body.totalMarks || req.body.maxMarks || 50) * 0.4),
        venue: req.body.venue || req.body.room,
        isPublished: true,
      });
    }

    const students = await User.find({
      collegeId: req.user.collegeId,
      role: 'student',
      $or: [
        { _id: { $in: results.map((result) => result.studentId).filter(Boolean) } },
        { rollNo: { $in: results.map((result) => result.rollNo || result.roll).filter(Boolean) } },
      ],
    }).select('_id rollNo');
    const studentMap = new Map(students.map((student) => [String(student._id), student]));
    students.forEach((student) => studentMap.set(student.rollNo, student));

    const invalidEntry = results.find((entry) => {
      const marksObtained = Number(entry.marksObtained ?? entry.marks ?? 0);
      const totalMarks = Number(exam.totalMarks);
      return Number.isNaN(marksObtained) || marksObtained < 0 || marksObtained > totalMarks;
    });

    if (invalidEntry) {
      return res.status(400).json({
        success: false,
        message: `Marks must be between 0 and ${exam.totalMarks} for every student`,
      });
    }

    const operations = results.map(r => {
      const student = studentMap.get(String(r.studentId)) || studentMap.get(r.rollNo || r.roll);
      const marksObtained = Number(r.marksObtained ?? r.marks ?? 0);
      const totalMarks = Number(exam.totalMarks);
      const derived = calculateResultFields(marksObtained, totalMarks);

      return {
        updateOne: {
          filter: { examId: exam._id, studentId: student?._id, collegeId: req.user.collegeId },
          update: { $set: {
            marksObtained,
            totalMarks,
            subjectId: exam.subjectId,
            collegeId: req.user.collegeId,
            publishedAt: new Date(),
            remarks: r.remarks || '',
            percentage: derived.percentage,
            grade: derived.grade,
            gradePoints: derived.gradePoints,
            status: derived.status,
          } },
          upsert: true,
        },
      };
    });

    if (operations.some((operation) => !operation.updateOne.filter.studentId)) {
      return res.status(400).json({ success: false, message: 'Some students could not be resolved from the submitted results' });
    }

    await Result.bulkWrite(operations);
    logAudit(req, 'create', 'exam_result', { description: `Added ${results.length} results for exam`, metadata: { examId: exam._id } });
    emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['superadmin'], resource: 'results', action: 'saved' });
    res.json({ success: true, message: 'Results saved' });
  });

// @desc    Get student results
const getStudentResults = asyncHandler(async (req, res) => {
    let studentId = req.params.studentId || req.user._id;
    if (req.user.role === 'parent' && !req.params.studentId) {
      const parent = await User.findById(req.user._id).select('children');
      studentId = parent?.children?.[0];
    }

    if (!studentId) {
      return res.json({ success: true, results: [], cgpa: 'N/A' });
    }

    const results = await Result.find({ studentId, collegeId: req.user.collegeId })
      .populate('examId', 'name examType date')
      .populate('subjectId', 'name code semester credits')
      .sort({ createdAt: -1 });

    // Calculate CGPA
    const gradedResults = results.filter(r => r.gradePoints !== undefined);
    const cgpa = gradedResults.length > 0
      ? (gradedResults.reduce((sum, r) => sum + r.gradePoints, 0) / gradedResults.length).toFixed(2)
      : 'N/A';

    res.json({ success: true, results, cgpa });
  });

const getResultSheet = asyncHandler(async (req, res) => {
    const { subjectId, examId, examName } = req.query;

    if (!subjectId) {
      return res.status(400).json({ success: false, message: 'Subject is required' });
    }

    const subject = await Subject.findOne({ _id: subjectId, collegeId: req.user.collegeId }).populate('courseId', 'department name code');
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    const students = await User.find({
      collegeId: req.user.collegeId,
      role: 'student',
      department: subject.courseId?.department,
      semester: subject.semester,
    }).select('name email rollNo department semester').sort({ rollNo: 1, name: 1 });

    let exam = null;
    if (examId) {
      exam = await Exam.findOne({ _id: examId, collegeId: req.user.collegeId, subjectId });
    } else if (examName) {
      exam = await Exam.findOne({
        collegeId: req.user.collegeId,
        subjectId,
        name: { $regex: `^${examName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      }).sort({ createdAt: -1 });
    }

    const results = exam
      ? await Result.find({ examId: exam._id, collegeId: req.user.collegeId, subjectId }).select('studentId marksObtained totalMarks grade remarks')
      : [];

    res.json({ success: true, subject, exam, students, results });
  });

module.exports = { createExam, getExams, addResults, getStudentResults, getResultSheet };
