/**
 * Seeds a self-contained tenant for the browser smoke test.
 * Run:  node scratch/seed_smoketest.js
 * Prints a JSON blob of tokens + ids used by the browser smoke run.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoketest-secret-2026';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const College = require(path.join(ROOT, 'backend/models/College'));
const Course = require(path.join(ROOT, 'backend/models/Course'));
const Subject = require(path.join(ROOT, 'backend/models/Subject'));
const User = require(path.join(ROOT, 'backend/models/User'));
const QuestionBank = require(path.join(ROOT, 'backend/models/QuestionBank'));
const Quiz = require(path.join(ROOT, 'backend/models/Quiz'));

const DB = process.env.SMOKE_MONGO_URI || 'mongodb://localhost:27017/vishvaerp_smoketest';

async function main() {
  await mongoose.connect(DB);
  await mongoose.connection.db.dropDatabase();

  const college = await College.create({
    name: 'Smoke Test College', code: 'SMK1', isActive: true,
    plan: 'pro', planExpiry: new Date(Date.now() + 86400000 * 30),
  });
  const course = await Course.create({
    collegeId: college._id, name: 'B.Sc Physics', code: 'BSP',
    department: 'Science', totalSemesters: 2, isActive: true,
  });
  const subject = await Subject.create({
    collegeId: college._id, courseId: course._id, name: 'Physics', code: 'PHY', semester: 1, isActive: true,
  });
  const faculty = await User.create({ name: 'Fac Tester', email: 'fac@smoke.test', role: 'faculty', collegeId: college._id, isActive: true, password: 'testpass' });
  const student = await User.create({ name: 'Stu Tester', email: 'stu@smoke.test', role: 'student', collegeId: college._id, isActive: true, password: 'testpass', rollNo: 'S1' });
  const admin = await User.create({ name: 'Adm Tester', email: 'adm@smoke.test', role: 'collegeAdmin', collegeId: college._id, isActive: true, password: 'testpass' });

  const mk = (i, opts) => ({
    collegeId: college._id, subjectId: subject._id, createdBy: faculty._id,
    unit: 'Optics', chapter: 'Basics', questionText: 'Question ' + i + ': pick the right option',
    questionType: 'mcq', options: opts, difficulty: 'easy', marks: 1, explanation: 'Because option is correct.',
    source: 'manual', educationLevel: 'undergraduate', board: 'CBSE', tags: ['smoke'],
  });
  const questions = await QuestionBank.insertMany([
    mk(1, [{ text: 'Alpha', isCorrect: true }, { text: 'Beta', isCorrect: false }, { text: 'Gamma', isCorrect: false }]),
    mk(2, [{ text: 'Alpha', isCorrect: false }, { text: 'Beta', isCorrect: true }, { text: 'Gamma', isCorrect: false }]),
    mk(3, [{ text: 'Alpha', isCorrect: false }, { text: 'Beta', isCorrect: false }, { text: 'Gamma', isCorrect: true }]),
    mk(4, [{ text: 'Alpha', isCorrect: true }, { text: 'Beta', isCorrect: false }, { text: 'Gamma', isCorrect: false }]),
    { collegeId: college._id, subjectId: subject._id, createdBy: faculty._id, unit: 'Optics', chapter: 'Basics', questionText: 'Light travels fastest in vacuum.', questionType: 'true_false', options: [], correctAnswer: 'True', difficulty: 'easy', marks: 1, explanation: 'Standard result.', source: 'manual' },
    { collegeId: college._id, subjectId: subject._id, createdBy: faculty._id, unit: 'Mechanics', chapter: 'Motion', questionText: 'Define velocity in one line.', questionType: 'short_answer', options: [], correctAnswer: 'rate of change of displacement', difficulty: 'medium', marks: 1, explanation: 'Displacement per unit time.', source: 'manual' },
  ]);

  const quiz = new Quiz({
    collegeId: college._id, createdBy: faculty._id,
    title: 'Smoke Quiz: Optics & Mechanics', description: 'A short timed quiz.',
    type: 'quiz', subjectId: subject._id, educationLevel: 'undergraduate', board: 'CBSE',
    sections: [{ name: 'Section A', questionIds: questions.map(q => q._id), marksEach: 2 }],
    settings: { duration: 30, negativeMarking: 1, maxAttempts: 2, passPercentage: 50, showResults: true, allowReview: true, shuffleQuestions: false },
    isPublished: true, isActive: true,
  });
  quiz.recomputeTotals();
  await quiz.save();

  const sign = (u) => jwt.sign({ id: u._id, role: u.role, collegeId: u.collegeId }, process.env.JWT_SECRET, { expiresIn: '2h' });
  const userObj = (u) => ({ _id: String(u._id), name: u.name, email: u.email, role: u.role, collegeId: String(u.collegeId), isActive: true });

  const out = {
    studentToken: sign(student), facultyToken: sign(faculty), adminToken: sign(admin),
    studentUser: userObj(student), facultyUser: userObj(faculty), adminUser: userObj(admin),
    quizId: String(quiz._id), subjectId: String(subject._id), collegeId: String(college._id),
    questionIds: questions.map(q => String(q._id)),
  };
  console.log(JSON.stringify(out, null, 2));
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
