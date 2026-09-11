require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');

const User = require('../backend/models/User');
const College = require('../backend/models/College');
const Subscription = require('../backend/models/Subscription');
const StudentProfile = require('../backend/models/StudentProfile');
const { PlacementCompany, PlacementJob, PlacementApplication } = require('../backend/models/Placement');
const { PlacementDrive } = require('../backend/models/PlacementDrive');
const { SkillAssessment, AssessmentAttempt } = require('../backend/models/SkillAssessment');
const { generateToken } = require('../backend/config/jwt');

process.env.VERCEL = 'true'; // Prevent automatic listen in server.js
const app = require('../backend/server');

let BASE_URL = '';
let server = null;

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   SUITE 13: PLACEMENT, CAMPUS CAREER & SKILLS TEST SUITE   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/vishva_erp');
  console.log(' Connected to MongoDB');

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  BASE_URL = `http://127.0.0.1:${port}/api`;
  console.log(` Test server listening at ${BASE_URL}\n`);

  let college = await College.findOne({ isActive: true });
  if (!college) {
    college = await College.create({
      name: 'Campus Career Institute of Technology',
      code: 'CCIT-01',
      address: 'Tech Corridor, Pune',
      email: 'admin@ccit.edu',
      phone: '9876500112',
      isActive: true,
    });
  }

  // Ensure active subscription for requireSubscription middleware
  await Subscription.findOneAndUpdate(
    { collegeId: college._id },
    {
      collegeId: college._id,
      plan: 'enterprise',
      amount: 99999,
      status: 'active',
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    { upsert: true, new: true }
  );
  college.planExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await college.save();

  const uniqueSuffix = Date.now().toString();

  // Create Admin User
  const admin = await User.create({
    name: 'Placement Dean Dr. R. Verma',
    email: `placement.dean.${uniqueSuffix}@ccit.edu`,
    password: 'Password123!',
    role: 'collegeAdmin',
    collegeId: college._id,
    department: 'Career Development Cell',
    phone: '9811005544',
    isActive: true,
  });

  // Create Faculty User (for endorsement & assessments)
  const faculty = await User.create({
    name: 'Prof. Arvind Kelkar',
    email: `arvind.${uniqueSuffix}@ccit.edu`,
    password: 'Password123!',
    role: 'faculty',
    collegeId: college._id,
    department: 'Computer Science',
    designation: 'Associate Professor',
    phone: '9822336677',
    isActive: true,
  });

  // Create Eligible Student User (CS, CGPA 8.5)
  const student = await User.create({
    name: 'Rohan Deshmukh',
    email: `rohan.${uniqueSuffix}@ccit.edu`,
    password: 'Password123!',
    role: 'student',
    collegeId: college._id,
    rollNo: `CS-2026-${uniqueSuffix.slice(-4)}`,
    department: 'Computer Science',
    semester: 7,
    cgpa: 8.5,
    phone: '9833447788',
    isActive: true,
  });

  // Create Ineligible Student User (Civil, CGPA 6.2)
  const ineligibleStudent = await User.create({
    name: 'Kavita Joshi',
    email: `kavita.${uniqueSuffix}@ccit.edu`,
    password: 'Password123!',
    role: 'student',
    collegeId: college._id,
    rollNo: `CE-2026-${uniqueSuffix.slice(-4)}`,
    department: 'Civil Engineering',
    semester: 7,
    cgpa: 6.2,
    phone: '9844558899',
    isActive: true,
  });

  const adminToken = generateToken({ id: admin._id, role: admin.role, collegeId: college._id });
  const facultyToken = generateToken({ id: faculty._id, role: faculty.role, collegeId: college._id });
  const studentToken = generateToken({ id: student._id, role: student.role, collegeId: college._id });
  const ineligStudentToken = generateToken({ id: ineligibleStudent._id, role: ineligibleStudent.role, collegeId: college._id });

  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
  const facultyHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${facultyToken}` };
  const studentHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` };
  const ineligHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${ineligStudentToken}` };

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  PASS: ${message}`);
      passed++;
    } else {
      console.error(`  FAIL: ${message}`);
    }
  }

  let testCompanyId = null;
  let testJobId = null;
  let testApplicationId = null;
  let testDriveId = null;
  let testAssessmentId = null;
  let testAttemptId = null;

  console.log('--- Phase 1: Placement Company CRM & Job Openings ---');
  {
    // 1. Create Placement Company
    const compRes = await fetch(`${BASE_URL}/placements/companies`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: `HexaSphere Solutions ${uniqueSuffix}`,
        industry: 'Cloud Infrastructure & AI',
        website: 'https://hexasphere.example.com',
        size: 'enterprise',
        email: 'talent@hexasphere.example.com',
        phone: '+91 80 4455 6677',
        description: 'Next-gen distributed cloud computing and AI solutions',
        status: 'active',
      }),
    });
    const compData = await compRes.json();
    assert(compRes.status === 201 && compData.success, 'Placement Company created successfully');
    testCompanyId = compData.data?._id || compData.company?._id;

    // 2. Fetch Companies List
    const getCompRes = await fetch(`${BASE_URL}/placements/companies`, { headers: adminHeaders });
    const getCompData = await getCompRes.json();
    assert(getCompRes.status === 200 && Array.isArray(getCompData.companies), 'Companies list retrieved');

    // 3. Get Company Details by ID
    const getSingleComp = await fetch(`${BASE_URL}/placements/companies/${testCompanyId}`, { headers: adminHeaders });
    const singleCompData = await getSingleComp.json();
    assert(getSingleComp.status === 200 && (singleCompData.company?.name || singleCompData.data?.name).includes('HexaSphere'), 'Company retrieved by ID');

    // 4. Update Company Details
    const updateComp = await fetch(`${BASE_URL}/placements/companies/${testCompanyId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ description: 'Updated company profile with tier-1 enterprise status' }),
    });
    const updateCompData = await updateComp.json();
    assert(updateComp.status === 200 && (updateCompData.company?.description || updateCompData.data?.description).includes('tier-1'), 'Company profile updated');

    // 5. Create Job Opening with Eligibility Criteria
    const jobRes = await fetch(`${BASE_URL}/placements/jobs`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        companyId: testCompanyId,
        title: 'Senior Cloud Backend Engineer',
        description: 'Design distributed microservices with Node.js, Docker, Kubernetes and MongoDB.',
        type: 'full-time',
        location: 'Pune / Hybrid',
        salary: '14.0 - 18.0 LPA',
        salaryMin: 1400000,
        salaryMax: 1800000,
        skills: ['Node.js', 'MongoDB', 'Docker', 'Kubernetes'],
        eligibility: {
          minCgpa: 7.5,
          departments: ['Computer Science', 'Information Technology'],
          backlogsAllowed: 0,
        },
        totalPositions: 4,
        status: 'active',
      }),
    });
    const jobData = await jobRes.json();
    assert(jobRes.status === 201 && jobData.success, 'Job opening created with eligibility rules');
    testJobId = jobData.data?._id || jobData.job?._id;

    // 6. Fetch Job Openings
    const getJobsRes = await fetch(`${BASE_URL}/placements/jobs`, { headers: adminHeaders });
    const getJobsData = await getJobsRes.json();
    assert(getJobsRes.status === 200 && (getJobsData.jobs?.length > 0 || getJobsData.data?.length > 0), 'Jobs list retrieved with company names');
  }

  console.log('\n--- Phase 2: Student Career Profile, Skills & Endorsements ---');
  {
    // 7. Get Initial Student Career Profile
    const profRes = await fetch(`${BASE_URL}/career/profile`, { headers: studentHeaders });
    const profData = await profRes.json();
    assert(profRes.status === 200 && profData.success, 'Student career profile fetched/initialized');

    // 8. Add Technical Skills to Profile
    const addSkill1 = await fetch(`${BASE_URL}/career/skills`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ name: 'Node.js', category: 'technical', level: 'intermediate', yearsOfExperience: 2 }),
    });
    const addSkill1Data = await addSkill1.json();
    assert(addSkill1.status === 200 && addSkill1Data.success, 'Added Node.js skill to profile');

    const addSkill2 = await fetch(`${BASE_URL}/career/skills`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ name: 'MongoDB', category: 'technical', level: 'intermediate', yearsOfExperience: 1 }),
    });
    const addSkill2Data = await addSkill2.json();
    assert(addSkill2.status === 200 && addSkill2Data.success, 'Added MongoDB skill to profile');

    // 9. Update Full Profile (Projects, Certifications, Career Goals)
    const updateProf = await fetch(`${BASE_URL}/career/profile`, {
      method: 'PUT',
      headers: studentHeaders,
      body: JSON.stringify({
        headline: 'Aspiring Cloud & Distributed Systems Architect',
        bio: 'Passionate about high-throughput distributed architectures, microservices, and databases.',
        projects: [
          { title: 'Distributed Event Broker', description: 'Built an in-memory Kafka-like queue in Node.js', techStack: ['Node.js', 'Redis'] },
          { title: 'Campus IoT Dashboard', description: 'Real-time telemetry aggregation portal', techStack: ['React', 'MongoDB'] },
        ],
        certifications: [
          { name: 'AWS Certified Cloud Practitioner', issuingOrg: 'Amazon Web Services', issueDate: '2025-06-01' },
        ],
        careerGoals: ['Become a Senior Backend Engineer within 3 years', 'Contribute to open source'],
        resumeUrl: 'https://cdn.example.com/resumes/rohan-deshmukh.pdf',
        linkedinUrl: 'https://linkedin.com/in/rohandeshmukh',
        githubUrl: 'https://github.com/rohandeshmukh',
      }),
    });
    const updateProfData = await updateProf.json();
    assert(updateProf.status === 200 && updateProfData.profile?.projects?.length === 2, 'Career profile enriched with projects, certifications & social links');

    // 10. Faculty Skill Endorsement (should auto-verify skill)
    const endorseRes = await fetch(`${BASE_URL}/career/profile/${student._id}/skills/Node.js/endorse`, {
      method: 'POST',
      headers: facultyHeaders,
    });
    const endorseData = await endorseRes.json();
    assert(endorseRes.status === 200 && endorseData.skill?.verified === true, 'Faculty endorsed Node.js and verified student skill');

    // 11. View Student Profile (public / faculty view with view counter)
    const viewProfRes = await fetch(`${BASE_URL}/career/profile/${student._id}`, { headers: facultyHeaders });
    const viewProfData = await viewProfRes.json();
    assert(viewProfRes.status === 200 && viewProfData.profile?.profileViews >= 1, 'Faculty viewed student profile with incremented profileViews');
  }

  console.log('\n--- Phase 3: Skill Assessments, Evaluation & Auto-Verification ---');
  {
    // 12. Create Skill Assessment (Faculty / Admin)
    const assessRes = await fetch(`${BASE_URL}/assessments`, {
      method: 'POST',
      headers: facultyHeaders,
      body: JSON.stringify({
        title: 'Advanced Docker & Containerization Assessment',
        description: 'Comprehensive evaluation of Dockerfiles, multi-stage builds, volumes, and networking.',
        category: 'technical',
        skillTags: ['Docker'],
        difficulty: 'medium',
        timeLimit: 20,
        passingScore: 60,
        maxAttempts: 3,
        isPublished: true,
        questions: [
          {
            text: 'Which instruction is used to set up the default command executed when running a container?',
            questionText: 'Which instruction is used to set up the default command executed when running a container?',
            type: 'mcq',
            options: [
              { text: 'RUN', isCorrect: false },
              { text: 'CMD', isCorrect: true },
              { text: 'ENV', isCorrect: false },
              { text: 'EXPOSE', isCorrect: false },
            ],
            points: 5,
          },
          {
            text: 'True or False: Multi-stage Docker builds allow you to drastically reduce the final image size.',
            questionText: 'True or False: Multi-stage Docker builds allow you to drastically reduce the final image size.',
            type: 'true_false',
            correctAnswer: 'true',
            points: 5,
          },
        ],
      }),
    });
    const assessData = await assessRes.json();
    assert(assessRes.status === 201 && assessData.success, 'Skill Assessment created with MCQ & True/False questions');
    testAssessmentId = assessData.assessment?._id || assessData.data?._id;

    // 13. List Assessments
    const listAssess = await fetch(`${BASE_URL}/assessments`, { headers: studentHeaders });
    const listAssessData = await listAssess.json();
    assert(listAssess.status === 200 && (listAssessData.assessments?.length > 0 || listAssessData.data?.length > 0), 'Published assessments retrieved by student');

    // 14. Start Assessment Attempt
    const startRes = await fetch(`${BASE_URL}/assessments/${testAssessmentId}/start`, {
      method: 'POST',
      headers: studentHeaders,
    });
    const startData = await startRes.json();
    assert(startRes.status === 201 && startData.attempt?.status === 'in_progress', 'Started assessment attempt');
    testAttemptId = startData.attempt?._id;

    // 15. Submit Assessment Attempt with 100% Correct Answers
    const questions = assessData.assessment.questions;
    const submitRes = await fetch(`${BASE_URL}/assessments/${testAttemptId}/submit`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({
        answers: [
          { questionId: questions[0]._id, selectedOption: 'CMD' },
          { questionId: questions[1]._id, selectedOption: 'true' },
        ],
      }),
    });
    const submitData = await submitRes.json();
    assert(submitRes.status === 200 && submitData.attempt?.passed === true && submitData.attempt?.percentage === 100, 'Assessment attempt passed with 100% score');

    // 16. Verify Auto-Skill Sync in StudentProfile
    const checkProf = await fetch(`${BASE_URL}/career/profile`, { headers: studentHeaders });
    const checkProfData = await checkProf.json();
    const dockerSkill = (checkProfData.profile?.skills || []).find(s => s.name.toLowerCase() === 'docker');
    assert(dockerSkill && dockerSkill.verified === true && dockerSkill.level === 'advanced', 'Passed assessment auto-synced verified "Docker" skill into StudentProfile');

    // 17. Leaderboard Check
    const lbRes = await fetch(`${BASE_URL}/assessments/leaderboard?assessmentId=${testAssessmentId}`, { headers: studentHeaders });
    const lbData = await lbRes.json();
    assert(lbRes.status === 200 && Array.isArray(lbData.leaderboard) && lbData.leaderboard.length >= 1, 'Assessment leaderboard retrieved with student ranking');
  }

  console.log('\n--- Phase 4: Job Application & Eligibility Rule Enforcement ---');
  {
    // 18. Attempt Application by Ineligible Student (Wrong Dept: Civil, Low CGPA: 6.2)
    const ineligRes = await fetch(`${BASE_URL}/placements/jobs/${testJobId}/apply`, {
      method: 'POST',
      headers: ineligHeaders,
      body: JSON.stringify({
        coverLetter: 'I would like to apply for the Backend Engineer position.',
      }),
    });
    const ineligData = await ineligRes.json();
    assert(ineligRes.status === 400 && ineligData.code === 'DEPARTMENT_INELIGIBLE', 'Ineligible student blocked due to department restrictions');

    // 19. Successful Application by Eligible Student (CS, CGPA 8.5)
    const applyRes = await fetch(`${BASE_URL}/placements/jobs/${testJobId}/apply`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({
        coverLetter: 'Excited to apply! I have hands-on experience in Node.js, MongoDB, and verified Docker skills.',
        resume: 'https://cdn.example.com/resumes/rohan-deshmukh.pdf',
      }),
    });
    const applyData = await applyRes.json();
    assert(applyRes.status === 201 && applyData.success, 'Eligible student successfully applied for job');
    testApplicationId = applyData.data?._id || applyData.application?._id;

    // 20. Prevent Duplicate Application
    const dupRes = await fetch(`${BASE_URL}/placements/jobs/${testJobId}/apply`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ coverLetter: 'Second submission attempt' }),
    });
    assert(dupRes.status === 400, 'Duplicate job application prevented with 400 Bad Request');
  }

  console.log('\n--- Phase 5: ATS Scoring & Skills Recommendations ---');
  {
    // 21. ATS Score Matching
    const atsRes = await fetch(`${BASE_URL}/placements/jobs/${testJobId}/ats`, { headers: studentHeaders });
    const atsData = await atsRes.json();
    assert(atsRes.status === 200 && atsData.success && typeof atsData.ats?.overallScore === 'number', 'ATS match score calculated successfully');
    assert(atsData.ats.matchedSkills.some(s => s.toLowerCase() === 'node.js'), 'ATS correctly identified matched Node.js skill');
    assert(atsData.ats.missingSkills.some(s => s.toLowerCase() === 'kubernetes'), 'ATS correctly highlighted missing Kubernetes skill');
    assert(Array.isArray(atsData.ats.recommendations) && atsData.ats.recommendations.length > 0, 'ATS generated actionable recommendations for missing skills');
  }

  console.log('\n--- Phase 6: Application Lifecycle & Offer Acceptance ---');
  {
    // 22. Admin Shortlists Application
    const shortlistRes = await fetch(`${BASE_URL}/placements/applications/${testApplicationId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        status: 'shortlisted',
        note: 'Resume and verified skills profile shortlisted by hiring committee.',
      }),
    });
    const shortlistData = await shortlistRes.json();
    assert(shortlistRes.status === 200 && shortlistData.application?.status === 'shortlisted', 'Application transitioned to shortlisted status');

    // 23. Admin Schedules Technical Interview
    const interviewRes = await fetch(`${BASE_URL}/placements/applications/${testApplicationId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        status: 'interview',
        interviewDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        interviewFeedback: 'Cleared Round 1 System Architecture Interview.',
        note: 'Scheduled for final HR and managerial interview.',
      }),
    });
    const interviewData = await interviewRes.json();
    assert(interviewRes.status === 200 && interviewData.application?.status === 'interview', 'Application transitioned to interview stage with date');

    // 24. Issue Job Offer
    const offerRes = await fetch(`${BASE_URL}/placements/applications/${testApplicationId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        status: 'offered',
        offerDetails: {
          salary: '16.5 LPA',
          designation: 'Cloud Backend Engineer - SDE II',
          joiningDate: new Date('2026-09-01'),
          location: 'Pune HQ / Hybrid',
        },
        note: 'Official Offer Letter released to candidate.',
      }),
    });
    const offerData = await offerRes.json();
    assert(offerRes.status === 200 && offerData.application?.status === 'offered', 'Offer letter issued with 16.5 LPA CTC');

    // 25. Student Accepts Offer
    const acceptRes = await fetch(`${BASE_URL}/placements/applications/${testApplicationId}/accept`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ note: 'Humbled and thrilled to accept the offer!' }),
    });
    const acceptData = await acceptRes.json();
    assert(acceptRes.status === 200 && acceptData.application?.status === 'accepted', 'Student accepted offer and job filledPositions updated');
  }

  console.log('\n--- Phase 7: Placement Drives, Roster & Student Progression ---');
  {
    // 26. Create Campus Placement Drive
    const driveRes = await fetch(`${BASE_URL}/placements/drives`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        companyId: testCompanyId,
        jobId: testJobId,
        title: 'HexaSphere 2026 Grand Campus Drive',
        driveDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        venue: 'Main Campus Convention Center, Hall B',
        mode: 'offline',
        status: 'upcoming',
        registrationDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        rounds: [
          { name: 'Aptitude & Logical Reasoning', type: 'aptitude' },
          { name: 'Live Coding & Algorithms', type: 'technical' },
          { name: 'System Design & HR Interview', type: 'interview' },
        ],
        eligibility: {
          departments: ['Computer Science', 'Information Technology'],
          minCgpa: 7.0,
        },
      }),
    });
    const driveData = await driveRes.json();
    assert(driveRes.status === 201 && driveData.success, 'Placement Drive scheduled with 3 evaluation rounds');
    testDriveId = driveData.drive?._id || driveData.data?._id;

    // 27. Student Registers for Campus Drive
    const regRes = await fetch(`${BASE_URL}/placements/drives/${testDriveId}/register`, {
      method: 'POST',
      headers: studentHeaders,
    });
    const regData = await regRes.json();
    assert(regRes.status === 200 && regData.success, 'Student registered for campus placement drive');

    // 28. Ineligible Student Drive Registration Blocked
    const ineligRegRes = await fetch(`${BASE_URL}/placements/drives/${testDriveId}/register`, {
      method: 'POST',
      headers: ineligHeaders,
    });
    assert(ineligRegRes.status === 400, 'Ineligible student blocked from registering for drive');

    // 29. Query Drive Attendees List (Admin)
    const attRes = await fetch(`${BASE_URL}/placements/drives/${testDriveId}/attendees`, { headers: adminHeaders });
    const attData = await attRes.json();
    assert(attRes.status === 200 && attData.attendees?.length >= 1, 'Drive attendee list retrieved with student metadata');

    // 30. Progress Student to Next Drive Round
    const updateRoundRes = await fetch(`${BASE_URL}/placements/drives/${testDriveId}/students/${student._id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({
        status: 'cleared_round',
        currentRound: 2,
        notes: 'Cleared Round 1 Aptitude with 94% percentile.',
      }),
    });
    const updateRoundData = await updateRoundRes.json();
    assert(updateRoundRes.status === 200 && updateRoundData.record?.currentRound === 2, 'Student progressed to Round 2 of drive');

    // 31. Export Drive Roster as CSV
    const exportDriveRes = await fetch(`${BASE_URL}/placements/drives/${testDriveId}/export`, { headers: adminHeaders });
    const driveCsv = await exportDriveRes.text();
    assert(exportDriveRes.status === 200 && driveCsv.includes('Student ID') && driveCsv.includes(student.name), 'Drive roster exported as RFC CSV with attendee details');
  }

  console.log('\n--- Phase 8: Placement Statistics & Accreditation CSV Export ---');
  {
    // 32. Placement Dashboard Statistics
    const statsRes = await fetch(`${BASE_URL}/placements/stats`, { headers: adminHeaders });
    const statsData = await statsRes.json();
    assert(statsRes.status === 200 && statsData.success, 'Placement statistics retrieved');
    assert(statsData.stats.totalJobs >= 1 && statsData.stats.companyCount >= 1, 'Stats include totalJobs and companyCount');
    assert(statsData.stats.highestSalary >= 1800000, 'Highest salary CTC reflects 18 LPA max');

    // 33. Accreditation Placement Report CSV Export
    const exportRepRes = await fetch(`${BASE_URL}/placements/export`, { headers: adminHeaders });
    const repCsv = await exportRepRes.text();
    assert(exportRepRes.status === 200 && repCsv.includes('Application ID') && repCsv.includes('HexaSphere Solutions'), 'Accreditation placement report exported as compliant CSV');
  }

  console.log('\n--- Phase 9: Career Learning Paths & AI Recommendations ---');
  {
    // 34. Career Learning Paths
    const pathsRes = await fetch(`${BASE_URL}/career/learning-paths`, { headers: studentHeaders });
    const pathsData = await pathsRes.json();
    assert(pathsRes.status === 200 && Array.isArray(pathsData.learningPaths), 'Personalized career learning paths generated');

    // 35. AI Recommendations (with offline fallback guarantee)
    const aiRecRes = await fetch(`${BASE_URL}/career/ai-recommendations`, { headers: studentHeaders });
    const aiRecData = await aiRecRes.json();
    assert(aiRecRes.status === 200 && aiRecData.recommendations && (Array.isArray(aiRecData.recommendations) || Object.keys(aiRecData.recommendations).length > 0), 'Career AI recommendations returned via resilient engine');

    // 36. Skill Analytics for Admin/Faculty
    const skillAnalyticsRes = await fetch(`${BASE_URL}/career/analytics`, { headers: facultyHeaders });
    const skillAnalyticsData = await skillAnalyticsRes.json();
    assert(skillAnalyticsRes.status === 200 && typeof skillAnalyticsData.analytics?.totalProfiles === 'number', 'Institutional skill analytics retrieved');
  }

  console.log('\n--- Phase 10: Cleanup & Teardown ---');
  {
    await PlacementApplication.deleteMany({ collegeId: college._id });
    await PlacementDrive.deleteMany({ collegeId: college._id });
    await PlacementJob.deleteMany({ collegeId: college._id });
    await PlacementCompany.deleteMany({ collegeId: college._id });
    await SkillAssessment.deleteMany({ collegeId: college._id });
    await AssessmentAttempt.deleteMany({ collegeId: college._id });
    await StudentProfile.deleteMany({ collegeId: college._id });
    await User.deleteMany({ _id: { $in: [admin._id, faculty._id, student._id, ineligibleStudent._id] } });
    console.log(' Cleaned up test database records.');
  }

  console.log(`\n============================================================`);
  console.log(` RESULTS: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log(`============================================================\n`);

  server.close();
  await mongoose.disconnect();

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test run error:', err);
  if (server) server.close();
  mongoose.disconnect().finally(() => process.exit(1));
});
