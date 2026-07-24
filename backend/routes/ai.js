const express = require('express');
const { protect } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const {
  askAI, streamAI, getSystemPrompt, buildPrompt,
  buildQuestionPaperPrompt, buildAssignmentCheckPrompt, buildReportCardPrompt,
} = require('../services/aiService');

const router = express.Router();

router.use(protect);
router.use(aiLimiter);

// ─────────────────────── CHAT ENDPOINTS ───────────────────────

// @desc    Generic Chatbot
router.post('/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const response = await askAI(message, getSystemPrompt('chat', req), { history });
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Real-time AI chat stream
router.post('/chat/stream', async (req, res) => {
  const mode = String(req.body.mode || 'chat');
  const prompt = buildPrompt(mode, req.body);

  if (!prompt) {
    return res.status(400).json({ success: false, message: 'Message is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    send('meta', { mode, startedAt: new Date().toISOString() });
    let responseText = '';
    responseText = await streamAI({
      prompt,
      systemPrompt: getSystemPrompt(mode, req),
      history: req.body.history || [],
      onToken: (token) => send('token', { token }),
    });
    send('done', { success: true, response: responseText });
    res.end();
  } catch (error) {
    send('error', { success: false, message: error.message });
    res.end();
  }
});

// @desc    AI Tutor (doubt solver)
router.post('/tutor', async (req, res) => {
  try {
    const { topic, question, message, history = [] } = req.body;
    const response = await askAI(question || message, getSystemPrompt('tutor', req), { history });
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    AI Notes Generator
router.post('/notes', async (req, res) => {
  try {
    const topic = req.body.topic || req.body.message;
    const response = await askAI(
      `Generate comprehensive study notes for the topic: ${topic}. Structure with headings and bullet points.`,
      getSystemPrompt('notes', req)
    );
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    AI Exam Generator
router.post('/exam-generator', async (req, res) => {
  try {
    const { subject, difficulty, numQuestions } = req.body;
    const prompt = `Generate an exam paper for ${subject} with ${numQuestions} questions at a ${difficulty} difficulty level. Include a mix of multiple-choice and short-answer questions. Provide answers at the very end.`;
    const response = await askAI(prompt, getSystemPrompt('exam', req));
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    AI Study Planner
router.post('/study-planner', async (req, res) => {
  try {
    const { subjects, examDate, hoursPerDay, message } = req.body;
    const prompt = message || `Create a study plan for: ${subjects || 'all subjects'}. Exam date: ${examDate || 'not specified'}. Available hours: ${hoursPerDay || 6} per day. Provide a structured weekly schedule with time blocks, subject allocation, revision cycles, and break management.`;
    const response = await askAI(prompt, getSystemPrompt('studyPlanner', req));
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    AI Resume Builder
router.post('/resume-builder', async (req, res) => {
  try {
    const { name, education, skills, projects, experience, targetRole, message } = req.body;
    let prompt = message;
    if (!prompt) {
      prompt = `Build a resume for: ${name || 'a student'}. Education: ${education || 'B.Tech'}. Skills: ${skills || 'not specified'}. Projects: ${projects || 'not specified'}. Experience: ${experience || 'Fresher'}. Target role: ${targetRole || 'Software Engineer'}. Provide a complete, ATS-friendly resume with all standard sections.`;
    }
    const response = await askAI(prompt, getSystemPrompt('resumeBuilder', req));
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    AI Interview Coach
router.post('/interview-coach', async (req, res) => {
  try {
    const { role, question, answer, message } = req.body;
    let prompt = message;
    if (!prompt) {
      if (question && answer) {
        prompt = `Evaluate this interview answer for a ${role || 'software engineer'} position.\nQuestion: ${question}\nAnswer: ${answer}\nProvide detailed feedback, scoring (out of 10), strengths, and areas for improvement.`;
      } else if (question) {
        prompt = `This is a mock interview for a ${role || 'software engineer'} position. Ask the next interview question based on: ${question}. Make it realistic and challenging.`;
      } else {
        prompt = `Conduct a mock interview for a ${role || 'software engineer'} position. Start with the first question. Be professional and realistic.`;
      }
    }
    const response = await askAI(prompt, getSystemPrompt('interviewCoach', req));
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────── FORM-BASED TOOLS ───────────────────────

// @desc    Question Paper Generator
router.post('/question-paper', async (req, res) => {
  try {
    const prompt = buildQuestionPaperPrompt(req.body);
    const response = await askAI(prompt, getSystemPrompt('questionPaper', req));
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Assignment Checker
router.post('/assignment-check', async (req, res) => {
  try {
    const prompt = buildAssignmentCheckPrompt(req.body);
    const response = await askAI(prompt, getSystemPrompt('assignmentChecker', req));
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Report Card Analysis
router.post('/report-card', async (req, res) => {
  try {
    const prompt = buildReportCardPrompt(req.body);
    const response = await askAI(prompt, getSystemPrompt('reportCard', req));
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Student Assistant (chat-based)
router.post('/student-assistant', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const response = await askAI(message, getSystemPrompt('studentAssistant', req), { history });
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Teacher Assistant (chat-based)
router.post('/teacher-assistant', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const response = await askAI(message, getSystemPrompt('teacherAssistant', req), { history });
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Parent Assistant (chat-based)
router.post('/parent-assistant', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const response = await askAI(message, getSystemPrompt('parentAssistant', req), { history });
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
