const asyncHandler = require('../middleware/asyncHandler');
const { PlacementCompany, PlacementJob, PlacementApplication } = require('../models/Placement');
const { PlacementDrive } = require('../models/PlacementDrive');
const StudentProfile = require('../models/StudentProfile');
const User = require('../models/User');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');

const createCompany = asyncHandler(async (req, res) => {
  const company = await PlacementCompany.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'placement-company', { resourceId: company._id, description: `Added company: ${company.name}` });
  res.status(201).json({ success: true, company });
});

const getCompanies = asyncHandler(async (req, res) => {
  const companies = await PlacementCompany.find({ collegeId: req.user.collegeId }).sort({ name: 1 });
  res.json({ success: true, companies });
});

const createJob = asyncHandler(async (req, res) => {
  const job = await PlacementJob.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'placement-job', { resourceId: job._id, description: `Posted job: ${job.title}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['student'], resource: 'placements', action: 'created' });
  res.status(201).json({ success: true, job });
});

const getJobs = asyncHandler(async (req, res) => {
  const { status, type, search, sortBy = 'newest', page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (status) query.status = status;
  if (type) query.type = type;
  if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];

  let sortObj = { createdAt: -1 };
  if (sortBy === 'salary') sortObj = { salaryMax: -1 };
  else if (sortBy === 'deadline') sortObj = { applicationDeadline: 1 };

  const skip = (Number(page) - 1) * Number(limit);
  const [jobs, total] = await Promise.all([
    PlacementJob.find(query).populate('companyId', 'name logo industry').sort(sortObj).skip(skip).limit(Number(limit)),
    PlacementJob.countDocuments(query),
  ]);

  if (req.user.role === 'student') {
    const profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId: req.user._id });
    const studentSkills = (profile?.skills || []).map(s => s.name.toLowerCase());

    const enriched = jobs.map(job => {
      const obj = job.toObject();
      const jobSkills = (job.skills || []).map(s => s.toLowerCase());
      const matched = jobSkills.filter(js => studentSkills.some(ss => ss.includes(js) || js.includes(ss)));
      obj.matchPercent = jobSkills.length > 0 ? Math.round((matched.length / jobSkills.length) * 100) : 0;
      obj.matchedSkills = matched;
      return obj;
    });

    res.json({ success: true, jobs: enriched, total, pages: Math.ceil(total / Number(limit)) });
  } else {
    res.json({ success: true, jobs, total, pages: Math.ceil(total / Number(limit)) });
  }
});

const getJobById = asyncHandler(async (req, res) => {
  const job = await PlacementJob.findOne({ _id: req.params.id, collegeId: req.user.collegeId }).populate('companyId', 'name logo industry website size');
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
  const applicationCount = await PlacementApplication.countDocuments({ jobId: job._id, collegeId: req.user.collegeId });

  let matchInfo = null;
  if (req.user.role === 'student') {
    const profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId: req.user._id });
    const studentSkills = (profile?.skills || []).map(s => s.name.toLowerCase());
    const jobSkills = (job.skills || []).map(s => s.toLowerCase());
    const matched = jobSkills.filter(js => studentSkills.some(ss => ss.includes(js) || js.includes(ss)));
    const missing = jobSkills.filter(js => !studentSkills.some(ss => ss.includes(js) || js.includes(ss)));
    matchInfo = {
      matchPercent: jobSkills.length > 0 ? Math.round((matched.length / jobSkills.length) * 100) : 0,
      matchedSkills: matched,
      missingSkills: missing,
    };
  }

  res.json({ success: true, job, applicationCount, matchInfo });
});

const updateJob = asyncHandler(async (req, res) => {
  const job = await PlacementJob.findOneAndUpdate({ _id: req.params.id, collegeId: req.user.collegeId }, req.body, { new: true });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
  res.json({ success: true, job });
});

const applyForJob = asyncHandler(async (req, res) => {
  const job = await PlacementJob.findOne({ _id: req.params.id, collegeId: req.user.collegeId, status: 'active' });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found or not active' });
  if (job.applicationDeadline && new Date(job.applicationDeadline) < new Date()) {
    return res.status(400).json({ success: false, message: 'Application deadline passed' });
  }
  const existing = await PlacementApplication.findOne({ jobId: job._id, studentId: req.user._id });
  if (existing) return res.status(400).json({ success: false, message: 'Already applied' });
  const application = await PlacementApplication.create({
    collegeId: req.user.collegeId, jobId: job._id, studentId: req.user._id,
    resume: req.body.resume, coverLetter: req.body.coverLetter,
    timeline: [{ status: 'applied' }],
  });
  res.status(201).json({ success: true, application });
});

const getApplications = asyncHandler(async (req, res) => {
  const { jobId, status, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (req.user.role === 'student') query.studentId = req.user._id;
  if (jobId) query.jobId = jobId;
  if (status) query.status = status;
  const skip = (Number(page) - 1) * Number(limit);
  const [applications, total] = await Promise.all([
    PlacementApplication.find(query).populate('jobId', 'title type salary').populate('studentId', 'name rollNo department').populate('companyId', 'name').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    PlacementApplication.countDocuments(query),
  ]);
  res.json({ success: true, applications, total, pages: Math.ceil(total / Number(limit)) });
});

const updateApplication = asyncHandler(async (req, res) => {
  const application = await PlacementApplication.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!application) return res.status(404).json({ success: false, message: 'Application not found' });
  const { status, interviewDate, interviewFeedback, offerDetails, note } = req.body;
  if (status) {
    application.status = status;
    application.timeline.push({ status, note });
  }
  if (interviewDate) application.interviewDate = interviewDate;
  if (interviewFeedback) application.interviewFeedback = interviewFeedback;
  if (offerDetails) application.offerDetails = offerDetails;
  await application.save();

  if (req.io) {
    req.io.to(`user:${application.studentId}`).emit('application_update', {
      applicationId: application._id,
      jobId: application.jobId,
      status: application.status,
      message: note || `Your application status updated to ${status}`,
    });
  }

  res.json({ success: true, application });
});

const getPlacementStats = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  const [totalJobs, activeJobs, totalApplications, byStatus, companyCount, selectedCount] = await Promise.all([
    PlacementJob.countDocuments(query),
    PlacementJob.countDocuments({ ...query, status: 'active' }),
    PlacementApplication.countDocuments(query),
    PlacementApplication.aggregate([{ $match: query }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    PlacementCompany.countDocuments(query),
    PlacementApplication.countDocuments({ ...query, status: { $in: ['selected', 'offered', 'accepted'] } }),
  ]);
  res.json({
    success: true,
    totalJobs, activeJobs, totalApplications, companyCount, selectedCount,
    byStatus: Object.fromEntries(byStatus.map(s => [s._id, s.count])),
    selectionRate: totalApplications ? Math.round((selectedCount / totalApplications) * 100) : 0,
  });
});

const getATSScore = asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = await PlacementJob.findOne({ _id: jobId, collegeId: req.user.collegeId }).populate('companyId', 'name');
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId: req.user._id });
  if (!profile) return res.status(400).json({ success: false, message: 'Complete your career profile first' });

  const jobSkills = (job.skills || []).map(s => s.toLowerCase());
  const studentSkills = (profile.skills || []).map(s => s.name.toLowerCase());
  const matchedSkills = jobSkills.filter(js => studentSkills.some(ss => ss.includes(js) || js.includes(ss)));
  const missingSkills = jobSkills.filter(js => !studentSkills.some(ss => ss.includes(js) || js.includes(js)));

  const skillScore = jobSkills.length > 0 ? Math.round((matchedSkills.length / jobSkills.length) * 100) : 0;

  let experienceScore = 0;
  if ((profile.projects || []).length >= 2) experienceScore += 40;
  else if ((profile.projects || []).length >= 1) experienceScore += 20;
  if ((profile.certifications || []).length >= 1) experienceScore += 30;
  if (profile.resumeUrl) experienceScore += 20;
  if (profile.linkedinUrl) experienceScore += 5;
  if (profile.githubUrl) experienceScore += 5;
  experienceScore = Math.min(100, experienceScore);

  let eligibilityScore = 100;
  if (job.eligibility) {
    if (job.eligibility.minCgpa) {
      const cgpa = profile.skillAssessmentScore ? Math.round(profile.skillAssessmentScore / 10 * 10) / 10 : 0;
      if (cgpa < job.eligibility.minCgpa) eligibilityScore -= 50;
    }
    if (job.eligibility.departments && job.eligibility.departments.length > 0) {
      const user = await User.findById(req.user._id).select('department');
      if (user && !job.eligibility.departments.includes(user.department)) eligibilityScore -= 30;
    }
  }
  eligibilityScore = Math.max(0, eligibilityScore);

  const overallScore = Math.round(skillScore * 0.5 + experienceScore * 0.3 + eligibilityScore * 0.2);

  res.json({
    success: true,
    ats: {
      overallScore,
      skillScore,
      experienceScore,
      eligibilityScore,
      matchedSkills,
      missingSkills,
      recommendations: generateATSRecommendations(missingSkills, profile, job),
    },
  });
});

function generateATSRecommendations(missingSkills, profile, job) {
  const recs = [];
  if (missingSkills.length > 0) {
    recs.push({ type: 'skill', message: `Consider learning: ${missingSkills.join(', ')}`, priority: 'high' });
  }
  if (!profile.resumeUrl) {
    recs.push({ type: 'resume', message: 'Upload a resume to improve your application', priority: 'high' });
  }
  if ((profile.projects || []).length < 2) {
    recs.push({ type: 'project', message: 'Add more projects to demonstrate practical skills', priority: 'medium' });
  }
  if ((profile.certifications || []).length === 0) {
    recs.push({ type: 'certification', message: 'Certifications can boost your credibility', priority: 'low' });
  }
  return recs;
}

const getDrives = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };
  if (status) query.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [drives, total] = await Promise.all([
    PlacementDrive.find(query).populate('companyId', 'name logo').populate('jobId', 'title type').sort({ driveDate: -1 }).skip(skip).limit(Number(limit)),
    PlacementDrive.countDocuments(query),
  ]);
  res.json({ success: true, drives, total, pages: Math.ceil(total / Number(limit)) });
});

const createDrive = asyncHandler(async (req, res) => {
  const drive = await PlacementDrive.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'placement-drive', { resourceId: drive._id, description: `Created drive: ${drive.title}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['student'], resource: 'placement-drives', action: 'created' });
  res.status(201).json({ success: true, drive });
});

const updateDrive = asyncHandler(async (req, res) => {
  const drive = await PlacementDrive.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true }
  );
  if (!drive) return res.status(404).json({ success: false, message: 'Drive not found' });
  res.json({ success: true, drive });
});

const deleteDrive = asyncHandler(async (req, res) => {
  const drive = await PlacementDrive.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    { isActive: false },
    { new: true }
  );
  if (!drive) return res.status(404).json({ success: false, message: 'Drive not found' });
  logAudit(req, 'delete', 'placement-drive', { resourceId: drive._id, description: `Deleted drive: ${drive.title}` });
  res.json({ success: true, message: 'Drive deleted' });
});

const bulkUpdateApplications = asyncHandler(async (req, res) => {
  const { applicationIds, status, note } = req.body;
  if (!applicationIds || !applicationIds.length || !status) {
    return res.status(400).json({ success: false, message: 'applicationIds and status are required' });
  }

  const result = await PlacementApplication.updateMany(
    { _id: { $in: applicationIds }, collegeId: req.user.collegeId },
    {
      $set: { status },
      $push: { timeline: { status, note: note || `Bulk status update to ${status}` } },
    }
  );

  if (req.io) {
    applicationIds.forEach(async (appId) => {
      const app = await PlacementApplication.findById(appId).select('studentId');
      if (app) {
        req.io.to(`user:${app.studentId}`).emit('application_update', {
          applicationId: appId,
          status,
          message: note || `Your application status updated to ${status}`,
        });
      }
    });
  }

  res.json({ success: true, updated: result.modifiedCount });
});

module.exports = {
  createCompany, getCompanies, createJob, getJobs, getJobById, updateJob,
  applyForJob, getApplications, updateApplication, getPlacementStats,
  getATSScore, getDrives, createDrive, updateDrive, deleteDrive, bulkUpdateApplications,
};
