const mongoose = require('mongoose');

const platformSettingSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'platform' },
  general: {
    platformName: { type: String, default: 'VishvaERP' },
    logoUrl: { type: String, default: '' },
    supportEmail: { type: String, default: 'support@vishvaerp.com' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    maintenanceMode: { type: Boolean, default: false },
    publicRegistration: { type: Boolean, default: true },
  },
  security: {
    require2FA: { type: Boolean, default: true },
    strongPasswords: { type: Boolean, default: true },
    sessionTimeoutMinutes: { type: Number, default: 120 },
  },
  email: {
    fromName: { type: String, default: 'VishvaERP' },
    fromEmail: { type: String, default: 'noreply@vishvaerp.com' },
    smtpHost: { type: String, default: '' },
    smtpPort: { type: Number, default: 587 },
    smtpSecure: { type: Boolean, default: false },
    smtpUser: { type: String, default: '' },
  },
  storage: {
    provider: { type: String, default: 'local' },
    bucketName: { type: String, default: '' },
    baseUrl: { type: String, default: '' },
  },
  ai: {
    apiKey: { type: String, default: '' },
    defaultModel: { type: String, default: 'gemini-1.5-pro' },
    enabled: { type: Boolean, default: true },
  },
  // Education taxonomy for the Smart MCQ / Exam-Prep system (managed by Super Admin)
  taxonomy: {
    educationLevels: [{ type: String }],       // school / undergraduate / postgraduate / competitive
    boards: [{ type: String }],                // CBSE, ICSE, State Board...
    competitiveExams: [{ type: String }],      // JEE, NEET, UPSC, GATE...
  },
  // ── Website CMS (landing page + auth pages, edited by Super Admin) ──
  // Every field mirrors the static landing page; empty/missing values mean
  // "keep whatever the static markup already says".
  website: {
    announcement: {
      enabled: { type: Boolean, default: false },
      text: { type: String, default: 'Admissions open for AY 2026-27 \u2014 register your institution today.' },
      linkLabel: { type: String, default: 'Register' },
      link: { type: String, default: './pages/register.html' },
    },
    branding: {
      siteName: { type: String, default: 'Vishva ERP' },
      logoUrl: { type: String, default: '' },        // empty = default icons/logo.png
      tagline: { type: String, default: 'Enterprise Academic Platform' },
      supportEmail: { type: String, default: 'support@vishvaerp.com' },
    },
    seo: {
      title: { type: String, default: 'Vishva ERP | AI-Powered Campus ERP for Colleges and Universities' },
      description: { type: String, default: 'Vishva ERP is an enterprise academic platform for colleges and universities covering admissions, timetable, smart attendance, exams, fees, HR, logistics, and analytics.' },
      keywords: { type: String, default: 'ERP, college ERP, university ERP, campus management, smart attendance, timetable, AI education, student portal, faculty portal, Vishva ERP' },
    },
    hero: {
      enabled: { type: Boolean, default: true },
      badge: { type: String, default: 'Campus-grade operating system for modern institutions' },
      title: { type: String, default: 'Run your entire campus from one intelligent platform.' },
      titleAccent: { type: String, default: 'one intelligent platform.' },
      description: { type: String, default: 'Vishva ERP unifies admissions, timetable planning, smart attendance, examinations, fee management, HR, logistics, and analytics into a single connected system.' },
      tags: {
        type: [{
          icon: { type: String, default: 'fas fa-check-circle' },
          label: { type: String, default: '' },
        }],
        default: [
          { icon: 'fas fa-check-circle', label: 'Multi-campus ready' },
          { icon: 'fas fa-shield-halved', label: 'Role-based controls' },
          { icon: 'fas fa-bolt', label: 'Real-time workflows' },
          { icon: 'fas fa-robot', label: 'AI-powered' },
        ],
      },
      primaryCtaLabel: { type: String, default: 'Register Institution' },
      primaryCtaHref: { type: String, default: './pages/register.html' },
      secondaryCtaLabel: { type: String, default: 'Sign In' },
      secondaryCtaHref: { type: String, default: './pages/login.html' },
      proof: {
        type: [String],
        default: ['Free to start', 'No credit card required', 'Setup in minutes'],
      },
    },
    sections: {
      features: {
        enabled: { type: Boolean, default: true },
        kicker: { type: String, default: 'Core capabilities' },
        title: { type: String, default: 'Built for the daily demands of running a real institution.' },
        description: { type: String, default: 'Vishva ERP is designed around operational outcomes: fewer manual registers, faster decisions, better student visibility, and cleaner governance.' },
        items: {
          type: [{
            icon: { type: String, default: '' },
            title: { type: String, default: '' },
            description: { type: String, default: '' },
          }],
          default: [
            { icon: '', title: 'Academic delivery without timetable chaos', description: 'Plan weekly slots, track faculty load, detect room clashes, connect classes to attendance, and keep students informed through live portals.' },
            { icon: 'fas fa-user-check', title: 'Auditable attendance', description: 'Combine manual faculty marking with consent-based smart classroom presence, source badges, and eligibility forecasts.' },
            { icon: 'fas fa-indian-rupee-sign', title: 'Real collection picture', description: 'Track fee heads, dues, partial payments, receipts, pending amounts, and collection risk in one place.' },
            { icon: 'fas fa-brain', title: 'AI turns data into action', description: 'Use AI Tutor, notes, exam generation, insight summaries, and risk queues to reduce bottlenecks.' },
          ],
        },
      },
      platform: {
        enabled: { type: Boolean, default: true },
        kicker: { type: String, default: 'Executive operations' },
        title: { type: String, default: 'One command center for every campus decision.' },
        description: { type: String, default: 'Replace scattered spreadsheets with a live operating layer for academics, revenue, compliance, and student success.' },
        ops: {
          type: [{
            icon: { type: String, default: '' },
            title: { type: String, default: '' },
            description: { type: String, default: '' },
          }],
          default: [
            { icon: 'fas fa-route', title: 'Admission-to-alumni lifecycle', description: 'Applications, enrollment, sections, certificates, and alumni records.' },
            { icon: 'fas fa-shield-halved', title: 'Role and tenant isolation', description: 'Separate Super Admin, College Admin, Faculty, Student, and Parent experiences.' },
            { icon: 'fas fa-chart-simple', title: 'Predictive action queues', description: 'Surface attendance shortages, fee risk, assignment backlog, and leave load.' },
          ],
        },
      },
      engine: {
        enabled: { type: Boolean, default: true },
        cards: {
          type: [{
            icon: { type: String, default: '' },
            title: { type: String, default: '' },
            description: { type: String, default: '' },
          }],
          default: [
            { icon: 'fas fa-calendar-week', title: 'Dynamic Timetable Engine', description: 'Live weekly grids, next-class signals, room movement, faculty workload, and day-wise academic flow.' },
            { icon: 'fas fa-location-crosshairs', title: 'Consent-Based Smart Attendance', description: 'Classroom geofences, teacher presence, live student heartbeat, source badges, and manual override.' },
            { icon: 'fas fa-brain', title: 'Real-Time AI Academic Layer', description: 'AI Tutor, notes, exam support, risk summaries, and action queues connected to ERP operations.' },
          ],
        },
      },
      modules: {
        enabled: { type: Boolean, default: true },
        kicker: { type: String, default: 'ERP modules' },
        title: { type: String, default: 'Everything a real institution runs every day.' },
        description: { type: String, default: 'Core modules designed for repeated operational use, not brochure screens. Each area connects to the same data.' },
        items: {
          type: [{
            icon: { type: String, default: '' },
            title: { type: String, default: '' },
            description: { type: String, default: '' },
          }],
          default: [
            { icon: 'fas fa-user-plus', title: 'Admissions & Enrollment', description: 'Lead capture, application review, document checks, seat allocation, and parent accounts.' },
            { icon: 'fas fa-calendar-check', title: 'Attendance & Timetable', description: 'Batch-wise schedules, shortage alerts, smart location, faculty workload, and live class links.' },
            { icon: 'fas fa-file-signature', title: 'Exams & Results', description: 'Subject plans, marks entry, grading, CGPA, bulk uploads, and parent/student views.' },
            { icon: 'fas fa-file-invoice-dollar', title: 'Fees & Finance', description: 'Fee heads, dues, receipts, partial payments, reminders, collection charts, and risk lists.' },
            { icon: 'fas fa-people-roof', title: 'HR, Leave & Payroll', description: 'Staff profiles, leave approvals, department capacity, HR alerts, and payroll-ready records.' },
            { icon: 'fas fa-bus', title: 'Hostel & Transport', description: 'Rooms, routes, vehicles, allocations, capacity tracking, and transport communication.' },
            { icon: 'fas fa-comments', title: 'Communications', description: 'Notices, broadcasts, real-time messages, parent alerts, and audit trails.' },
            { icon: 'fas fa-brain', title: 'AI Tools Hub', description: 'Exam generation, notes, doubt solving, insight summaries, and admin automation.' },
          ],
        },
      },
      flow: {
        enabled: { type: Boolean, default: true },
        kicker: { type: String, default: 'Connected operations' },
        title: { type: String, default: 'Every department works from the same record.' },
        description: { type: String, default: 'Admissions become student records, timetable slots become attendance sessions, results become parent visibility, and fees become finance dashboards.' },
        nodes: {
          type: [{
            icon: { type: String, default: '' },
            title: { type: String, default: '' },
            description: { type: String, default: '' },
          }],
          default: [
            { icon: 'fas fa-user-plus', title: 'Admissions', description: 'Applications to enrollment' },
            { icon: 'fas fa-calendar-week', title: 'Academics', description: 'Courses, timetable, classes' },
            { icon: 'fas fa-user-check', title: 'Attendance', description: 'Manual and smart signals' },
            { icon: 'fas fa-file-invoice-dollar', title: 'Finance', description: 'Dues, receipts, collections' },
            { icon: 'fas fa-chart-simple', title: 'Analytics', description: 'Risk, readiness, decisions' },
          ],
        },
      },
      roles: {
        enabled: { type: Boolean, default: true },
        kicker: { type: String, default: 'Role portals' },
        title: { type: String, default: 'Different users, one connected source of truth.' },
        description: { type: String, default: 'Every stakeholder gets the workspace they need while administrators keep centralized governance.' },
        items: {
          type: [{
            icon: { type: String, default: '' },
            title: { type: String, default: '' },
            description: { type: String, default: '' },
            href: { type: String, default: '#' },
          }],
          default: [
            { icon: 'fas fa-satellite-dish', title: 'Super Admin', description: 'Tenant control, system health, plan management, broadcast tools, and audit logs.', href: './pages/super-admin/dashboard.html' },
            { icon: 'fas fa-university', title: 'College Admin', description: 'Run admissions, faculty, students, fees, logistics, notices, courses, and HR.', href: './pages/college-admin/dashboard.html' },
            { icon: 'fas fa-chalkboard-user', title: 'Faculty', description: 'Attendance, grading, live classes, assignments, leave, timetable, and AI support.', href: './pages/faculty/dashboard.html' },
            { icon: 'fas fa-user-graduate', title: 'Student', description: 'Courses, attendance, assignments, fees, live classes, library, results, and AI tutor.', href: './pages/student/dashboard.html' },
            { icon: 'fas fa-users', title: 'Parent', description: 'Ward profile, attendance, results, fee status, notices, and mentor messages.', href: './pages/parent/dashboard.html' },
          ],
        },
      },
      ai: {
        enabled: { type: Boolean, default: true },
        kicker: { type: String, default: 'AI and analytics' },
        title: { type: String, default: 'Turn campus data into early action.' },
        description: { type: String, default: 'Vishva ERP combines live operational data with AI-assisted workflows so administrators see what needs attention before it becomes a problem.' },
        insights: {
          type: [{
            icon: { type: String, default: '' },
            text: { type: String, default: '' },
          }],
          default: [
            { icon: 'fas fa-triangle-exclamation', text: 'Attendance shortage prediction before exam eligibility deadlines.' },
            { icon: 'fas fa-money-check-dollar', text: 'Fee collection prioritization by amount, due date, and student risk.' },
            { icon: 'fas fa-wand-magic-sparkles', text: 'AI-generated exam papers, notes, summaries, and student doubt support.' },
            { icon: 'fas fa-chart-line', text: 'Executive reporting across colleges, departments, roles, plans, and revenue.' },
          ],
        },
      },
      install: {
        enabled: { type: Boolean, default: true },
        kicker: { type: String, default: 'Multi-Platform Access' },
        title: { type: String, default: 'Your campus platform, everywhere.' },
        description: { type: String, default: 'Built mobile-first. Whether you are a student checking attendance or an administrator approving leaves, the experience is fast, native, and always in sync.' },
        items: {
          type: [{
            icon: { type: String, default: '' },
            title: { type: String, default: '' },
            description: { type: String, default: '' },
          }],
          default: [
            { icon: 'fas fa-bolt', title: 'Instant Updates', description: 'One codebase means app and web always have the latest features.' },
            { icon: 'fas fa-bell', title: 'Role-Based Notifications', description: 'Native alerts for fee dues, exam results, and academic notices.' },
            { icon: 'fas fa-shield-halved', title: 'Secure & Private', description: 'End-to-end encryption with role-based access controls.' },
          ],
        },
      },
      implementation: {
        enabled: { type: Boolean, default: true },
        kicker: { type: String, default: 'Implementation path' },
        title: { type: String, default: 'Move from setup to daily operations quickly.' },
        description: { type: String, default: 'Start with the core ERP and expand into intelligence, automation, and campus-wide communication.' },
        steps: {
          type: [{
            num: { type: String, default: '' },
            title: { type: String, default: '' },
            description: { type: String, default: '' },
          }],
          default: [
            { num: '01', title: 'Create tenant', description: 'Institution, admins, plan, departments' },
            { num: '02', title: 'Load master data', description: 'Students, faculty, courses, batches' },
            { num: '03', title: 'Run operations', description: 'Attendance, fees, notices, exams' },
            { num: '04', title: 'Connect users', description: 'Student, faculty, parent portals' },
            { num: '05', title: 'Optimize with AI', description: 'Insights, reports, recommendations' },
          ],
        },
      },
      security: {
        enabled: { type: Boolean, default: true },
        kicker: { type: String, default: 'Security and governance' },
        title: { type: String, default: 'Designed for institutional control, privacy, and auditability.' },
        description: { type: String, default: 'Vishva ERP keeps sensitive academic, financial, and attendance data inside role-aware workflows. Smart attendance is consent-based.' },
        points: {
          type: [{
            icon: { type: String, default: '' },
            text: { type: String, default: '' },
          }],
          default: [
            { icon: 'fas fa-user-shield', text: 'Scoped access for Super Admin, College Admin, Faculty, Student, and Parent users.' },
            { icon: 'fas fa-clock-rotate-left', text: 'Full audit trail for attendance, fees, exams, notices, leaves, and communication.' },
            { icon: 'fas fa-location-crosshairs', text: 'Privacy-first smart attendance with student consent and classroom geofence signals.' },
            { icon: 'fas fa-database', text: 'Tenant-aware data model for institutions, departments, users, and role portals.' },
          ],
        },
      },
    },
    pricing: {
      enabled: { type: Boolean, default: true },
      kicker: { type: String, default: 'Deployment models' },
      title: { type: String, default: 'Fit for single colleges and university networks.' },
      description: { type: String, default: 'Use the same platform for a focused campus rollout or a larger multi-institution command layer.' },
      plans: {
        type: [{
          title: { type: String, default: '' },
          description: { type: String, default: '' },
          highlight: { type: String, default: '' },
          badge: { type: String, default: '' },
          featured: { type: Boolean, default: false },
          ctaLabel: { type: String, default: 'Start Setup' },
          ctaHref: { type: String, default: './pages/register.html' },
        }],
        default: [
          { title: 'College ERP', description: 'For single colleges and autonomous institutions modernizing daily administration.', highlight: 'Core campus suite', badge: '', featured: false, ctaLabel: 'Start Setup', ctaHref: './pages/register.html' },
          { title: 'University Network', description: 'For multi-campus groups needing central oversight with isolated institutional workspaces.', highlight: 'Advanced analytics and governance', badge: 'Recommended', featured: true, ctaLabel: 'Deploy Network', ctaHref: './pages/register.html' },
          { title: 'School & Training', description: 'For schools, coaching, vocational academies, and training organizations with role portals.', highlight: 'Flexible academic operations', badge: '', featured: false, ctaLabel: 'Get Started', ctaHref: './pages/register.html' },
        ],
      },
    },
    cta: {
      enabled: { type: Boolean, default: true },
      kicker: { type: String, default: 'Ready to modernize your campus?' },
      title: { type: String, default: 'Bring admissions, academics, attendance, finance, HR, and analytics into one intelligent platform.' },
      primaryCtaLabel: { type: String, default: 'Register Institution' },
      secondaryCtaLabel: { type: String, default: 'Sign In' },
      proof: {
        type: [String],
        default: ['Free to start', 'No credit card required', 'Setup in minutes'],
      },
    },
    footer: {
      description: { type: String, default: 'Enterprise academic management platform for colleges, universities, school groups, and training institutions.' },
      columns: {
        type: [{
          title: { type: String, default: '' },
          links: [{ label: { type: String, default: '' }, href: { type: String, default: '#' } }],
        }],
        default: [
          { title: 'Platform', links: [
            { label: 'Features', href: '#features' },
            { label: 'Command Center', href: '#platform' },
            { label: 'Modules', href: '#modules' },
            { label: 'Security', href: '#security' },
          ] },
          { title: 'Portals', links: [
            { label: 'College Admin', href: './pages/college-admin/dashboard.html' },
            { label: 'Faculty', href: './pages/faculty/dashboard.html' },
            { label: 'Student', href: './pages/student/dashboard.html' },
            { label: 'Parent', href: './pages/parent/dashboard.html' },
          ] },
          { title: 'Get Started', links: [
            { label: 'Register Institution', href: './pages/register.html' },
            { label: 'Sign In', href: './pages/login.html' },
            { label: 'Pricing', href: '#pricing' },
          ] },
        ],
      },
      twitter: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      github: { type: String, default: '' },
      copyright: { type: String, default: '\u00a9 2026 Vishva ERP. All rights reserved.' },
      tagline: { type: String, default: 'Enterprise academic management platform.' },
    },
    auth: {
      loginTitle: { type: String, default: 'Welcome back' },
      loginSubtitle: { type: String, default: 'Sign in to your VishvaERP account' },
      registerTitle: { type: String, default: 'Create Account' },
      registerSubtitle: { type: String, default: 'Join VishvaERP and transform your institution' },
      heroTitle: { type: String, default: 'Enterprise Academic Platform' },
      heroDescription: { type: String, default: 'The complete ERP built for educational institutions \u2014 managing thousands of students, faculty, and operations in one place.' },
    },
  },
  // ── Dashboard UI text overrides (key -> replacement string) ──
  // Keys are generated by scripts/build-cms-catalog.js from data-cms attributes.
  uiText: { type: Object, default: () => ({}) },
}, { timestamps: true });

module.exports = mongoose.model('PlatformSetting', platformSettingSchema);
