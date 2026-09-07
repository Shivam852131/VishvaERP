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

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => ['user', 'assistant'].includes(item?.role) && item.content)
    .slice(-12)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 4000) }));
}

function buildFallbackResponse(prompt, systemPrompt = '') {
  const text = String(prompt || '').trim();
  const lower = text.toLowerCase();
  const isTutor = /teacher|tutor|explain|concept|step|doubt|solve/i.test(`${systemPrompt} ${text}`);
  const isExam = /exam|quiz|question paper|mcq/i.test(`${systemPrompt} ${text}`);
  const isNotes = /notes|study notes|headings/i.test(`${systemPrompt} ${text}`);
  const isResume = /resume|cv|portfolio|career/i.test(`${systemPrompt} ${text}`);
  const isAssignment = /assignment|check|grade|rubric/i.test(`${systemPrompt} ${text}`);
  const isReport = /report card|marks|performance|grades/i.test(`${systemPrompt} ${text}`);
  const isParent = /parent|child|track|attendance|fee/i.test(`${systemPrompt} ${text}`);
  const isTeacher = /teacher|lesson|class|grading|rubric/i.test(`${systemPrompt} ${text}`);
  const isStudent = /student|homework|study plan|progress/i.test(`${systemPrompt} ${text}`);

  if (isExam) {
    return `I can help generate an exam draft. Since the live AI key is not configured, here is a structured local draft for: **${text || 'the selected topic'}**\n\n**Question Pattern**\n- 5 objective questions for quick recall\n- 3 short-answer questions for concept clarity\n- 2 application questions for problem solving\n\n**Sample Questions**\n1. Define the core concept in your own words.\n2. Compare two related terms with one example each.\n3. Solve one medium-level application problem.\n4. Identify the most common mistake students make in this topic.\n\nSet \`OPENAI_API_KEY\` in the server environment to generate full AI-created question papers.`;
  }

  if (isResume) {
    return `Here is a structured resume template for **${text || 'your profile'}**.\n\n**HEADER**\n- Full Name | Phone | Email | LinkedIn | GitHub\n\n**OBJECTIVE**\n- A 2-line career objective tailored to the target role.\n\n**EDUCATION**\n- Degree, College, Year, CGPA/Percentage\n\n**TECHNICAL SKILLS**\n- Languages: ...\n- Frameworks: ...\n- Tools: ...\n\n**PROJECTS**\n- Project Name | Tech Stack\n- Brief description with quantifiable outcomes.\n\n**INTERNSHIPS / EXPERIENCE**\n- Role, Company, Duration\n- Key responsibilities and achievements.\n\n**ACHIEVEMENTS**\n- Certifications, hackathons, awards.\n\nLive AI is currently using local fallback. Add \`OPENAI_API_KEY\` for full dynamic resume generation.`;
  }

  if (isAssignment) {
    return `Here is a sample assignment evaluation for: **${text || 'the submitted answer'}**.\n\n**Scoring Rubric**\n- Content Accuracy: 5/10\n- Depth of Analysis: 4/10\n- Structure & Clarity: 6/10\n- Examples & Evidence: 3/10\n- Overall: 18/40\n\n**Strengths**\n- Clear introduction.\n- Relevant topic coverage.\n\n**Areas for Improvement**\n- Add more specific examples.\n- Deepen analysis with references.\n- Improve paragraph transitions.\n\n**Suggested Revision**\nRewrite the third paragraph with a concrete case study.\n\nLive AI is currently using local fallback. Add \`OPENAI_API_KEY\` for full AI-powered grading.`;
  }

  if (isReport) {
    return `Here is a sample report card analysis for: **${text || 'the student'}**.\n\n**Performance Summary**\n- Overall Grade: B+\n- Strongest Subject: Mathematics (92/100)\n- Weakest Subject: English (65/100)\n\n**Trend Analysis**\n- Improving: Physics (+8 marks from last semester)\n- Declining: Chemistry (-5 marks)\n- Stable: Computer Science\n\n**Recommendations**\n1. Focus on English writing practice (30 min daily).\n2. Continue momentum in Physics with advanced problems.\n3. Address Chemistry gaps with targeted revision.\n\n**Action Plan**\n- Week 1-2: English grammar and essay practice.\n- Week 3-4: Chemistry revision of weak chapters.\n\nLive AI is currently using local fallback. Add \`OPENAI_API_KEY\` for full AI analysis.`;
  }

  if (isParent) {
    return `Here is guidance for: **${text || 'your query about your child'}**.\n\n**Academic Progress**\n- Track marks across subjects over time.\n- Identify subjects needing attention.\n- Monitor homework completion rates.\n\n**Attendance Overview**\n- Regular attendance correlates with better grades.\n- Flag any pattern of absences.\n\n**Fee Status**\n- Check upcoming fee deadlines.\n- Set reminders 7 days before due dates.\n\n**Parenting Tips**\n1. Create a consistent study routine at home.\n2. Encourage breaks during study sessions.\n3. Communicate regularly with teachers.\n4. Celebrate small achievements.\n\nLive AI is currently using local fallback. Add \`OPENAI_API_KEY\` for personalized insights.`;
  }

  if (isTeacher) {
    return `Here is assistance for: **${text || 'your teaching query'}**.\n\n**Lesson Plan Structure**\n1. Learning Objectives (what students will know)\n2. Prior Knowledge (prerequisites)\n3. Teaching Activities (lecture, discussion, activity)\n4. Assessment (formative + summative)\n5. homework / Further Reading\n\n**Grading Rubric Template**\n- Excellent (90-100): Exceeds expectations\n- Good (75-89): Meets expectations\n- Average (60-74): Approaching expectations\n- Below Average (<60): Needs improvement\n\n**Class Management Tips**\n- Set clear expectations early.\n- Use positive reinforcement.\n- Vary teaching methods to maintain engagement.\n\nLive AI is currently using local fallback. Add \`OPENAI_API_KEY\` for full AI support.`;
  }

  if (isStudent) {
    return `Here is personalized guidance for: **${text || 'your academic goals'}**.\n\n**Study Plan**\n- Break study sessions into 25-minute Pomodoro blocks.\n- Review notes within 24 hours of learning.\n- Practice active recall instead of passive reading.\n\n**Homework Tips**\n1. Start with the hardest assignment first.\n2. Set a timer for each task.\n3. Take 5-minute breaks between subjects.\n\n**Exam Preparation**\n- Start revision 2 weeks before the exam.\n- Use past papers for practice.\n- Focus on weak areas first.\n\n**Progress Tracking**\n- Maintain a study journal.\n- Set weekly goals and review Sundays.\n\nLive AI is currently using local fallback. Add \`OPENAI_API_KEY\` for full AI assistance.`;
  }

  if (isNotes) {
    return `Here are structured study notes for **${text || 'your topic'}**.\n\n**1. Big Idea**\n- Start with the purpose of the topic.\n- Understand where it is used in real college coursework and projects.\n\n**2. Core Points**\n- Definition and important terms.\n- Main formula, algorithm, or workflow.\n- One simple example.\n\n**3. Exam Focus**\n- Write clear definitions.\n- Use diagrams or steps where possible.\n- Practice one numerical or application-based question.\n\n**4. Revision Prompt**\nExplain this topic to a friend in 90 seconds. If you get stuck, ask me a specific sub-question.\n\nLive AI is currently using local fallback. Add \`OPENAI_API_KEY\` for full dynamic notes.`;
  }

  if (isTutor || lower.includes('why') || lower.includes('how')) {
    return `Let's work through this like a real tutor.\n\n**Your doubt**\n${text || 'No question provided.'}\n\n**Step 1: Identify the concept**\nBreak the problem into the main topic, given data, and what you need to find or understand.\n\n**Step 2: Learn the intuition**\nMost difficult topics become easier when you ask: \"What is the system trying to achieve?\" and \"What changes at each step?\"\n\n**Step 3: Try a small example**\nUse the smallest possible example first. Trace it manually before jumping to the full problem.\n\n**Step 4: Check yourself**\nReply with your topic name, syllabus unit, or a sample problem, and I will guide you step by step.\n\nNote: the server is in local fallback mode because \`OPENAI_API_KEY\` is not configured.`;
  }

  return `I can help with that.\n\n**You asked:** ${text || 'No message provided.'}\n\nHere is a practical way to proceed:\n- Clarify the exact goal.\n- Break it into smaller steps.\n- Share any course name, subject, or expected output.\n- Ask follow-up questions one by one for better answers.\n\nThe live AI provider is not configured yet. Add \`OPENAI_API_KEY\` to enable full real AI responses.`;
}

const SYSTEM_PROMPTS = {
  chat: `You are Vishva AI, a helpful assistant inside a college and university ERP. Give safe, educational, concise guidance. Ask one follow-up question when useful.`,
  tutor: `You are Vishva AI Tutor for college and university students. Teach like a patient real tutor: identify the concept, explain intuition, solve step by step, ask the student to try a small step, and keep answers exam-oriented.`,
  notes: `You are Vishva AI Notes Generator. Generate structured study notes with headings, bullet points, key definitions, examples, exam focus, and revision prompts.`,
  exam: `You are Vishva AI Exam Builder for faculty. Generate clean exam questions with marks, difficulty, and answers at the end.`,
  studentAssistant: `You are Vishva AI Student Assistant. You help students with personalized study plans, homework help, exam preparation strategies, academic progress tracking, time management tips, and motivation. Be encouraging, practical, and student-friendly. Use the student's context to provide tailored advice.`,
  teacherAssistant: `You are Vishva AI Teacher Assistant. You help teachers with lesson planning, creating grading rubrics, class management strategies, student performance analysis, curriculum design, parent communication drafts, and professional development tips. Be professional, practical, and education-focused.`,
  parentAssistant: `You are Vishva AI Parent Assistant. You help parents track their child's academic progress, understand attendance records, manage fee payments, get parenting tips for academic success, communicate with teachers, and support their child's learning journey. Be empathetic, clear, and action-oriented.`,
  questionPaper: `You are Vishva AI Question Paper Generator. You create complete, professional exam question papers with proper marks distribution, difficulty levels, blueprint templates, and answer keys. Follow standard examination patterns with a mix of objective, short-answer, and long-answer questions.`,
  assignmentChecker: `You are Vishva AI Assignment Checker. You evaluate student assignments with detailed rubric-based scoring. Provide: 1) Marks breakdown by criteria (content accuracy, depth, structure, examples), 2) Specific strengths, 3) Areas for improvement with actionable suggestions, 4) Overall grade and feedback. Be fair, constructive, and educational.`,
  reportCard: `You are Vishva AI Report Card Analyzer. You analyze student marks data to provide: 1) Performance summary with grades, 2) Subject-wise strength/weakness analysis, 3) Trend comparison (if previous data given), 4) Personalized improvement plan with weekly actions, 5) Motivational insights. Be data-driven and encouraging.`,
  studyPlanner: `You are Vishva AI Study Planner. You create personalized study schedules with time blocks, subject allocation based on difficulty and exam dates, revision cycles, break management, and productivity tips. Optimize for retention and balanced coverage.`,
  resumeBuilder: `You are Vishva AI Resume Builder. You help students and professionals create polished, ATS-friendly resumes. Provide structured content for each section (header, objective, education, skills, projects, experience, achievements), tailor content to the target role, and suggest improvements for impact.`,
  interviewCoach: `You are Vishva AI Interview Coach. You conduct realistic mock interviews, ask role-appropriate technical and behavioral questions, evaluate answers with detailed feedback, provide scoring, and suggest improvements. Be encouraging but honest in your assessment.`,
};

function getSystemPrompt(mode, req) {
  const role = req.user?.role || 'user';
  const context = `User role: ${role}. College ID: ${req.user?.collegeId || 'not available'}.`;
  return `${SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.chat} ${context}`;
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

// Generic AI call
const askAI = async (prompt, systemPrompt = SYSTEM_PROMPTS.chat, options = {}) => {
  const openai = getOpenAI();
  if (!openai) {
    return buildFallbackResponse(prompt, systemPrompt);
  }
  try {
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
    console.error("OpenAI Error:", error);
    return buildFallbackResponse(prompt, systemPrompt);
  }
};

// Streaming AI call
const streamAI = async ({ prompt, systemPrompt = SYSTEM_PROMPTS.chat, history = [], onToken }) => {
  const openai = getOpenAI();
  if (!openai) {
    const fallback = buildFallbackResponse(prompt, systemPrompt);
    const chunks = fallback.match(/.{1,28}(\s|$)/g) || [fallback];
    for (const chunk of chunks) {
      onToken(chunk);
      await delay(8);
    }
    return fallback;
  }
  try {
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
    console.error("OpenAI Stream Error:", error);
    const fallback = buildFallbackResponse(prompt, systemPrompt);
    onToken(fallback);
    return fallback;
  }
};

module.exports = {
  askAI, streamAI, getSystemPrompt, buildPrompt,
  buildQuestionPaperPrompt, buildAssignmentCheckPrompt, buildReportCardPrompt,
  SYSTEM_PROMPTS,
};
