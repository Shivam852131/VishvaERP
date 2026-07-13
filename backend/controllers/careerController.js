const asyncHandler = require('../middleware/asyncHandler');
const StudentProfile = require('../models/StudentProfile');
const User = require('../models/User');
const PlacementJob = require('../models/Placement');
const Result = require('../models/Result');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');

const getMyProfile = asyncHandler(async (req, res) => {
  let profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId: req.user._id })
    .populate('skills.endorsedBy', 'name');
  if (!profile) {
    profile = await StudentProfile.create({
      collegeId: req.user.collegeId,
      studentId: req.user._id,
      skills: [],
      interests: [],
      careerGoals: [],
      certifications: [],
      projects: [],
    });
  }
  res.json({ success: true, profile });
});

const updateMyProfile = asyncHandler(async (req, res) => {
  const allowed = ['headline', 'bio', 'interests', 'careerGoals', 'certifications', 'projects',
    'resumeUrl', 'linkedinUrl', 'githubUrl', 'portfolioUrl', 'desiredRole',
    'desiredSalary', 'willingToRelocate', 'preferredLocations'];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  if (req.body.skills) {
    updates.skills = req.body.skills;
    const techSkills = req.body.skills.filter(s => s.category === 'technical' || s.category === 'tool');
    const score = Math.min(100, techSkills.length * 8 + req.body.skills.length * 3);
    updates.skillAssessmentScore = score;
  }

  const profile = await StudentProfile.findOneAndUpdate(
    { collegeId: req.user.collegeId, studentId: req.user._id },
    updates,
    { new: true, upsert: true, runValidators: true }
  );

  logAudit(req, 'update', 'student-profile', { resourceId: profile._id, description: 'Updated career profile' });
  res.json({ success: true, profile });
});

const getStudentProfile = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId })
    .populate('skills.endorsedBy', 'name avatar');
  if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
  await StudentProfile.findOneAndUpdate(
    { _id: profile._id },
    { $inc: { profileViews: 1 } }
  );
  res.json({ success: true, profile });
});

const getCareerInsights = asyncHandler(async (req, res) => {
  const { studentId } = req.query;
  const sid = studentId || req.user._id;

  const profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId: sid });
  if (!profile) return res.json({ success: true, insights: { skillGaps: [], recommendedJobs: [], marketTrends: [], readinessScore: 0 } });

  const user = await User.findById(sid).select('department semester');
  const studentSkills = (profile.skills || []).map(s => s.name.toLowerCase());

  const activeJobs = await PlacementJob.find({
    collegeId: req.user.collegeId,
    status: 'active',
    type: { $in: ['full-time', 'internship'] },
  }).select('title skills type salaryMin salaryMax company');

  const matchedJobs = [];
  const jobGaps = [];
  activeJobs.forEach(job => {
    const jobSkills = (job.skills || []).map(s => s.toLowerCase());
    const matched = jobSkills.filter(js => studentSkills.some(ss => ss.includes(js) || js.includes(ss)));
    const matchPercent = jobSkills.length > 0 ? Math.round((matched.length / jobSkills.length) * 100) : 0;
    if (matchPercent >= 30) {
      matchedJobs.push({ job, matchPercent, matchedSkills: matched });
    }
    const gaps = jobSkills.filter(js => !studentSkills.some(ss => ss.includes(js) || js.includes(ss)));
    if (gaps.length > 0 && matchPercent >= 20) {
      jobGaps.push(...gaps);
    }
  });

  const skillFreq = {};
  jobGaps.forEach(g => { skillFreq[g] = (skillFreq[g] || 0) + 1; });
  const skillGaps = Object.entries(skillFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([skill, demand]) => ({ skill, demand }));

  matchedJobs.sort((a, b) => b.matchPercent - a.matchPercent);

  const avgGpa = profile.skillAssessmentScore || 0;
  const hasResume = !!profile.resumeUrl;
  const hasProjects = (profile.projects || []).length > 0;
  const hasCerts = (profile.certifications || []).length > 0;
  const readinessScore = Math.min(100,
    (hasResume ? 25 : 0) + (hasProjects ? 25 : 0) + (hasCerts ? 20 : 0) +
    Math.min(30, (profile.skills || []).length * 3)
  );

  await StudentProfile.findOneAndUpdate(
    { _id: profile._id },
    { careerReadinessScore: readinessScore }
  );

  res.json({
    success: true,
    insights: {
      skillGaps,
      recommendedJobs: matchedJobs.slice(0, 10),
      readinessScore,
      profileCompleteness: {
        hasResume, hasProjects, hasCerts,
        skillCount: (profile.skills || []).length,
        hasLinkedin: !!profile.linkedinUrl,
        hasGithub: !!profile.githubUrl,
      },
    },
  });
});

const getSkillAnalytics = asyncHandler(async (req, res) => {
  const { department, course } = req.query;
  const query = { collegeId: req.user.collegeId };

  if (department) {
    const students = await User.find({ collegeId: req.user.collegeId, department, role: 'student' }).select('_id');
    query.studentId = { $in: students.map(s => s._id) };
  }

  const profiles = await StudentProfile.find(query).select('skills interests careerGoals');

  const skillCount = {};
  const categoryCount = { technical: 0, soft: 0, domain: 0, tool: 0, language: 0 };
  const interestCount = {};

  profiles.forEach(p => {
    (p.skills || []).forEach(s => {
      skillCount[s.name] = (skillCount[s.name] || 0) + 1;
      if (categoryCount[s.category] !== undefined) categoryCount[s.category]++;
    });
    (p.interests || []).forEach(i => {
      interestCount[i] = (interestCount[i] || 0) + 1;
    });
  });

  const topSkills = Object.entries(skillCount).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count }));
  const topInterests = Object.entries(interestCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
  const avgReadiness = profiles.length > 0
    ? Math.round(profiles.reduce((sum, p) => sum + (p.careerReadinessScore || 0), 0) / profiles.length)
    : 0;

  res.json({
    success: true,
    analytics: { totalProfiles: profiles.length, topSkills, topInterests, categoryCount, avgReadiness },
  });
});

module.exports = { getMyProfile, updateMyProfile, getStudentProfile, getCareerInsights, getSkillAnalytics };
