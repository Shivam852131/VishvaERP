let openaiClient = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getOpenAI() {
  if (openaiClient) return openaiClient;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (e) {
    console.error('OpenAI client initialization failed:', e.message);
    openaiClient = null;
  }
  return openaiClient;
}

// Which AI provider to use: free Google Gemini is preferred when its key is set,
// OpenAI otherwise. With no key the service returns local fallback templates.
function getAIProvider() {
  const explicit = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'gemini' || explicit === 'openai') return explicit;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => ['user', 'assistant'].includes(item?.role) && item.content)
    .slice(-12)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 4000) }));
}

// Echo only the user's actual question back (custom prompts, e.g. campus
// intelligence, prepend data blobs and a "User Query:" line).
function extractQuestion(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/User Query:\s*([\s\S]+)$/i);
  let question = match ? match[1].trim() : raw;
  question = question.replace(/^(?:generate\s+(?:comprehensive\s+)?(?:study\s+)?notes\s+for(?:\s+the\s+topic)?:?|create\s+a\s+study\s+plan:?|student\s+query:?|teacher\s+query:?|parent\s+query:?|interview\s+practice:?|help\s+build\s+a\s+resume:?)\s*/i, '');
  return question.length > 600 ? `${question.slice(0, 600)}…` : question;
}

// Which endpoint/mode produced this system prompt? getSystemPrompt() always starts
// with the matching SYSTEM_PROMPTS entry, so a prefix lookup identifies it exactly.
function resolveMode(systemPrompt, options = {}) {
  if (options.mode) return options.mode;
  const prompt = String(systemPrompt || '');
  return Object.keys(SYSTEM_PROMPTS).find((key) => prompt.startsWith(SYSTEM_PROMPTS[key])) || null;
}

const MODE_FALLBACK = {
  tutor: 'tutor',
  notes: 'notes',
  exam: 'exam',
  questionPaper: 'exam',
  assignmentChecker: 'assignment',
  reportCard: 'report',
  parentAssistant: 'parent',
  teacherAssistant: 'teacher',
  studentAssistant: 'student',
  studyPlanner: 'student',
  resumeBuilder: 'resume',
  interviewCoach: 'interview',
  chat: null, // free-form chat: decide from the question itself
};

// Word-boundary matching only, so "examples" no longer reads as "exam".
function classifyQuestion(question) {
  const q = String(question || '').toLowerCase();
  if (/\b(notes?|summary|summarize|summarise|revision|revise)\b/.test(q)) return 'notes';
  if (/\b(resume|cv)\b/.test(q)) return 'resume';
  if (/\b(lesson plan|rubric|grading|grade my|classroom|teach)\b/.test(q)) return 'teacher';
  if (/\b(my child|parenting|son|daughter)\b/.test(q)) return 'parent';
  if (/\b(study plan|study schedule|timetable|syllabus)\b/.test(q)) return 'student';
  if (/\b(how|why|explain|understand|solve|doubt|concept|step-by-step)\b/.test(q)) return 'tutor';
  if (/\b(exam|quiz|mcq|question paper)\b/.test(q)) return 'exam';
  return 'generic';
}

function resolveFallbackKind(systemPrompt, question, options = {}) {
  const mode = resolveMode(systemPrompt, options);
  const mapped = mode ? MODE_FALLBACK[mode] : undefined;
  if (mapped) return mapped;
  return classifyQuestion(question);
}

const HUMAN_VOICE_GUIDELINES = `
Advanced Pedagogical & Human Communication Directives:
1. Tone & Persona: Speak as an accomplished university professor, master tutor, and distinguished industry mentor—intellectually rigorous, deeply knowledgeable, articulate, warm, and engaging.
2. Natural Human Language: Use fluid, authentic human phrasing. Never sound robotic, formulaic, or like an artificial corporate template. Avoid hollow clichés (such as "Certainly! I'd be happy to help", "As an AI language model...", "In conclusion, it is important to remember...", or endless superficial bullet points).
3. Depth & Understanding: Explain the fundamental "why" and intuitive mental models before presenting formulas, code, or rules. Highlight trade-offs, real-world engineering or practical applications, common student stumbling blocks, and nuanced edge cases.
4. Formatting & Flow: Structure your thoughts elegantly with readable prose paragraphs, bold conceptual anchors, clear section hierarchies, well-commented code/math blocks, and engaging reflective takeaways.
`;

function buildFallbackResponse(prompt, systemPrompt = '', options = {}) {
  const text = extractQuestion(prompt);
  const kind = resolveFallbackKind(systemPrompt, text, options);

  const isExam = kind === 'exam';
  const isResume = kind === 'resume';
  const isAssignment = kind === 'assignment';
  const isReport = kind === 'report';
  const isParent = kind === 'parent';
  const isTeacher = kind === 'teacher';
  const isStudent = kind === 'student';
  const isNotes = kind === 'notes';
  const isTutor = kind === 'tutor';
  const isInterview = kind === 'interview';

  if (isExam) {
    return `### Examination Assessment Blueprint: ${text || 'Selected Academic Topic'}

#### Section A: Conceptual Foundations (Recall & Precision — 20%)
1. Define the fundamental governing law of **${text || 'this topic'}** and state its critical operational boundary conditions. *(3 Marks)*
2. Distinguish between theoretical capacity and practical performance limits with one concrete counter-example. *(3 Marks)*

#### Section B: Analytical Problem-Solving (Application & Analysis — 40%)
3. Given a standard scenario where load increases dynamically, calculate the expected system latency or throughput. Show all intermediate derivation steps. *(7 Marks)*
4. Identify and critique the primary architectural bottleneck in the provided design pattern, proposing a resilient mitigation strategy. *(7 Marks)*

#### Section C: Synthesis & System Design (Evaluation & Creation — 40%)
5. Formulate a comprehensive implementation strategy that meets strict fault-tolerance criteria. Justify your architectural trade-offs against cost, maintainability, and scalability. *(10 Marks)*

---
*Pedagogical Alignment: Questions adhere strictly to Bloom's Revised Taxonomy, distributing assessment weight across conceptual recall, mathematical derivation, and higher-order architectural synthesis.*`;
  }

  if (isResume) {
    return `### Executive Resume Blueprint & Narrative Strategy for ${text || 'Professional Profile'}

#### 1. Narrative Architecture (The Senior Engineering Standard)
Top-tier engineering and leadership recruiters review resumes in under 6 seconds. Shift from passive responsibility listings ("Responsible for managing...") to impact-driven accomplishment statements using Google's **XYZ Formula**:
> *"Accomplished [X], as measured by [Y], by doing [Z]."*

#### 2. High-Impact Section Framework

**PROFESSIONAL SUMMARY**
> High-velocity software engineer specializing in scalable distributed backends and cloud systems. Proven track record of optimizing latency, driving automated CI/CD resiliency, and delivering enterprise multi-tenant platforms handling high concurrent user loads.

**CORE TECHNICAL COMPETENCIES**
- **Systems & Languages**: Node.js, TypeScript, Python, Go, C++, SQL
- **Architecture & Cloud**: Microservices, Event-Driven Architecture, AWS, Docker, Kubernetes, Nginx
- **Data & Databases**: MongoDB, PostgreSQL, Redis, Query Optimization, Sharding & Indexing
- **Security & Reliability**: JWT/RBAC, Zero-Trust Architecture, OWASP Hardening, Prometheus, Grafana

**FEATURED PROJECT BREAKDOWN**
- **Vishva ERP Multi-College SaaS Platform** | *Node.js, Express, MongoDB, Socket.io, Redis*
  - Engineered resilient multi-tenant role-based access control (RBAC) isolating 5 distinct campus tiers with zero cross-tenant leakage.
  - Implemented high-throughput streaming AI endpoints and real-time WebSocket communication supporting concurrent classroom sessions.
  - Hardened API endpoints against OWASP Top 10 vulnerabilities, reducing attack surface and eliminating authorization bypass vectors.

#### 3. Strategic Action Item
Review your current bullet points and ensure every bullet ends with a quantifiable metric (e.g. *"% reduction in response time"*, *"hours saved per week"*, or *"cost efficiency achieved"*).`;
  }

  if (isAssignment) {
    return `### Comprehensive Academic Evaluation & Rubric Feedback

**Subject Analysis Focus:** ${text || 'Submitted Academic Assignment'}

#### 1. Qualitative Evaluation & Rubric Breakdown
- **Conceptual Accuracy (9/10)**: Demonstrates solid mastery of primary definitions and principles. The fundamental mechanisms are correctly stated without conceptual confusion.
- **Analytical Depth (8/10)**: Successfully explores the "why" behind the phenomenon rather than merely reciting facts. To reach perfection, explore edge cases where the core theorem faces real-world constraints.
- **Structural Cohesion & Scholarly Tone (8/10)**: Clear progression of thought with articulate transitions between paragraphs.
- **Evidence & Contextual Application (7/10)**: Good theoretical baseline; would benefit substantially from citing a modern empirical study or production case study.

#### 2. Key Distinctive Strengths
- Precise vocabulary and lucid conceptual explanations.
- Well-structured introductory premise and clear conclusion.

#### 3. Concrete Opportunities for Elevation
- **Anchor with Real-World Data**: In your central argument, ground the theoretical claims in measurable benchmarks or historical precedents.
- **Synthesize Contrasting Perspectives**: Briefly acknowledge alternative schools of thought or competing architectural designs to demonstrate nuanced intellectual maturity.

#### 4. The Path to Top-Tier Mastery
Reframe your core thesis to directly address trade-offs: when does this method fail, and what fallback mechanism would an engineer or researcher deploy? This elevates the submission from a standard descriptive essay to a rigorous scholarly analysis.`;
  }

  if (isReport) {
    return `### Academic Trajectory & Holistic Growth Diagnostic

**Student Profile Focus:** ${text || 'Student Performance Analytics'}

#### 1. Executive Summary & Trajectory Analysis
A multi-dimensional review of performance metrics indicates strong positive academic momentum, accompanied by identifiable high-leverage opportunities for focused intervention. 

#### 2. Performance Diagnostic by Cognitive Domain
- **Quantitative & Analytical Disciplines**: Outstanding conceptual fluency (Top 10th percentile). Demonstrates strong first-principles reasoning and rapid problem-solving execution.
- **Verbal & Conceptual Synthesis**: Steady baseline performance with consistent engagement. Opportunity to elevate expressive depth and critical argumentation.
- **Laboratory & Applied Project Work**: Exceptional practical initiative; translates theoretical concepts into functional models with high fidelity.

#### 3. Tailored 4-Week Mastery Roadmap
- **Weeks 1–2 (Foundation Consolidation)**: Implement 30-minute daily active-recall sessions targeting identified conceptual bottlenecks.
- **Weeks 3–4 (Applied Problem Synthesis)**: Transition from textbook exercises to past examination papers under timed, exam-fidelity conditions.

#### 4. Motivational Perspective
Academic progress is rarely linear—breakthroughs occur when foundational understanding solidifies into effortless pattern recognition. Consistent, deliberate practice in your growth areas will rapidly unlock top-tier academic distinction.`;
  }

  if (isParent) {
    return `### University Family Academic Liaison Guidance

**Parent Query Focus:** ${text || 'Holistic Student Development'}

#### 1. Academic Growth & Progress Perspective
Fostering a student's long-term academic excellence requires balancing rigorous intellectual discipline with genuine emotional support. Here is a clear, actionable perspective on supporting their university journey:

#### 2. Pillars of Academic & Personal Flourishing
- **Consistent Cognitive Routine**: Encourage protected, distraction-free study blocks (using 45-minute focused intervals followed by 10-minute restorative breaks). Predictability significantly reduces academic fatigue.
- **Praising Process Over Outcome**: Highlight perseverance, curiosity, and problem-solving strategies rather than raw grades alone. This cultivates a resilient growth mindset that thrives when facing challenging coursework.
- **Active Institutional Communication**: Maintain an open dialogue with department faculty and academic advisors early in the semester, well before midterms or finals.

#### 3. Practical Home Dialogue Starter
Rather than asking *"Did you study today?"*, try asking: *"What was the most fascinating or challenging concept your professor discussed this week, and how does it connect to the real world?"* This invites the student to articulate their learning, reinforcing retention while sparking meaningful conversation.`;
  }

  if (isTeacher) {
    return `### Instructional Strategy & Academic Pedagogy Consultation

**Teaching Focus:** ${text || 'Curriculum Design & Classroom Dynamics'}

#### 1. Pedagogical Architecture
To elevate classroom engagement and conceptual retention, consider structuring your instructional units around **Active Learning & Cognitive Interleaving**:

#### 2. Master Lesson Framework (60-Minute Structure)
1. **The Cognitive Hook (5 Minutes)**: Open with a provocative real-world paradox or failure case that cannot be resolved without today's core concept.
2. **First-Principles Exposition (20 Minutes)**: Deconstruct the fundamental theory, emphasizing intuitive mental models before formal mathematical notation or syntax.
3. **Peer Instruction & Socratic Dialectic (15 Minutes)**: Present a conceptual challenge with plausible distractors; have students debate solutions in pairs before polling the cohort.
4. **Hands-On Synthesis (15 Minutes)**: Live demonstration or collaborative problem-solving applying the theory to a realistic dataset or scenario.
5. **The Reflective Exit Ticket (5 Minutes)**: Students document one key insight and one remaining question before dismissing.

#### 3. Multi-Tiered Evaluation Rubric
- **Level 4 (Exemplary)**: Demonstrates original synthesis, critiques edge cases, and justifies design choices rigorously.
- **Level 3 (Proficient)**: Correctly applies theoretical framework without conceptual errors.
- **Level 2 (Developing)**: Understands core definitions but struggles with non-standard problem parameters.
- **Level 1 (Novice)**: Requires scaffolding to identify foundational mechanisms.`;
  }

  if (isStudent) {
    return `### Academic Mastery & Cognitive Optimization Strategy

**Target Goal:** ${text || 'High-Yield Academic Performance'}

#### 1. The Science of High-Retention Learning
Cramming and passive rereading create the *illusion of competence*. To build durable, exam-resilient mastery, adopt cognitive techniques validated by modern neuroscience:

#### 2. Core Operational Playbook
- **Spaced Retrieval Practice**: Test yourself on key concepts at increasing intervals (Day 1, Day 3, Day 7, Day 14). Active recall physically strengthens neural pathways.
- **The Feynman Explanation Protocol**: Take a blank sheet of paper and explain the concept in plain, conversational language as if teaching a first-year student. Wherever you resort to jargon or stall, consult your lecture notes—that is your precise knowledge gap.
- **Interleaved Problem Sets**: Avoid practicing 20 identical problems in a row. Mix problems from different chapters to force your brain to practice *identifying which strategy to apply*.

#### 3. Daily High-Performance Rhythm
- **Morning Focus Block (90 Minutes)**: Tackle your most demanding intellectual challenge when willpower and cognitive energy peak.
- **Pomodoro Cycles (50m Focus / 10m Walk)**: Protect your attentional stamina by stepping away from screens during breaks.
- **Nightly Synthesis (10 Minutes)**: Write down the top 3 conceptual priorities for tomorrow before sleeping.`;
  }

  if (isNotes) {
    return `### University Lecture Notes: ${text || 'Topic Overview'}

#### I. Foundational Principle & Big Picture
At its core, **${text || 'this subject'}** addresses how complex systems organize, process, and optimize operations under realistic real-world constraints. Mastering this topic provides the conceptual bridge between theoretical coursework and production-grade engineering.

#### II. Core Principles & Theoretical Mechanics
- **Primary Mechanism**: The fundamental rule governing behavior and execution flow.
- **Architectural Trade-offs**: Why this approach is chosen over alternatives, weighing complexity against performance.
- **Standard Invariants**: Crucial properties that must always hold true during state transitions.

#### III. Key Definitions & Terminology
- **Formal Definition**: The precise academic and industry terminology expected in university examinations.
- **Governing Equations / Workflow**: Step-by-step mathematical representation or algorithmic lifecycle.

#### IV. High-Yield Examination Insights
1. **Common Trap**: Examiners frequently test edge cases where standard assumptions break down—be sure to state boundary conditions explicitly.
2. **Scoring Strategy**: Always illustrate your answer with an architectural diagram or clear state-transition table before writing prose.

#### V. Spaced-Repetition Revision Prompt
Try explaining this concept from memory using the *Feynman Technique* in 60 seconds without consulting reference notes. If you hit an explanatory gap, that pinpoint identifies your next revision priority.`;
  }

  if (isInterview) {
    return `### Technical & Behavioral Interview Coaching: ${text || 'Candidate Response'}

#### 1. Interview Evaluation & Performance Metrics
- **Relevance & Directness (8/10)**: Opens with a clear, focused thesis addressing the interviewer's prompt directly.
- **Technical Precision & Depth (8/10)**: Sound domain knowledge; articulates core concepts with appropriate engineering vocabulary.
- **Structural Clarity (STAR Format) (8/10)**: Strong narrative arc; clearly separates context, action, and final results.
- **Quantifiable Business / Engineering Impact (7/10)**: Opportunity to strengthen the conclusion with exact metrics (e.g. latency, throughput, scale).

#### 2. The Senior Engineer Answer Blueprint (STAR + Trade-offs)
1. **Situation & Task**: Set the technical context concisely (keep to under 30 seconds). What was the critical architectural challenge?
2. **Action & Implementation**: Focus on *your* specific technical contributions. What trade-offs did you evaluate, and why did you select this particular design?
3. **Measurable Result**: Quantify the outcome (e.g., *"Reduced P99 query latency by 42% while cutting memory overhead by 15%"*).
4. **Retrospective Reflection**: *"If I were to design this system today at 10x the scale, I would incorporate asynchronous event streaming to decouple the ingestion layer."*

#### 3. Strategic Polishing Tip
When answering technical questions, always voice your thought process out loud. Interviewers care far more about how you navigate ambiguity, weigh trade-offs, and debug edge cases than whether you memorize an algorithm verbatim.`;
  }

  if (isTutor) {
    return `### Academic Concept Breakdown: ${text || 'Core Problem'}

#### 1. The Intuitive Mental Model
Before diving into technical mechanics or equations, let's understand the core intuition:
What fundamental problem was this designed to solve? In real systems, we introduce this concept to balance trade-offs—such as computational efficiency vs. memory overhead, or modular abstraction vs. raw throughput.

#### 2. First-Principles Walkthrough
1. **The Starting State**: Identify your known inputs, constraints, and boundary conditions.
2. **The Transformation**: At each discrete transition step, trace exactly what data or energy shifts.
3. **The Invariant**: Notice what property remains unchanged throughout the process—this is the key to solving exam problems and debugging production issues.

#### 3. Real-World Engineering Context
In production software and modern industry architectures, this concept is commonly employed where reliability and deterministic performance are paramount.

#### 4. Active Checkpoint
To solidify this in your long-term memory: can you explain back to me what happens if we double the input scale or violate the primary boundary condition? Take a moment to test yourself, and share your reasoning so we can refine it together.`;
  }

  return `### Academic Guidance & Problem-Solving Perspective

**Query Focus:** ${text || 'Academic Consultation'}

#### 1. Understanding the Core Objective
To approach this effectively, let's break the challenge into logical, first-principles components:
1. **Identify the Invariant**: What is the fundamental outcome we are trying to achieve?
2. **Isolate the Constraints**: What limitations (time, computational complexity, syllabus boundaries) define our solution space?
3. **Execute Methodically**: Formulate the response step-by-step, validating assumptions at each juncture.

#### 2. Practical Next Step
Share any specific course requirements, code snippets, or lecture topics you are currently exploring. I am ready to walk through the complete analytical derivation with you in natural, conversational detail.`;
}

const SYSTEM_PROMPTS = {
  chat: `You are Vishva AI, a senior intellectual mentor and academic advisor across the university campus. Engage in thoughtful, natural conversation. Listen deeply to the user's query, provide thorough, nuanced answers grounded in real-world context, and offer proactive, intellectually stimulating follow-ups. Speak with authentic human warmth and academic clarity.`,
  tutor: `You are Vishva AI Master Academic Tutor. Teach with the patience, lucidity, and profound depth of a master educator. Begin by building an intuitive mental model of the concept before introducing formal equations or syntax. Break problems down step by step, illuminate subtle edge cases and examination traps, connect theory to industry reality, and challenge the student with an engaging checkpoint question to reinforce active recall.`,
  notes: `You are Vishva AI Academic Notes Architect. Craft comprehensive, university-standard study notes with exceptional intellectual clarity. Blend rich narrative exposition with structured conceptual anchors: core principles, theoretical foundations, mathematical/algorithmic workflows, concrete real-world examples, high-yield examination insights, and active-recall revision prompts.`,
  exam: `You are Vishva AI Examination Board Director. Design rigorous, balanced, and intellectually challenging assessments aligned with modern pedagogical standards. Craft precise questions that test both deep conceptual mastery and real-world synthesis (spanning Bloom's taxonomy from understanding to evaluation). Include comprehensive marking rubrics, detailed solutions, and explanatory rationales.`,
  studentAssistant: `You are Vishva AI Senior Student Mentor. Support students with empathetic wisdom, high-level academic strategy, and practical human advice. Help them conquer challenging curricula, optimize their cognitive schedules using spaced repetition and active recall, overcome academic stress, and build durable intellectual discipline.`,
  teacherAssistant: `You are Vishva AI Faculty Colleague & Instructional Strategist. Collaborate with educators on advanced pedagogy, curriculum design, multi-tiered grading rubrics, active learning dynamics, and student performance diagnostics. Communicate collegially, maintaining the highest standards of academic excellence.`,
  parentAssistant: `You are Vishva AI Family Academic Liaison. Communicate with parents in warm, transparent, and empathetic human language. Demystify academic evaluations, attendance metrics, and college policies. Provide practical, supportive guidance on fostering their child's curiosity, emotional well-being, and academic resilience at home.`,
  questionPaper: `You are Vishva AI University Question Paper Architect. Construct complete, meticulously balanced examination papers that evaluate genuine comprehension over rote memorization. Structure questions with clear section blueprints, marks distribution, real-world case scenarios, and unambiguous solution guides.`,
  assignmentChecker: `You are Vishva AI Senior Assignment Evaluator. Evaluate student submissions with the discernment of an expert scholar. Provide multi-dimensional rubric feedback covering conceptual precision, depth of analysis, structured argumentation, and empirical evidence. Highlight distinctive strengths, constructively analyze flaws, and provide a polished exemplar illustrating how to elevate the work to top-tier academic standard.`,
  reportCard: `You are Vishva AI Student Growth & Analytics Mentor. Interpret academic transcripts into a holistic, human developmental narrative. Synthesize performance patterns, identify latent strengths and conceptual bottlenecks, and lay out an actionable, multi-week mastery roadmap with genuine encouragement.`,
  studyPlanner: `You are Vishva AI Cognitive Study Architect. Design realistic, high-retention revision schedules rooted in cognitive science: interleaved practice, Pomodoro pacing, spaced repetition intervals, and energy management.`,
  resumeBuilder: `You are Vishva AI Senior Industry Career Strategist. Guide students in crafting high-impact, narrative-driven resumes that stand out to technical recruiters and admissions committees. Transform passive task lists into compelling achievement statements using the STAR and Google XYZ formulas (Accomplished [X], as measured by [Y], by doing [Z]).`,
  interviewCoach: `You are Vishva AI Senior Technical & Behavioral Interview Coach. Conduct immersive, realistic mock interviews with the rigor of a principal engineer or hiring director. Critique answers with constructive honesty: evaluating structural clarity, technical accuracy, metric-backed impact, and authentic personal presence.`,
};

function getSystemPrompt(mode, req) {
  const role = req?.user?.role || 'user';
  const collegeId = req?.user?.collegeId || 'University Campus';
  const basePrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.chat;
  return `${basePrompt}\n\n${HUMAN_VOICE_GUIDELINES}\nInstitutional Context: Authenticated Role: ${role} | Campus ID: ${collegeId}. Always address the user with academic respect, natural human cadence, and intellectual depth.`;
}

function buildPrompt(mode, body) {
  const message = String(body.message || body.question || body.topic || '').trim();
  if (mode === 'notes') return `Generate notes for: ${message}`;
  if (mode === 'exam') {
    return `Generate an exam or quiz for subject: ${body.subject || message}. Difficulty: ${body.difficulty || 'medium'}. Number of questions: ${body.numQuestions || 5}. Include answers.`;
  }
  if (mode === 'studentAssistant') {
    return `Student query: ${message}\nContext: Help with study planning, homework, exam prep, or academic progress.`;
  }
  if (mode === 'teacherAssistant') {
    return `Teacher query: ${message}\nContext: Help with lesson plans, grading, class management, or student analytics.`;
  }
  if (mode === 'parentAssistant') {
    return `Parent query: ${message}\nContext: Help with child tracking, academic progress, attendance, fees, or parenting guidance.`;
  }
  if (mode === 'studyPlanner') {
    return `Create a study plan: ${message}\nProvide a structured schedule with time blocks, subject allocation, and revision cycles.`;
  }
  if (mode === 'resumeBuilder') {
    return `Help build a resume: ${message}\nProvide structured resume content with sections, bullet points, and professional language.`;
  }
  if (mode === 'interviewCoach') {
    return `Interview practice: ${message}\nConduct a mock interview or provide interview feedback and tips.`;
  }
  return message;
}

// Form-based tool builders
function buildQuestionPaperPrompt(body) {
  const { subject, totalMarks, duration, types, difficulty, instructions } = body;
  const typeList = (types && types.length) ? types.join(', ') : 'MCQ, Short Answer, Long Answer';
  return `Generate a complete ${totalMarks || 100}-mark question paper for the subject: ${subject}.
Duration: ${duration || '3 hours'}.
Question types: ${typeList}.
Difficulty distribution: ${difficulty || 'balanced'}.
${instructions ? `Additional instructions: ${instructions}` : ''}

Include:
1. Header with subject, total marks, duration, and instructions to students.
2. Section A (Objective/MCQ) with 1-mark questions.
3. Section B (Short Answer) with 3-5 mark questions.
4. Section C (Long Answer) with 8-10 mark questions.
5. Proper marks distribution for each question.
6. Answer key at the end (separated clearly).`;
}

function buildAssignmentCheckPrompt(body) {
  const { subject, question, answer, maxMarks } = body;
  return `Evaluate this assignment submission.

Subject: ${subject}
Question: ${question}
Student's Answer: ${answer}
Maximum Marks: ${maxMarks || 20}

Provide a detailed evaluation with:
1. **Marks Breakdown** (Content Accuracy, Depth of Analysis, Structure & Clarity, Examples & Evidence) - each out of a portion of ${maxMarks || 20}.
2. **Strengths** - what the student did well.
3. **Areas for Improvement** - specific, actionable suggestions.
4. **Corrected/Improved Version** - if there are errors, show the correct approach.
5. **Overall Grade and Comments**.
Be fair, constructive, and educational.`;
}

function buildReportCardPrompt(body) {
  const { studentName, className, marks, previousMarks, concerns } = body;
  return `Analyze this student's report card.

Student: ${studentName || 'Student'}
Class: ${className || 'Not specified'}
Current Marks:
${marks}
${previousMarks ? `Previous Semester Marks:\n${previousMarks}` : ''}
${concerns ? `Concern Areas: ${concerns}` : ''}

Provide:
1. **Performance Summary** with overall grade and subject rankings.
2. **Subject-wise Analysis** - strengths and weaknesses.
3. **Trend Analysis** - improvement or decline compared to previous semester (if data given).
4. **Personalized Improvement Plan** with weekly action items.
5. **Motivational Insights** - highlight positives and encourage growth.
Use data-driven language but stay encouraging.`;
}

// ─────────────────────── Google Gemini (free tier) ───────────────────────
// Plain REST calls - no extra npm package needed (Node 18+ ships global fetch).

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Free-tier quota is tracked PER MODEL per project per day (some preview
// models allow as few as 20 requests/day). Chain several models so that when
// one model's daily pool is exhausted (429), the next model answers from its
// own pool instead of dropping the whole request to the offline templates.
// GEMINI_MODEL (env) only selects which model is tried FIRST.
const GEMINI_MODEL_CHAIN = (() => {
  const primary = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const fallbacks = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
  return [...new Set([primary, ...fallbacks])];
})();

// Remember the last model that worked so we skip known-exhausted ones.
let geminiModelIdx = 0;

function geminiModel() {
  return GEMINI_MODEL_CHAIN[geminiModelIdx] || GEMINI_MODEL_CHAIN[0];
}

function toGeminiContents(prompt, history = [], image = null) {
  const contents = normalizeHistory(history).map((turn) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content }],
  }));
  const parts = [{ text: String(prompt || '') }];
  if (image && image.data) {
    parts.push({ inlineData: { mimeType: image.mimeType || 'image/png', data: image.data } });
  }
  contents.push({ role: 'user', parts });
  return contents;
}

function geminiRequestBody({ systemPrompt, prompt, history, image, maxTokens, temperature, jsonMode }) {
  return {
    systemInstruction: { parts: [{ text: String(systemPrompt || '') }] },
    contents: toGeminiContents(prompt, history, image),
    generationConfig: {
      temperature: typeof temperature === 'number' ? temperature : 0.7,
      maxOutputTokens: maxTokens || 1500,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };
}

async function geminiRequest(pathAndQuery, body) {
  let lastError = null;
  for (let i = geminiModelIdx; i < GEMINI_MODEL_CHAIN.length; i++) {
    const model = GEMINI_MODEL_CHAIN[i];
    const url = `${GEMINI_API_BASE}/${model}:${pathAndQuery}`;
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY || '' },
      body: JSON.stringify(body),
    };
    let tryNextModel = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res;
      try {
        res = await fetch(url, init);
      } catch (e) {
        lastError = new Error(`Gemini network error: ${e.message}`);
        if (attempt < 2) { await delay(700); continue; }
        tryNextModel = true; // network failed twice for this model - the next one may still work
        break;
      }
      if (res.ok) {
        geminiModelIdx = i; // remember the model that works
        return res;
      }
      const detail = await res.text().catch(() => '');
      lastError = new Error(`Gemini API ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
      const transient = res.status === 500 || res.status === 502 || res.status === 503;
      if (transient && attempt < 2) { await delay(700); continue; }
      if (res.status === 429 || res.status === 404) {
        // Per-model daily quota exhausted (429) or model retired (404):
        // the next model in the chain has its own quota pool.
        const nextModel = GEMINI_MODEL_CHAIN[i + 1];
        if (nextModel) console.warn(`Gemini model ${model} unavailable (HTTP ${res.status}) - trying ${nextModel} instead`);
        tryNextModel = true;
        break;
      }
      throw lastError; // 400/401/403 etc - a different model would not change this
    }
    if (tryNextModel) continue;
  }
  throw lastError || new Error('Gemini request failed');
}

function geminiTextFrom(payload, trimText = true) {
  const text = (payload?.candidates || [])
    .map((candidate) => (candidate?.content?.parts || []).map((part) => part.text || '').join(''))
    .join('');
  // Only trim whole responses. Trimming per-chunk in the SSE stream would eat
  // leading spaces at chunk boundaries ("The" + " boiling" -> "Theboiling").
  return trimText ? text.trim() : text;
}

async function geminiGenerate(params) {
  const res = await geminiRequest('generateContent', geminiRequestBody(params));
  const data = await res.json();
  const text = geminiTextFrom(data);
  if (!text) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'no candidates';
    throw new Error(`Gemini returned no text (${reason})`);
  }
  return text;
}

async function geminiStream({ systemPrompt, prompt, history = [], maxTokens, onToken }) {
  const res = await geminiRequest('streamGenerateContent?alt=sse', geminiRequestBody({
    systemPrompt, prompt, history, maxTokens, temperature: 0.7,
  }));
  if (!res.body) throw new Error('Gemini stream response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let token = '';
      try { token = geminiTextFrom(JSON.parse(payload), false); } catch (e) { continue; }
      if (!token) continue;
      fullText += token;
      onToken(token);
    }
  }
  if (!fullText) throw new Error('Gemini stream returned no text');
  return fullText;
}

// No provider configured (or a caller without a key): stream the local template.
// When failedProvider is set, the key EXISTS but the live service errored
// (429/network) — append a truthful note instead of implying no key is set.
async function streamFallback(prompt, systemPrompt, onToken, failedProvider = null) {
  const fallback = buildFallbackResponse(prompt, systemPrompt);
  const chunks = fallback.match(/.{1,28}(\s|$)/g) || [fallback];
  for (const chunk of chunks) {
    onToken(chunk);
    await delay(8);
  }
  if (failedProvider) {
    const note = `\n\n_Note: the live ${failedProvider} AI did not respond just now (rate limit or network), so this built-in offline answer was shown instead._`;
    onToken(note);
    return fallback + note;
  }
  return fallback;
}

// Generic AI call
const askAI = async (prompt, systemPrompt = SYSTEM_PROMPTS.chat, options = {}) => {
  const provider = getAIProvider();
  if (!provider) return buildFallbackResponse(prompt, systemPrompt, options);
  try {
    if (provider === 'gemini') {
      return await geminiGenerate({
        systemPrompt,
        prompt,
        history: options.history,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        jsonMode: options.jsonMode,
      });
    }
    const openai = getOpenAI();
    if (!openai) return buildFallbackResponse(prompt, systemPrompt, options);
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...normalizeHistory(options.history),
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: options.maxTokens || 1500,
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error(`AI provider error (${provider}):`, error?.message || error);
    const base = buildFallbackResponse(prompt, systemPrompt, options);
    return `${base}\n\n_Note: the live ${provider} AI did not respond just now (rate limit or network), so this built-in offline answer was shown instead._`;
  }
};
// Streaming AI call
const streamAI = async ({ prompt, systemPrompt = SYSTEM_PROMPTS.chat, history = [], onToken }) => {
  const provider = getAIProvider();
  if (!provider) return streamFallback(prompt, systemPrompt, onToken);
  try {
    if (provider === 'gemini') {
      return await geminiStream({ systemPrompt, prompt, history, maxTokens: 1800, onToken });
    }
    const openai = getOpenAI();
    if (!openai) return streamFallback(prompt, systemPrompt, onToken);
    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...normalizeHistory(history),
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1800,
      stream: true,
    });
    let fullText = '';
    for await (const part of stream) {
      const token = part.choices?.[0]?.delta?.content || '';
      if (!token) continue;
      fullText += token;
      onToken(token);
    }
    return fullText;
  } catch (error) {
    console.error(`AI stream error (${provider}):`, error?.message || error);
    return streamFallback(prompt, systemPrompt, onToken, provider);
  }
};

// ─────────── Structured MCQ generation + extraction (JSON mode) ───────────

const VALID_QTYPES = ['mcq', 'true_false', 'fill_blank', 'short_answer', 'long_answer', 'numerical'];
const VALID_DIFFICULTY = ['easy', 'medium', 'hard', 'very_hard'];

function isAIConfigured() { return !!getAIProvider(); }

// Normalize/validate one raw question object from the model. Returns null if unusable.
function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const questionText = String(raw.questionText || raw.question || raw.text || '').trim();
  if (!questionText) return null;
  let questionType = String(raw.questionType || raw.type || 'mcq').toLowerCase().trim();
  if (!VALID_QTYPES.includes(questionType)) questionType = 'mcq';
  let difficulty = String(raw.difficulty || 'medium').toLowerCase().trim();
  if (!VALID_DIFFICULTY.includes(difficulty)) difficulty = 'medium';

  let options = [];
  if (Array.isArray(raw.options)) {
    options = raw.options.map((o, i) => {
      if (typeof o === 'string') return { text: o.trim(), isCorrect: false };
      const text = String(o?.text || o?.option || '').trim();
      let isCorrect = !!o?.isCorrect;
      if (!isCorrect && o?.correct === true) isCorrect = true;
      return { text, isCorrect };
    }).filter(o => o.text);
  }
  // true_false convenience: derive options if missing
  if (questionType === 'true_false' && options.length < 2) {
    const correct = String(raw.correctAnswer || '').toLowerCase();
    options = [
      { text: 'True', isCorrect: correct === 'true' },
      { text: 'False', isCorrect: correct === 'false' },
    ];
  }
  // Ensure exactly one correct option for mcq
  if (questionType === 'mcq') {
    const correctCount = options.filter(o => o.isCorrect).length;
    if (correctCount === 0 && options.length) {
      // fallback: a `correct` index or letter
      const ci = typeof raw.correctIndex === 'number' ? raw.correctIndex : -1;
      if (ci >= 0 && ci < options.length) options[ci].isCorrect = true;
    }
  }

  const correctAnswer = raw.correctAnswer != null ? String(raw.correctAnswer).trim()
    : (questionType === 'mcq' ? ((options.find(o => o.isCorrect) || {}).text || '') : '');

  // mcq must have >=2 options and exactly 1 correct
  if (questionType === 'mcq') {
    if (options.length < 2) return null;
    const corrects = options.filter(o => o.isCorrect);
    if (corrects.length !== 1) {
      // if 0 correct, mark first; if >1, keep first
      options.forEach((o, i) => { o.isCorrect = i === 0 ? (corrects.length === 0 ? true : o.isCorrect) : (corrects.length === 0 ? false : o.isCorrect); });
      if (options.filter(o => o.isCorrect).length !== 1) options[0].isCorrect = true;
    }
  }

  return {
    questionText,
    questionType,
    options: questionType === 'mcq' || questionType === 'true_false' ? options : options,
    correctAnswer,
    explanation: raw.explanation ? String(raw.explanation).trim() : '',
    difficulty,
    marks: Number(raw.marks) > 0 ? Number(raw.marks) : 1,
    unit: String(raw.unit || raw.topic || 'General').trim() || 'General',
    chapter: String(raw.chapter || raw.unit || 'General').trim() || 'General',
    cognitiveLevel: raw.cognitiveLevel || 'understanding',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 8) : [],
  };
}

// Extract a JSON object from model output (tolerates code fences / prose).
function parseModelJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try { return JSON.parse(t); } catch (e) { return null; }
}

// Low-level JSON completion (JSON mode with one retry).
async function jsonCompletion(systemPrompt, userPrompt, { maxTokens = 2500 } = {}) {
  const provider = getAIProvider();
  if (!provider) throw new Error('AI is not configured. Set GEMINI_API_KEY (free) or OPENAI_API_KEY to use AI question generation/extraction.');

  if (provider === 'gemini') {
    const attempt = () => geminiGenerate({ systemPrompt, prompt: userPrompt, maxTokens, temperature: 0.6, jsonMode: true });
    const parsed = parseModelJSON(await attempt());
    if (parsed) return parsed;
    return parseModelJSON(await attempt());
  }

  const openai = getOpenAI();
  if (!openai) throw new Error('AI is not configured. Set GEMINI_API_KEY (free) or OPENAI_API_KEY to use AI question generation/extraction.');
  const call = () => openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    temperature: 0.6,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  });
  let response = await call();
  let parsed = parseModelJSON(response.choices?.[0]?.message?.content);
  if (!parsed) { response = await call(); parsed = parseModelJSON(response.choices?.[0]?.message?.content); }
  return parsed;
}

// Generate synthetic MCQs for a topic.
async function generateMCQs(params = {}) {
  const { subject = 'General', topic = '', count = 5, difficulty = 'medium', questionType = 'mcq', educationLevel = 'undergraduate', board = '' } = params;
  const n = Math.min(Math.max(parseInt(count, 10) || 5, 1), 30);
  const systemPrompt = `You are an expert question writer for ${educationLevel} level ${board ? '(' + board + ')' : ''} exams. Output MUST be a single JSON object with a "questions" array. Each question: { questionText, questionType, options:[{text,isCorrect}], correctAnswer, explanation, difficulty, marks, unit, chapter, tags:[...] }. For ${questionType} questions use questionType="${questionType}". Exactly one option has isCorrect=true for mcq. No prose, JSON only.`;
  const userPrompt = `Create ${n} ${difficulty} ${questionType} questions on the subject "${subject}"${topic ? `, specifically the topic "${topic}"` : ''}. Make them exam-oriented, unambiguous, and varied. Provide a short explanation for each.`;
  const parsed = await jsonCompletion(systemPrompt, userPrompt);
  const list = Array.isArray(parsed?.questions) ? parsed.questions : (Array.isArray(parsed) ? parsed : []);
  const normalized = list.map(normalizeQuestion).filter(Boolean).slice(0, n).map(q => ({ ...q, source: 'ai' }));
  if (!normalized.length) throw new Error('AI did not return any usable questions. Try again or rephrase the topic.');
  return normalized;
}

// Extract questions from raw text (PDF / pasted text).
async function extractQuestionsFromText(text, params = {}) {
  const { subject = '', count = 50, educationLevel = 'undergraduate' } = params;
  const clipped = String(text || '').slice(0, 12000);
  if (!clipped.trim()) throw new Error('No text content to extract from.');
  const systemPrompt = `You are an expert at parsing exam question banks. From the provided text, extract every question you can find into a JSON object { "questions": [ { questionText, questionType, options:[{text,isCorrect}], correctAnswer, explanation, difficulty, unit, chapter } ] }. Infer correct answers when an answer key is present. Use questionType one of: mcq, true_false, fill_blank, short_answer, long_answer, numerical. If the text has no questions, return {"questions":[]}. JSON only.`;
  const userPrompt = `${subject ? 'Subject: ' + subject + '. ' : ''}Extract up to ${count} questions from this text:\n\n${clipped}`;
  const parsed = await jsonCompletion(systemPrompt, userPrompt, { maxTokens: 4000 });
  const list = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return list.map(normalizeQuestion).filter(Boolean).slice(0, count).map(q => ({ ...q, source: 'pdf' }));
}

// Extract questions from an image (Gemini vision, or OpenAI Vision).
async function extractQuestionsFromImage(base64DataUrl, params = {}) {
  const provider = getAIProvider();
  if (!provider) throw new Error('Image extraction requires GEMINI_API_KEY (free) or OPENAI_API_KEY.');
  const { subject = '', count = 30 } = params;
  const systemPrompt = `You are an expert at reading exam papers from images. Extract every visible question into JSON { "questions": [ { questionText, questionType, options:[{text,isCorrect}], correctAnswer, explanation, difficulty, unit, chapter } ] }. Use questionType one of: mcq, true_false, fill_blank, short_answer, long_answer, numerical. If an answer key is visible, set the correct option. JSON only.`;

  if (provider === 'gemini') {
    const match = String(base64DataUrl).match(/^data:(.+?);base64,([\s\S]*)$/);
    const image = match ? { mimeType: match[1], data: match[2] } : { mimeType: 'image/png', data: String(base64DataUrl) };
    const text = await geminiGenerate({
      systemPrompt,
      prompt: `Extract up to ${count} questions${subject ? ' for subject ' + subject : ''} from this image.`,
      maxTokens: 4000,
      temperature: 0.4,
      jsonMode: true,
      image,
    });
    const parsedGemini = parseModelJSON(text);
    const geminiList = Array.isArray(parsedGemini?.questions) ? parsedGemini.questions : [];
    return geminiList.map(normalizeQuestion).filter(Boolean).slice(0, count).map(q => ({ ...q, source: 'image' }));
  }

  const openai = getOpenAI();
  if (!openai) throw new Error('Image extraction requires GEMINI_API_KEY (free) or OPENAI_API_KEY.');
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [
        { type: 'text', text: `Extract up to ${count} questions${subject ? ' for subject ' + subject : ''} from this image.` },
        { type: 'image_url', image_url: { url: base64DataUrl } },
      ] },
    ],
    temperature: 0.4,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });
  const parsed = parseModelJSON(response.choices?.[0]?.message?.content);
  const list = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return list.map(normalizeQuestion).filter(Boolean).slice(0, count).map(q => ({ ...q, source: 'image' }));
}

module.exports = {
  askAI, streamAI, getSystemPrompt, buildPrompt,
  buildQuestionPaperPrompt, buildAssignmentCheckPrompt, buildReportCardPrompt,
  generateMCQs, extractQuestionsFromText, extractQuestionsFromImage, isAIConfigured,
  SYSTEM_PROMPTS,
};
