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
  res.status(201).json({ success: true, company, data: company });
});

const getCompanies = asyncHandler(async (req, res) => {
  const companies = await PlacementCompany.find({ collegeId: req.user.collegeId }).sort({ name: 1 });
  res.json({ success: true, companies, data: companies });
});

const getCompanyById = asyncHandler(async (req, res) => {
  const company = await PlacementCompany.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
  const jobs = await PlacementJob.find({ companyId: company._id, collegeId: req.user.collegeId });
  res.json({ success: true, company, jobs, data: company });
});

const updateCompany = asyncHandler(async (req, res) => {
  const company = await PlacementCompany.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true, runValidators: true }
  );
  if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
  res.json({ success: true, company, data: company });
});

const deleteCompany = asyncHandler(async (req, res) => {
  const company = await PlacementCompany.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
  logAudit(req, 'delete', 'placement-company', { resourceId: company._id, description: `Deleted company: ${company.name}` });
  res.json({ success: true, message: 'Company deleted successfully' });
});

const createJob = asyncHandler(async (req, res) => {
  const job = await PlacementJob.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'placement-job', { resourceId: job._id, description: `Posted job: ${job.title}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['student'], resource: 'placements', action: 'created' });
  res.status(201).json({ success: true, job, data: job });
});

const deleteJob = asyncHandler(async (req, res) => {
  const job = await PlacementJob.findOneAndDelete({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
  logAudit(req, 'delete', 'placement-job', { resourceId: job._id, description: `Deleted job: ${job.title}` });
  res.json({ success: true, message: 'Job deleted successfully' });
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
      obj.company = obj.companyId?.name || 'Company';
      return obj;
    });

    res.json({ success: true, jobs: enriched, data: enriched, total, pages: Math.ceil(total / Number(limit)) });
  } else {
    const formatted = jobs.map(j => {
      const obj = j.toObject();
      obj.company = obj.companyId?.name || 'Company';
      return obj;
    });
    res.json({ success: true, jobs: formatted, data: formatted, total, pages: Math.ceil(total / Number(limit)) });
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
  const jobId = req.params.id || req.body.jobId;
  if (!jobId) return res.status(400).json({ success: false, message: 'Job ID is required' });

  const job = await PlacementJob.findOne({ _id: jobId, collegeId: req.user.collegeId, status: 'active' });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found or not active' });
  if (job.applicationDeadline && new Date(job.applicationDeadline) < new Date()) {
    return res.status(400).json({ success: false, message: 'Application deadline passed' });
  }
  const existing = await PlacementApplication.findOne({ jobId: job._id, studentId: req.user._id });
  if (existing) return res.status(400).json({ success: false, message: 'Already applied for this position' });

  // Eligibility checking (departments, min CGPA, backlogs)
  if (job.eligibility) {
    const student = await User.findById(req.user._id).select('department cgpa semester');
    if (job.eligibility.departments && job.eligibility.departments.length > 0) {
      const matchDept = job.eligibility.departments.some(d =>
        d.toLowerCase() === (student?.department || '').toLowerCase() ||
        (student?.department || '').toLowerCase().includes(d.toLowerCase())
      );
      if (!matchDept) {
        return res.status(400).json({
          success: false,
          message: `Department not eligible for this opening. Eligible departments: ${job.eligibility.departments.join(', ')}`,
          code: 'DEPARTMENT_INELIGIBLE',
        });
      }
    }
    if (job.eligibility.minCgpa && student?.cgpa && student.cgpa < job.eligibility.minCgpa) {
      return res.status(400).json({
        success: false,
        message: `Minimum CGPA required is ${job.eligibility.minCgpa} (Current: ${student.cgpa})`,
        code: 'CGPA_INELIGIBLE',
      });
    }
  }

  let resume = req.body.resume;
  if (req.file) {
    resume = `/uploads/${req.file.filename}`;
  }

  const application = await PlacementApplication.create({
    collegeId: req.user.collegeId,
    jobId: job._id,
    studentId: req.user._id,
    resume: resume || '',
    coverLetter: req.body.coverLetter || '',
    timeline: [{ status: 'applied', note: req.body.notes || 'Application submitted', date: new Date() }],
  });

  const populated = await PlacementApplication.findById(application._id)
    .populate({
      path: 'jobId',
      select: 'title type salary salaryMin salaryMax location companyId',
      populate: { path: 'companyId', select: 'name logo industry' }
    })
    .populate('studentId', 'name rollNo department email phone');

  const obj = populated ? populated.toObject() : application.toObject();
  obj.company = obj.jobId?.companyId?.name || 'Company';
  obj.jobTitle = obj.jobId?.title || job.title;
  obj.jobType = obj.jobId?.type || job.type;
  obj.jobLocation = obj.jobId?.location || job.location || 'Campus';
  obj.appliedAt = obj.createdAt;

  logAudit(req, 'create', 'placement-application', { resourceId: application._id, description: `Applied for ${job.title}` });
  res.status(201).json({ success: true, application: obj, data: obj });
});

const getApplications = asyncHandler(async (req, res) => {
  const { jobId, status, page = 1, limit = 50 } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (req.user.role === 'student') query.studentId = req.user._id;
  if (jobId) query.jobId = jobId;
  if (status) query.status = status;
  const skip = (Number(page) - 1) * Number(limit);
  const [applications, total] = await Promise.all([
    PlacementApplication.find(query)
      .populate({
        path: 'jobId',
        select: 'title type salary salaryMin salaryMax location companyId',
        populate: { path: 'companyId', select: 'name logo industry size' }
      })
      .populate('studentId', 'name rollNo department email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    PlacementApplication.countDocuments(query),
  ]);

  const formatted = applications.map(app => {
    const obj = app.toObject();
    obj.company = obj.jobId?.companyId?.name || 'Company';
    obj.jobTitle = obj.jobId?.title || 'Position';
    obj.jobType = obj.jobId?.type || 'full-time';
    obj.jobLocation = obj.jobId?.location || 'Campus';
    obj.appliedAt = obj.createdAt;
    return obj;
  });

  res.json({ success: true, applications: formatted, data: formatted, total, pages: Math.ceil(total / Number(limit)) });
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

  res.json({ success: true, application, data: application });
});

const acceptOffer = asyncHandler(async (req, res) => {
  const application = await PlacementApplication.findOne({
    _id: req.params.id,
    studentId: req.user._id,
    collegeId: req.user.collegeId,
  }).populate('jobId', 'title companyId');
  if (!application) return res.status(404).json({ success: false, message: 'Application not found' });
  if (application.status !== 'offered' && application.status !== 'selected') {
    return res.status(400).json({ success: false, message: `Cannot accept an offer with status '${application.status}'` });
  }

  application.status = 'accepted';
  application.timeline.push({
    status: 'accepted',
    note: req.body.note || 'Offer accepted by candidate',
    date: new Date(),
  });
  await application.save();

  await PlacementJob.findByIdAndUpdate(application.jobId, { $inc: { filledPositions: 1 } });
  logAudit(req, 'update', 'placement-application', { resourceId: application._id, description: 'Accepted job offer' });
  res.json({ success: true, message: 'Offer accepted successfully', application, data: application });
});

const declineOffer = asyncHandler(async (req, res) => {
  const application = await PlacementApplication.findOne({
    _id: req.params.id,
    studentId: req.user._id,
    collegeId: req.user.collegeId,
  });
  if (!application) return res.status(404).json({ success: false, message: 'Application not found' });
  if (application.status !== 'offered' && application.status !== 'selected') {
    return res.status(400).json({ success: false, message: `Cannot decline an offer with status '${application.status}'` });
  }

  application.status = 'declined';
  application.timeline.push({
    status: 'declined',
    note: req.body.reason || req.body.note || 'Offer declined by candidate',
    date: new Date(),
  });
  await application.save();

  logAudit(req, 'update', 'placement-application', { resourceId: application._id, description: 'Declined job offer' });
  res.json({ success: true, message: 'Offer declined', application, data: application });
});

const getPlacementStats = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  const [totalJobs, activeJobs, totalApplications, byStatus, companyCount, selectedCount, internships, jobs] = await Promise.all([
    PlacementJob.countDocuments(query),
    PlacementJob.countDocuments({ ...query, status: 'active' }),
    PlacementApplication.countDocuments(query),
    PlacementApplication.aggregate([{ $match: query }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    PlacementCompany.countDocuments(query),
    PlacementApplication.countDocuments({ ...query, status: { $in: ['selected', 'offered', 'accepted'] } }),
    PlacementJob.countDocuments({ ...query, status: 'active', type: 'internship' }),
    PlacementJob.find(query).select('salaryMax salaryMin salary'),
  ]);

  let maxSalary = 0;
  let totalSalary = 0;
  let salaryCount = 0;
  jobs.forEach(j => {
    if (j.salaryMax) {
      if (j.salaryMax > maxSalary) maxSalary = j.salaryMax;
      totalSalary += j.salaryMax;
      salaryCount++;
    }
  });
  const avgSalary = salaryCount > 0 ? Math.round(totalSalary / salaryCount) : 0;

  const stats = {
    totalJobs,
    activeJobs,
    totalApplications,
    companyCount,
    selectedCount,
    internships,
    highestSalary: maxSalary,
    averageSalary: avgSalary,
    byStatus: Object.fromEntries(byStatus.map(s => [s._id, s.count])),
    selectionRate: totalApplications ? Math.round((selectedCount / totalApplications) * 100) : 0,
  };

  // If student is requesting, enrich with personal student application metrics
  if (req.user.role === 'student') {
    const studentQuery = { collegeId: req.user.collegeId, studentId: req.user._id };
    const [myApps, myInterviews, myOffers, myShortlisted] = await Promise.all([
      PlacementApplication.countDocuments(studentQuery),
      PlacementApplication.countDocuments({ ...studentQuery, status: 'interview' }),
      PlacementApplication.countDocuments({ ...studentQuery, status: { $in: ['selected', 'offered', 'accepted'] } }),
      PlacementApplication.countDocuments({ ...studentQuery, status: 'shortlisted' }),
    ]);
    stats.myApplications = myApps;
    stats.interviews = myInterviews;
    stats.myOffers = myOffers;
    stats.shortlisted = myShortlisted;
  }

  res.json({
    success: true,
    ...stats,
    stats,
    data: stats,
  });
});

const getATSScore = asyncHandler(async (req, res) => {
  const jobId = req.params.jobId || req.params.id || req.query.jobId;
  if (!jobId) return res.status(400).json({ success: false, message: 'Job ID is required' });
  const job = await PlacementJob.findOne({ _id: jobId, collegeId: req.user.collegeId }).populate('companyId', 'name');
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId: req.user._id });
  if (!profile) return res.status(400).json({ success: false, message: 'Complete your career profile first' });

  const jobSkills = (job.skills || []).map(s => s.toLowerCase());
  const studentSkills = (profile.skills || []).map(s => s.name.toLowerCase());
  const matchedSkills = jobSkills.filter(js => studentSkills.some(ss => ss.includes(js) || js.includes(ss)));
  const missingSkills = jobSkills.filter(js => !studentSkills.some(ss => ss.includes(js) || js.includes(ss)));

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
    PlacementDrive.find(query)
      .populate('companyId', 'name logo website industry')
      .populate('jobId', 'title type salary salaryMin salaryMax location')
      .sort({ driveDate: -1 })
      .skip(skip)
      .limit(Number(limit)),
    PlacementDrive.countDocuments(query),
  ]);

  const enriched = drives.map(d => {
    const obj = d.toObject();
    if (req.user && req.user.role === 'student') {
      obj.hasRegistered = (d.registeredStudents || []).some(
        s => String(s.studentId) === String(req.user._id)
      );
      obj.myRegistration = (d.registeredStudents || []).find(
        s => String(s.studentId) === String(req.user._id)
      ) || null;
    }
    obj.registeredCount = (d.registeredStudents || []).length || d.totalRegistrations || 0;
    return obj;
  });

  res.json({ success: true, drives: enriched, data: enriched, total, pages: Math.ceil(total / Number(limit)) });
});

const createDrive = asyncHandler(async (req, res) => {
  const drive = await PlacementDrive.create({ collegeId: req.user.collegeId, ...req.body });
  logAudit(req, 'create', 'placement-drive', { resourceId: drive._id, description: `Created drive: ${drive.title}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['student'], resource: 'placement-drives', action: 'created' });
  res.status(201).json({ success: true, drive, data: drive });
});

const updateDrive = asyncHandler(async (req, res) => {
  const drive = await PlacementDrive.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true }
  );
  if (!drive) return res.status(404).json({ success: false, message: 'Drive not found' });
  res.json({ success: true, drive, data: drive });
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

const registerForDrive = asyncHandler(async (req, res) => {
  const drive = await PlacementDrive.findOne({ _id: req.params.id, collegeId: req.user.collegeId, isActive: true });
  if (!drive) return res.status(404).json({ success: false, message: 'Drive not found' });

  if (drive.status === 'completed' || drive.status === 'cancelled') {
    return res.status(400).json({ success: false, message: `Drive is ${drive.status}` });
  }
  if (drive.registrationDeadline && new Date(drive.registrationDeadline) < new Date()) {
    return res.status(400).json({ success: false, message: 'Registration deadline has passed' });
  }

  const alreadyRegistered = (drive.registeredStudents || []).some(
    s => String(s.studentId) === String(req.user._id)
  );
  if (alreadyRegistered) {
    return res.status(400).json({ success: false, message: 'Already registered for this drive' });
  }

  // Eligibility check
  if (drive.eligibility) {
    const student = await User.findById(req.user._id).select('department cgpa');
    if (drive.eligibility.departments && drive.eligibility.departments.length > 0) {
      const matchDept = drive.eligibility.departments.some(d =>
        d.toLowerCase() === (student?.department || '').toLowerCase() ||
        (student?.department || '').toLowerCase().includes(d.toLowerCase())
      );
      if (!matchDept) {
        return res.status(400).json({
          success: false,
          message: `Department not eligible for this drive. Eligible: ${drive.eligibility.departments.join(', ')}`,
        });
      }
    }
  }

  drive.registeredStudents.push({
    studentId: req.user._id,
    registeredAt: new Date(),
    status: 'registered',
    currentRound: 0,
  });
  drive.totalRegistrations = drive.registeredStudents.length;
  await drive.save();

  logAudit(req, 'create', 'placement-drive-registration', { resourceId: drive._id, description: `Registered for drive: ${drive.title}` });
  res.json({ success: true, message: 'Registered for drive successfully', drive, data: drive });
});

const getDriveAttendees = asyncHandler(async (req, res) => {
  const drive = await PlacementDrive.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('registeredStudents.studentId', 'name email rollNo department phone cgpa')
    .populate('companyId', 'name logo');
  if (!drive) return res.status(404).json({ success: false, message: 'Drive not found' });
  res.json({
    success: true,
    attendees: drive.registeredStudents || [],
    data: drive.registeredStudents || [],
    total: (drive.registeredStudents || []).length,
  });
});

const updateDriveStudentStatus = asyncHandler(async (req, res) => {
  const { id, studentId } = req.params;
  const { status, currentRound, notes } = req.body;
  const drive = await PlacementDrive.findOne({ _id: id, collegeId: req.user.collegeId });
  if (!drive) return res.status(404).json({ success: false, message: 'Drive not found' });

  const record = (drive.registeredStudents || []).find(s => String(s.studentId) === String(studentId));
  if (!record) return res.status(404).json({ success: false, message: 'Student registration not found' });

  if (status) record.status = status;
  if (currentRound !== undefined) record.currentRound = Number(currentRound);
  if (notes !== undefined) record.notes = notes;

  drive.totalSelected = drive.registeredStudents.filter(s => s.status === 'selected').length;
  await drive.save();

  res.json({ success: true, message: 'Student drive status updated', record, data: record });
});

const exportDriveRoster = asyncHandler(async (req, res) => {
  const drive = await PlacementDrive.findOne({ _id: req.params.id, collegeId: req.user.collegeId })
    .populate('registeredStudents.studentId', 'name email rollNo department phone cgpa')
    .populate('companyId', 'name');
  if (!drive) return res.status(404).json({ success: false, message: 'Drive not found' });

  let csv = 'Student ID,Name,Roll Number,Department,Email,Phone,CGPA,Registration Date,Status,Current Round,Notes\n';
  const clean = (s) => `"${String(s || '').replace(/"/g, '""')}"`;

  (drive.registeredStudents || []).forEach(r => {
    const s = r.studentId || {};
    csv += [
      clean(s._id),
      clean(s.name || 'N/A'),
      clean(s.rollNo || 'N/A'),
      clean(s.department || 'N/A'),
      clean(s.email || 'N/A'),
      clean(s.phone || 'N/A'),
      clean(s.cgpa || 'N/A'),
      clean(r.registeredAt ? new Date(r.registeredAt).toISOString().slice(0, 10) : ''),
      clean(r.status || 'registered'),
      clean(r.currentRound || 0),
      clean(r.notes || '')
    ].join(',') + '\n';
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=drive-roster-${drive._id}.csv`);
  res.status(200).send(csv);
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

const exportPlacementReport = asyncHandler(async (req, res) => {
  const query = { collegeId: req.user.collegeId };
  if (req.query.status) query.status = req.query.status;
  if (req.query.jobId) query.jobId = req.query.jobId;

  const applications = await PlacementApplication.find(query)
    .populate({
      path: 'jobId',
      select: 'title type salary salaryMin salaryMax location companyId',
      populate: { path: 'companyId', select: 'name industry size' }
    })
    .populate('studentId', 'name email rollNo department phone')
    .sort({ createdAt: -1 });

  let csv = 'Application ID,Student Name,Roll Number,Department,Email,Phone,Company,Job Title,Job Type,Location,Salary Package,Status,Applied Date,Interview Date,Offer Designation,Offer CTC,Joining Date\n';

  applications.forEach(app => {
    const student = app.studentId || {};
    const job = app.jobId || {};
    const company = job.companyId || {};
    const offer = app.offerDetails || {};

    const clean = (str) => `"${String(str || '').replace(/"/g, '""')}"`;

    const appliedDate = app.createdAt ? new Date(app.createdAt).toISOString().slice(0, 10) : '';
    const interviewDate = app.interviewDate ? new Date(app.interviewDate).toISOString().slice(0, 10) : '';
    const joiningDate = offer.joiningDate ? new Date(offer.joiningDate).toISOString().slice(0, 10) : '';

    csv += [
      clean(app._id),
      clean(student.name || 'N/A'),
      clean(student.rollNo || 'N/A'),
      clean(student.department || 'N/A'),
      clean(student.email || 'N/A'),
      clean(student.phone || 'N/A'),
      clean(company.name || 'N/A'),
      clean(job.title || 'N/A'),
      clean(job.type || 'full-time'),
      clean(job.location || 'N/A'),
      clean(job.salary || (job.salaryMax ? `${job.salaryMin || 0} - ${job.salaryMax}` : 'N/A')),
      clean(app.status || 'applied'),
      clean(appliedDate),
      clean(interviewDate),
      clean(offer.designation || 'N/A'),
      clean(offer.salary || 'N/A'),
      clean(joiningDate)
    ].join(',') + '\n';
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=placement-report-${new Date().toISOString().slice(0, 10)}.csv`);
  res.status(200).send(csv);
});

module.exports = {
  createCompany, getCompanies, getCompanyById, updateCompany, deleteCompany,
  createJob, getJobs, getJobById, updateJob, deleteJob,
  applyForJob, getApplications, updateApplication, acceptOffer, declineOffer,
  getPlacementStats, getATSScore,
  getDrives, createDrive, updateDrive, deleteDrive,
  registerForDrive, getDriveAttendees, updateDriveStudentStatus, exportDriveRoster,
  bulkUpdateApplications, exportPlacementReport,
};
