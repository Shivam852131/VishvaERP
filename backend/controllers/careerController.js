const asyncHandler = require('../middleware/asyncHandler');
const StudentProfile = require('../models/StudentProfile');
const User = require('../models/User');
const PlacementJob = require('../models/Placement');
const Result = require('../models/Result');
const { SkillAssessment, AssessmentAttempt } = require('../models/SkillAssessment');
const { emitDataChange } = require('../utils/realtime');
const { logAudit } = require('../services/auditService');
const { askAI } = require('../services/aiService');

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
  }).select('title skills type salaryMin salaryMax company description');

  const matchedJobs = [];
  const jobGaps = [];
  activeJobs.forEach(job => {
    const jobSkills = (job.skills || []).map(s => s.toLowerCase());
    const matched = jobSkills.filter(js => studentSkills.some(ss => ss.includes(js) || js.includes(ss)));
    const matchPercent = jobSkills.length > 0 ? Math.round((matched.length / jobSkills.length) * 100) : 0;

    let demandWeight = 1;
    if (matched.length > 0) {
      const matchedSet = new Set(matched);
      const highDemandSkills = ['javascript', 'python', 'react', 'node', 'sql', 'java', 'aws', 'docker', 'typescript'];
      const highDemandMatches = matched.filter(s => highDemandSkills.some(hd => s.includes(hd)));
      demandWeight = 1 + (highDemandMatches.length * 0.1);
    }

    const adjustedScore = Math.min(100, Math.round(matchPercent * demandWeight));

    if (adjustedScore >= 20) {
      matchedJobs.push({
        job,
        matchPercent: adjustedScore,
        matchedSkills: matched,
        demandWeight: Math.round(demandWeight * 100) / 100,
      });
    }
    const gaps = jobSkills.filter(js => !studentSkills.some(ss => ss.includes(js) || js.includes(ss)));
    if (gaps.length > 0 && matchPercent >= 15) {
      jobGaps.push(...gaps);
    }
  });

  const skillFreq = {};
  jobGaps.forEach(g => { skillFreq[g] = (skillFreq[g] || 0) + 1; });
  const skillGaps = Object.entries(skillFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([skill, demand]) => ({ skill, demand, category: categorizeSkill(skill) }));

  matchedJobs.sort((a, b) => b.matchPercent - a.matchPercent);

  const hasResume = !!profile.resumeUrl;
  const hasProjects = (profile.projects || []).length > 0;
  const hasCerts = (profile.certifications || []).length > 0;
  const hasSkills = (profile.skills || []).length > 0;
  const hasLinkedin = !!profile.linkedinUrl;
  const hasGithub = !!profile.githubUrl;
  const hasPortfolio = !!profile.portfolioUrl;
  const hasCareerGoals = (profile.careerGoals || []).length > 0;
  const hasHeadline = !!profile.headline;
  const hasBio = !!profile.bio;

  const readinessScore = Math.min(100,
    (hasResume ? 20 : 0) + (hasProjects ? 20 : 0) + (hasCerts ? 10 : 0) +
    (hasSkills ? 15 : 0) + (hasLinkedin ? 5 : 0) + (hasGithub ? 5 : 0) +
    (hasPortfolio ? 5 : 0) + (hasCareerGoals ? 10 : 0) + (hasHeadline ? 5 : 0) + (hasBio ? 5 : 0)
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
        hasResume, hasProjects, hasCerts, hasSkills,
        hasLinkedin, hasGithub, hasPortfolio,
        hasCareerGoals, hasHeadline, hasBio,
        skillCount: (profile.skills || []).length,
        completionPercent: Math.round(readinessScore),
      },
    },
  });
});

const getLearningPaths = asyncHandler(async (req, res) => {
  const profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId: req.user._id });
  if (!profile) return res.json({ success: true, learningPaths: [] });

  const studentSkills = (profile.skills || []).map(s => s.name.toLowerCase());
  const studentProjects = (profile.projects || []).length;
  const studentCerts = (profile.certifications || []).length;

  const bestAttempt = await AssessmentAttempt.findOne({
    collegeId: req.user.collegeId, studentId: req.user._id, status: 'completed',
  }).sort({ percentage: -1 });

  const attempts = await AssessmentAttempt.find({
    collegeId: req.user.collegeId, studentId: req.user._id, status: 'completed',
  }).select('assessmentId percentage passed');

  const attemptMap = {};
  attempts.forEach(a => {
    const key = a.assessmentId.toString();
    if (!attemptMap[key] || a.percentage > attemptMap[key].percentage) {
      attemptMap[key] = a;
    }
  });

  const weakestCategories = {};
  (profile.skills || []).forEach(s => {
    if (!weakestCategories[s.category]) weakestCategories[s.category] = { skills: [], count: 0 };
    weakestCategories[s.category].skills.push(s.name);
    weakestCategories[s.category].count++;
  });

  const assessments = await SkillAssessment.find({ collegeId: req.user.collegeId, isPublished: true, isActive: true })
    .select('title category skillTags difficulty timeLimit passingScore avgScore');

  const completedAssessmentIds = Object.keys(attemptMap);

  const paths = [];

  if (bestAttempt && bestAttempt.percentage < 70) {
    paths.push({
      id: 'improve-core',
      title: 'Strengthen Core Skills',
      description: `Your latest assessment score was ${bestAttempt.percentage}%. Focus on foundational concepts.`,
      priority: 'high',
      items: generatePathItems(studentSkills, 'fundamentals'),
      estimatedHours: 20,
    });
  }

  const uncompletedAssessments = assessments.filter(a => !completedAssessmentIds.includes(a._id.toString()));
  if (uncompletedAssessments.length > 0) {
    paths.push({
      id: 'try-assessments',
      title: 'Try Skill Assessments',
      description: `You have ${uncompletedAssessments.length} assessments available. Test your knowledge and earn verified skills.`,
      priority: 'medium',
      items: uncompletedAssessments.slice(0, 5).map(a => ({
        title: a.title,
        type: 'assessment',
        skillTags: a.skillTags,
        difficulty: a.difficulty,
        estimatedMinutes: a.timeLimit,
      })),
      estimatedHours: Math.ceil(uncompletedAssessments.slice(0, 5).reduce((s, a) => s + a.timeLimit, 0) / 60),
    });
  }

  const highDemandSkills = ['javascript', 'python', 'react', 'node.js', 'sql', 'java', 'aws', 'docker', 'kubernetes', 'typescript', 'git'];
  const missingHighDemand = highDemandSkills.filter(s => !studentSkills.some(sk => sk.toLowerCase().includes(s.split('.')[0])));
  if (missingHighDemand.length > 0) {
    paths.push({
      id: 'in-demand',
      title: 'Learn High-Demand Skills',
      description: 'These skills are most requested by employers in active placements.',
      priority: 'high',
      items: missingHighDemand.slice(0, 6).map(skill => ({
        title: `Learn ${skill}`,
        type: 'skill',
        skillTag: skill,
        difficulty: 'medium',
        estimatedHours: getEstimateHours(skill),
      })),
      estimatedHours: missingHighDemand.slice(0, 6).reduce((s, sk) => s + getEstimateHours(sk), 0),
    });
  }

  if (studentProjects < 2) {
    paths.push({
      id: 'build-projects',
      title: 'Build Portfolio Projects',
      description: 'Projects demonstrate practical skills and make your profile stand out.',
      priority: studentProjects === 0 ? 'high' : 'medium',
      items: generateProjectIdeas(studentSkills),
      estimatedHours: studentProjects === 0 ? 40 : 20,
    });
  }

  if (studentCerts < 1) {
    paths.push({
      id: 'get-certified',
      title: 'Earn Certifications',
      description: 'Certifications validate your skills and boost employer confidence.',
      priority: 'low',
      items: generateCertRecommendations(studentSkills),
      estimatedHours: 30,
    });
  }

  paths.sort((a, b) => {
    const p = { high: 0, medium: 1, low: 2 };
    return (p[a.priority] || 2) - (p[b.priority] || 2);
  });

  res.json({ success: true, learningPaths: paths });
});

function categorizeSkill(skill) {
  const technical = ['javascript', 'python', 'java', 'c++', 'sql', 'html', 'css', 'react', 'angular', 'node', 'django', 'flask', 'spring', 'mongodb', 'redis', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'git', 'linux'];
  const soft = ['communication', 'leadership', 'teamwork', 'problem solving', 'critical thinking', 'time management', 'presentation', 'negotiation'];
  const domain = ['machine learning', 'data science', 'web development', 'mobile development', 'cloud computing', 'cybersecurity', 'blockchain', 'iot'];

  const lower = skill.toLowerCase();
  if (technical.some(t => lower.includes(t))) return 'technical';
  if (soft.some(s => lower.includes(s))) return 'soft';
  if (domain.some(d => lower.includes(d))) return 'domain';
  return 'other';
}

function generatePathItems(skills, focus) {
  const items = [];
  if (skills.length === 0) {
    items.push({ title: 'Start with fundamentals', type: 'course', difficulty: 'beginner', estimatedHours: 10 });
  }
  items.push({ title: 'Practice coding challenges', type: 'practice', difficulty: 'medium', estimatedHours: 15 });
  items.push({ title: 'Build a mini project', type: 'project', difficulty: 'medium', estimatedHours: 20 });
  return items;
}

function getEstimateHours(skill) {
  const hours = { javascript: 25, python: 20, react: 15, 'node.js': 15, sql: 10, java: 20, aws: 15, docker: 10, kubernetes: 15, typescript: 10, git: 5 };
  return hours[skill.toLowerCase()] || 12;
}

function generateProjectIdeas(skills) {
  const ideas = [];
  const hasWeb = skills.some(s => ['javascript', 'html', 'css', 'react', 'angular'].includes(s.toLowerCase()));
  const hasBackend = skills.some(s => ['node.js', 'python', 'java', 'django', 'flask'].includes(s.toLowerCase()));
  const hasData = skills.some(s => ['python', 'sql', 'machine learning', 'data science'].includes(s.toLowerCase()));

  if (hasWeb) ideas.push({ title: 'Build a full-stack web application', type: 'project', difficulty: 'medium', estimatedHours: 30 });
  if (hasBackend) ideas.push({ title: 'Create a REST API with authentication', type: 'project', difficulty: 'medium', estimatedHours: 20 });
  if (hasData) ideas.push({ title: 'Analyze a dataset and create visualizations', type: 'project', difficulty: 'medium', estimatedHours: 15 });
  if (ideas.length === 0) ideas.push({ title: 'Build a personal portfolio website', type: 'project', difficulty: 'beginner', estimatedHours: 15 });
  ideas.push({ title: 'Contribute to an open-source project', type: 'project', difficulty: 'hard', estimatedHours: 20 });
  return ideas;
}

function generateCertRecommendations(skills) {
  const certs = [];
  const hasCloud = skills.some(s => ['aws', 'azure', 'gcp', 'cloud'].includes(s.toLowerCase()));
  const hasCode = skills.some(s => ['javascript', 'python', 'java'].includes(s.toLowerCase()));
  if (hasCloud) certs.push({ title: 'AWS Cloud Practitioner', type: 'certification', provider: 'AWS', estimatedHours: 40 });
  if (hasCode) certs.push({ title: 'Meta Frontend/Backend Developer', type: 'certification', provider: 'Meta/Coursera', estimatedHours: 60 });
  certs.push({ title: 'Google Project Management Certificate', type: 'certification', provider: 'Google/Coursera', estimatedHours: 30 });
  return certs;
}

const getAIRecommendations = asyncHandler(async (req, res) => {
  const profile = await StudentProfile.findOne({ collegeId: req.user.collegeId, studentId: req.user._id });
  const user = await User.findById(req.user._id).select('name department semester');

  const skills = (profile?.skills || []).map(s => s.name).join(', ') || 'None listed';
  const projects = (profile?.projects || []).map(p => p.name || 'Project').join(', ') || 'None';
  const certs = (profile?.certifications || []).map(c => c.name || 'Certification').join(', ') || 'None';
  const goals = (profile?.careerGoals || []).join(', ') || 'Not specified';

  const prompt = `Student Profile:
Name: ${user?.name || 'Student'}
Department: ${user?.department || 'N/A'}
Semester: ${user?.semester || 'N/A'}
Skills: ${skills}
Projects: ${projects}
Certifications: ${certs}
Career Goals: ${goals}

Provide personalized career recommendations including:
1. Top 3 career paths that match their profile
2. 3 specific skills they should learn next (with reasoning)
3. 2 project ideas they should build
4. 1 certification they should pursue
5. Interview preparation tips specific to their skill set

Be specific, actionable, and encouraging. Format as structured JSON.`;

  const response = await askAI(prompt, 'You are an expert career counselor for engineering students. Provide concise, actionable career advice. Always respond with valid JSON.', { maxTokens: 1200 });

  let recommendations;
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    recommendations = jsonMatch ? JSON.parse(jsonMatch[0]) : { rawAdvice: response };
  } catch {
    recommendations = { rawAdvice: response };
  }

  res.json({ success: true, recommendations });
});

const getSkillAnalytics = asyncHandler(async (req, res) => {
  const { department, course } = req.query;
  const query = { collegeId: req.user.collegeId };

  if (department) {
    const students = await User.find({ collegeId: req.user.collegeId, department, role: 'student' }).select('_id');
    query.studentId = { $in: students.map(s => s._id) };
  }

  const profiles = await StudentProfile.find(query).select('skills interests careerGoals careerReadinessScore');

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
  const readinessScores = profiles.map(p => p.careerReadinessScore || 0);
  const avgReadiness = readinessScores.length > 0 ? Math.round(readinessScores.reduce((s, v) => s + v, 0) / readinessScores.length) : 0;

  const readinessDistribution = { excellent: 0, good: 0, average: 0, needsImprovement: 0 };
  readinessScores.forEach(score => {
    if (score >= 80) readinessDistribution.excellent++;
    else if (score >= 60) readinessDistribution.good++;
    else if (score >= 40) readinessDistribution.average++;
    else readinessDistribution.needsImprovement++;
  });

  res.json({
    success: true,
    analytics: {
      totalProfiles: profiles.length,
      topSkills,
      topInterests,
      categoryCount,
      avgReadiness,
      readinessDistribution,
    },
  });
});

module.exports = { getMyProfile, updateMyProfile, getStudentProfile, getCareerInsights, getSkillAnalytics, getLearningPaths, getAIRecommendations };
