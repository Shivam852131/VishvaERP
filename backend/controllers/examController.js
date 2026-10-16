const asyncHandler = require('../middleware/asyncHandler');
const Exam = require('../models/Exam');
const Result = require('../models/Result');
const User = require('../models/User');
const Subject = require('../models/Subject');
const { emitDataChange } = require('../utils/realtime');
const { parseSemester } = require('../utils/parseHelpers');
const { logAudit } = require('../services/auditService');
const { sendParentNotification } = require('../services/parentNotificationService');

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

    // Notify parents of results
    try {
      const studentIds = results.map((r) => r.studentId).filter(Boolean);
      const studentsWithParents = await User.find({
        _id: { $in: studentIds },
        role: 'student',
        parentId: { $exists: true, $ne: null },
      }).select('name parentId');
      for (const student of studentsWithParents) {
        const studentResult = results.find((r) => String(r.studentId) === String(student._id));
        const marks = Number(studentResult?.marksObtained ?? studentResult?.marks ?? 0);
        const total = Number(exam.totalMarks);
        sendParentNotification(student.parentId, 'results', {
          studentName: student.name,
          examName: exam.name,
          sgpa: null,
          cgpa: null,
          percentage: total > 0 ? ((marks / total) * 100).toFixed(1) : null,
        }, { link: '/pages/parent/results.html' }).catch(() => {});
      }
    } catch (e) { /* notification errors should not block results */ }

    res.json({ success: true, message: 'Results saved' });
  });

// @desc    Get student results with credit-weighted SGPA & CGPA, semester breakdowns, and radar competencies
const getStudentResults = asyncHandler(async (req, res) => {
  let studentId = req.params.studentId || req.user._id;
  if (req.user.role === 'parent' && !req.params.studentId) {
    const parent = await User.findById(req.user._id).select('children');
    let children = (parent?.children || []).map(String);
    if (!children.length) {
      const linked = await User.find({ collegeId: req.user.collegeId, role: 'student', parentId: req.user._id }).select('_id');
      children = linked.map(s => String(s._id));
    }
    studentId = req.query.studentId && children.includes(String(req.query.studentId))
      ? req.query.studentId
      : children[0];
  }

  if (!studentId) {
    return res.json({ success: true, results: [], cgpa: 'N/A' });
  }

  const student = await User.findById(studentId).select('name rollNo department semester email avatar');

  const results = await Result.find({ studentId, collegeId: req.user.collegeId })
    .populate('examId', 'name examType date totalMarks passingMarks')
    .populate('subjectId', 'name code semester credits type')
    .sort({ createdAt: -1 });

  // Group by semester
  const semesterMap = {};
  const gradeDistribution = { O: 0, 'A+': 0, A: 0, 'B+': 0, B: 0, C: 0, F: 0 };
  const subjectScores = {};

  results.forEach(r => {
    const sem = r.subjectId?.semester || (r.examId && r.examId.semester) || student?.semester || 1;
    if (!semesterMap[sem]) {
      semesterMap[sem] = {
        semester: sem,
        results: [],
        totalCredits: 0,
        earnedCredits: 0,
        weightedPoints: 0,
        sgpa: 0,
      };
    }
    semesterMap[sem].results.push(r);

    const credits = Number(r.subjectId?.credits) || 3;
    const gradePoints = Number(r.gradePoints != null ? r.gradePoints : 0);

    semesterMap[sem].totalCredits += credits;
    if (r.status === 'pass') {
      semesterMap[sem].earnedCredits += credits;
    }
    semesterMap[sem].weightedPoints += gradePoints * credits;

    // Track grade distribution
    if (r.grade && gradeDistribution[r.grade] !== undefined) {
      gradeDistribution[r.grade]++;
    }

    // Track subject percentage for competency radar
    const subName = r.subjectId?.name || 'Subject';
    if (!subjectScores[subName]) subjectScores[subName] = [];
    if (r.percentage != null) subjectScores[subName].push(r.percentage);
  });

  // Calculate SGPA per semester
  let totalCumulativeWeighted = 0;
  let totalCumulativeCredits = 0;
  let totalEarnedCredits = 0;
  const semesterList = Object.keys(semesterMap).map(Number).sort((a, b) => a - b).map(sem => {
    const s = semesterMap[sem];
    s.sgpa = s.totalCredits > 0 ? Number((s.weightedPoints / s.totalCredits).toFixed(2)) : 0;
    totalCumulativeWeighted += s.weightedPoints;
    totalCumulativeCredits += s.totalCredits;
    totalEarnedCredits += s.earnedCredits;
    return s;
  });

  const cgpa = totalCumulativeCredits > 0
    ? Number((totalCumulativeWeighted / totalCumulativeCredits).toFixed(2))
    : (results.length > 0 ? (results.reduce((acc, r) => acc + (r.gradePoints || 0), 0) / results.length).toFixed(2) : 'N/A');

  const bestSgpa = semesterList.length > 0
    ? Math.max(...semesterList.map(s => s.sgpa))
    : (cgpa !== 'N/A' ? cgpa : 0);

  // Determine Academic Standing
  let standing = 'Satisfactory';
  const numCgpa = parseFloat(cgpa);
  if (!isNaN(numCgpa)) {
    if (numCgpa >= 8.5) standing = 'First Class with Distinction';
    else if (numCgpa >= 7.0) standing = 'First Class';
    else if (numCgpa >= 6.0) standing = 'Second Class';
    else if (numCgpa >= 5.0) standing = 'Pass Class';
    else standing = 'Needs Improvement';
  }

  // Trend data for charts
  const trend = semesterList.map(s => ({
    semester: `Sem ${s.semester}`,
    sgpa: s.sgpa,
    credits: s.totalCredits,
  }));

  // Radar chart data: average percentage per subject
  const radar = Object.entries(subjectScores).map(([subject, scores]) => ({
    subject,
    score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  }));

  res.json({
    success: true,
    student,
    results,
    semesters: semesterList,
    cgpa,
    bestSgpa,
    totalCreditsEarned: totalEarnedCredits,
    totalCreditsPossible: totalCumulativeCredits,
    standing,
    trend,
    radar,
    gradeDistribution,
  });
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
    ? await Result.find({ examId: exam._id, collegeId: req.user.collegeId, subjectId }).select('studentId marksObtained totalMarks grade remarks status percentage')
    : [];

  res.json({ success: true, subject, exam, students, results });
});

// @desc    Get exam analytics: average, max, pass rate, bell curve / grade distribution
// @route   GET /api/exams/analytics
const getExamAnalytics = asyncHandler(async (req, res) => {
  const examId = req.params.examId || req.query.examId;
  const subjectId = req.query.subjectId;

  let filter = { collegeId: req.user.collegeId };
  if (examId) filter.examId = examId;
  if (subjectId) filter.subjectId = subjectId;

  if (!examId && !subjectId) {
    return res.status(400).json({ success: false, message: 'examId or subjectId is required' });
  }

  const results = await Result.find(filter)
    .populate('studentId', 'name rollNo')
    .populate('examId', 'name totalMarks passingMarks')
    .populate('subjectId', 'name code');

  const total = results.length;
  if (total === 0) {
    return res.json({
      success: true,
      total: 0,
      classAvg: 0,
      classAvgPct: 0,
      highestMark: 0,
      lowestMark: 0,
      passRate: 0,
      passCount: 0,
      failCount: 0,
      gradeDistribution: { O: 0, 'A+': 0, A: 0, 'B+': 0, B: 0, C: 0, F: 0 },
      brackets: { top: 0, average: 0, atRisk: 0 },
    });
  }

  const marks = results.map(r => Number(r.marksObtained || 0));
  const percentages = results.map(r => Number(r.percentage || 0));
  const maxMark = Math.max(...marks);
  const minMark = Math.min(...marks);
  const sumMarks = marks.reduce((a, b) => a + b, 0);
  const sumPct = percentages.reduce((a, b) => a + b, 0);
  const classAvg = Number((sumMarks / total).toFixed(1));
  const classAvgPct = Number((sumPct / total).toFixed(1));

  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = total - passCount;
  const passRate = Math.round((passCount / total) * 100);

  const gradeDistribution = { O: 0, 'A+': 0, A: 0, 'B+': 0, B: 0, C: 0, F: 0 };
  let top = 0, average = 0, atRisk = 0;

  results.forEach(r => {
    if (r.grade && gradeDistribution[r.grade] !== undefined) {
      gradeDistribution[r.grade]++;
    }
    const pct = r.percentage || 0;
    if (pct >= 80) top++;
    else if (pct >= 50) average++;
    else atRisk++;
  });

  res.json({
    success: true,
    total,
    classAvg,
    classAvgPct,
    highestMark: maxMark,
    lowestMark: minMark,
    passRate,
    passCount,
    failCount,
    gradeDistribution,
    brackets: { top, average, atRisk },
  });
});

// @desc    Download CSV template pre-populated with student roll numbers & names
// @route   GET /api/exams/template?subjectId=...
const exportExamCSVTemplate = asyncHandler(async (req, res) => {
  const { subjectId } = req.query;
  if (!subjectId) {
    return res.status(400).json({ success: false, message: 'subjectId is required' });
  }

  const subject = await Subject.findOne({ _id: subjectId, collegeId: req.user.collegeId }).populate('courseId', 'department');
  if (!subject) {
    return res.status(404).json({ success: false, message: 'Subject not found' });
  }

  const students = await User.find({
    collegeId: req.user.collegeId,
    role: 'student',
    department: subject.courseId?.department,
    semester: subject.semester,
  }).select('rollNo name').sort({ rollNo: 1 });

  let csvContent = 'roll_no,student_name,marks,remarks\n';
  students.forEach(s => {
    csvContent += `"${s.rollNo || ''}","${s.name || ''}","",""\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=grade_template_${subject.code || 'subject'}.csv`);
  res.status(200).send(csvContent);
});

module.exports = {
  createExam,
  getExams,
  addResults,
  getStudentResults,
  getResultSheet,
  getExamAnalytics,
  exportExamCSVTemplate,
};
