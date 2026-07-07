const asyncHandler = require('../middleware/asyncHandler');
const { PlacementCompany, PlacementJob, PlacementApplication } = require('../models/Placement');
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
  const { status, type, search, page = 1, limit = 20 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (status) query.status = status;
  if (type) query.type = type;
  if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
  const skip = (Number(page) - 1) * Number(limit);
  const [jobs, total] = await Promise.all([
    PlacementJob.find(query).populate('companyId', 'name logo industry').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    PlacementJob.countDocuments(query),
  ]);
  res.json({ success: true, jobs, total, pages: Math.ceil(total / Number(limit)) });
});

const getJobById = asyncHandler(async (req, res) => {
  const job = await PlacementJob.findOne({ _id: req.params.id, collegeId: req.user.collegeId }).populate('companyId', 'name logo industry website size');
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
  const applicationCount = await PlacementApplication.countDocuments({ jobId: job._id, collegeId: req.user.collegeId });
  res.json({ success: true, job, applicationCount });
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

module.exports = { createCompany, getCompanies, createJob, getJobs, getJobById, updateJob, applyForJob, getApplications, updateApplication, getPlacementStats };
