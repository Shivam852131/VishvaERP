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
  const question = match ? match[1].trim() : raw;
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
    return `I can help generate an exam draft. Since the live AI key is not configured, here is a structured local draft for: **${text || 'the selected topic'}**\n\n**Question Pattern**\n- 5 objective questions for quick recall\n- 3 short-answer questions for concept clarity\n- 2 application questions for problem solving\n\n**Sample Questions**\n1. Define the core concept in your own words.\n2. Compare two related terms with one example each.\n3. Solve one medium-level application problem.\n4. Identify the most common mistake students make in this topic.\n\nSet \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` in the server environment to generate full AI-created question papers.`;
  }

  if (isResume) {
    return `Here is a structured resume template for **${text || 'your profile'}**.\n\n**HEADER**\n- Full Name | Phone | Email | LinkedIn | GitHub\n\n**OBJECTIVE**\n- A 2-line career objective tailored to the target role.\n\n**EDUCATION**\n- Degree, College, Year, CGPA/Percentage\n\n**TECHNICAL SKILLS**\n- Languages: ...\n- Frameworks: ...\n- Tools: ...\n\n**PROJECTS**\n- Project Name | Tech Stack\n- Brief description with quantifiable outcomes.\n\n**INTERNSHIPS / EXPERIENCE**\n- Role, Company, Duration\n- Key responsibilities and achievements.\n\n**ACHIEVEMENTS**\n- Certifications, hackathons, awards.\n\nLive AI is currently using local fallback. Add \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` for full dynamic resume generation.`;
  }

  if (isAssignment) {
    return `Here is a sample assignment evaluation for: **${text || 'the submitted answer'}**.\n\n**Scoring Rubric**\n- Content Accuracy: 5/10\n- Depth of Analysis: 4/10\n- Structure & Clarity: 6/10\n- Examples & Evidence: 3/10\n- Overall: 18/40\n\n**Strengths**\n- Clear introduction.\n- Relevant topic coverage.\n\n**Areas for Improvement**\n- Add more specific examples.\n- Deepen analysis with references.\n- Improve paragraph transitions.\n\n**Suggested Revision**\nRewrite the third paragraph with a concrete case study.\n\nLive AI is currently using local fallback. Add \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` for full AI-powered grading.`;
  }

  if (isReport) {
    return `Here is a sample report card analysis for: **${text || 'the student'}**.\n\n**Performance Summary**\n- Overall Grade: B+\n- Strongest Subject: Mathematics (92/100)\n- Weakest Subject: English (65/100)\n\n**Trend Analysis**\n- Improving: Physics (+8 marks from last semester)\n- Declining: Chemistry (-5 marks)\n- Stable: Computer Science\n\n**Recommendations**\n1. Focus on English writing practice (30 min daily).\n2. Continue momentum in Physics with advanced problems.\n3. Address Chemistry gaps with targeted revision.\n\n**Action Plan**\n- Week 1-2: English grammar and essay practice.\n- Week 3-4: Chemistry revision of weak chapters.\n\nLive AI is currently using local fallback. Add \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` for full AI analysis.`;
  }

  if (isParent) {
    return `Here is guidance for: **${text || 'your query about your child'}**.\n\n**Academic Progress**\n- Track marks across subjects over time.\n- Identify subjects needing attention.\n- Monitor homework completion rates.\n\n**Attendance Overview**\n- Regular attendance correlates with better grades.\n- Flag any pattern of absences.\n\n**Fee Status**\n- Check upcoming fee deadlines.\n- Set reminders 7 days before due dates.\n\n**Parenting Tips**\n1. Create a consistent study routine at home.\n2. Encourage breaks during study sessions.\n3. Communicate regularly with teachers.\n4. Celebrate small achievements.\n\nLive AI is currently using local fallback. Add \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` for personalized insights.`;
  }

  if (isTeacher) {
    return `Here is assistance for: **${text || 'your teaching query'}**.\n\n**Lesson Plan Structure**\n1. Learning Objectives (what students will know)\n2. Prior Knowledge (prerequisites)\n3. Teaching Activities (lecture, discussion, activity)\n4. Assessment (formative + summative)\n5. homework / Further Reading\n\n**Grading Rubric Template**\n- Excellent (90-100): Exceeds expectations\n- Good (75-89): Meets expectations\n- Average (60-74): Approaching expectations\n- Below Average (<60): Needs improvement\n\n**Class Management Tips**\n- Set clear expectations early.\n- Use positive reinforcement.\n- Vary teaching methods to maintain engagement.\n\nLive AI is currently using local fallback. Add \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` for full AI support.`;
  }

  if (isStudent) {
    return `Here is personalized guidance for: **${text || 'your academic goals'}**.\n\n**Study Plan**\n- Break study sessions into 25-minute Pomodoro blocks.\n- Review notes within 24 hours of learning.\n- Practice active recall instead of passive reading.\n\n**Homework Tips**\n1. Start with the hardest assignment first.\n2. Set a timer for each task.\n3. Take 5-minute breaks between subjects.\n\n**Exam Preparation**\n- Start revision 2 weeks before the exam.\n- Use past papers for practice.\n- Focus on weak areas first.\n\n**Progress Tracking**\n- Maintain a study journal.\n- Set weekly goals and review Sundays.\n\nLive AI is currently using local fallback. Add \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` for full AI assistance.`;
  }

  if (isNotes) {
    return `Here are structured study notes for **${text || 'your topic'}**.\n\n**1. Big Idea**\n- Start with the purpose of the topic.\n- Understand where it is used in real college coursework and projects.\n\n**2. Core Points**\n- Definition and important terms.\n- Main formula, algorithm, or workflow.\n- One simple example.\n\n**3. Exam Focus**\n- Write clear definitions.\n- Use diagrams or steps where possible.\n- Practice one numerical or application-based question.\n\n**4. Revision Prompt**\nExplain this topic to a friend in 90 seconds. If you get stuck, ask me a specific sub-question.\n\nLive AI is currently using local fallback. Add \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` for full dynamic notes.`;
  }

  if (isInterview) {
    return `Here is mock-interview coaching for: **${text || 'your interview answer'}**\n\n**Score (out of 10)**\n- Relevance to the question: — /10\n- Depth & correctness: — /10\n- Structure & clarity: — /10\n- Example / evidence: — /10\n\n**Strengths to keep**\n- Direct opening, professional tone.\n\n**Areas to improve**\n- Add one concrete example (project, internship or coursework).\n- Quantify impact with numbers or scale.\n- Close with a short summary line.\n\n**Stronger answer structure**\n1. One-line direct answer.\n2. Why it matters / when you use it.\n3. Example from your own work.\n4. Trade-offs, then a closing line.\n\nLive AI is currently using local fallback. Add \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` to get a real evaluation of this exact answer.`;
  }

  if (isTutor) {
    return `Let's work through this like a real tutor.\n\n**Your doubt**\n${text || 'No question provided.'}\n\n**Step 1: Identify the concept**\nBreak the problem into the main topic, given data, and what you need to find or understand.\n\n**Step 2: Learn the intuition**\nMost difficult topics become easier when you ask: \"What is the system trying to achieve?\" and \"What changes at each step?\"\n\n**Step 3: Try a small example**\nUse the smallest possible example first. Trace it manually before jumping to the full problem.\n\n**Step 4: Check yourself**\nReply with your topic name, syllabus unit, or a sample problem, and I will guide you step by step.\n\nNote: the server is in local fallback mode because no AI API key is configured yet (\`GEMINI_API_KEY\` or \`OPENAI_API_KEY\`).`;
  }

  return `I can help with that.\n\n**You asked:** ${text || 'No message provided.'}\n\nHere is a practical way to proceed:\n- Clarify the exact goal.\n- Break it into smaller steps.\n- Share any course name, subject, or expected output.\n- Ask follow-up questions one by one for better answers.\n\nThe live AI provider is not configured yet. Add \`GEMINI_API_KEY\` (free) or \`OPENAI_API_KEY\` to enable full real AI responses.`;
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

// ─────────────────────── Google Gemini (free tier) ───────────────────────
// Plain REST calls - no extra npm package needed (Node 18+ ships global fetch).

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function geminiModel() {
  return process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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
  const url = `${GEMINI_API_BASE}/${geminiModel()}:${pathAndQuery}`;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY || '' },
    body: JSON.stringify(body),
  };
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      lastError = new Error(`Gemini network error: ${e.message}`);
      if (attempt < 2) { await delay(700); continue; }
      throw lastError;
    }
    if (res.ok) return res;
    const detail = await res.text().catch(() => '');
    lastError = new Error(`Gemini API ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    const transient = res.status === 500 || res.status === 502 || res.status === 503;
    if (transient && attempt < 2) { await delay(700); continue; }
    throw lastError;
  }
  throw lastError || new Error('Gemini request failed');
}

function geminiTextFrom(payload) {
  return (payload?.candidates || [])
    .map((candidate) => (candidate?.content?.parts || []).map((part) => part.text || '').join(''))
    .join('')
    .trim();
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
      try { token = geminiTextFrom(JSON.parse(payload)); } catch (e) { continue; }
      if (!token) continue;
      fullText += token;
      onToken(token);
    }
  }
  if (!fullText) throw new Error('Gemini stream returned no text');
  return fullText;
}

// No provider configured (or a caller without a key): stream the local template.
async function streamFallback(prompt, systemPrompt, onToken) {
  const fallback = buildFallbackResponse(prompt, systemPrompt);
  const chunks = fallback.match(/.{1,28}(\s|$)/g) || [fallback];
  for (const chunk of chunks) {
    onToken(chunk);
    await delay(8);
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
    return buildFallbackResponse(prompt, systemPrompt, options);
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
    const fallback = buildFallbackResponse(prompt, systemPrompt);
    onToken(fallback);
    return fallback;
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
