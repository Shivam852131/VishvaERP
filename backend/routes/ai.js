const express = require('express');
const { protect } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const { askAI, streamAI } = require('../services/aiService');

const router = express.Router();

router.use(protect);
router.use(aiLimiter);

function getUserContext(req) {
  const role = req.user?.role || 'user';
  return `User role: ${role}. College ID: ${req.user?.collegeId || 'not available'}. Give safe, educational, concise guidance. Do not invent private ERP data.`;
}

function getSystemPrompt(mode, topic, req) {
  const context = getUserContext(req);
  const prompts = {
    chat: `You are Vishva AI, a helpful assistant inside a college and university ERP. ${context} Answer clearly with practical steps and ask one follow-up question when useful.`,
    tutor: `You are Vishva AI Tutor for college and university students. ${context} Teach like a patient real tutor: identify the concept, explain intuition, solve step by step, ask the student to try a small step, and keep answers exam-oriented. Topic: ${topic || 'General academics'}.`,
    notes: `You are Vishva AI Notes Generator. ${context} Generate structured study notes with headings, bullet points, key definitions, examples, exam focus, and revision prompts.`,
    exam: `You are Vishva AI Exam Builder for faculty. ${context} Generate clean exam questions with marks, difficulty, and answers at the end.`,
  };
  return prompts[mode] || prompts.chat;
}

function buildPrompt(mode, body) {
  const message = String(body.message || body.question || body.topic || '').trim();
  if (mode === 'notes') return `Generate notes for: ${message}`;
  if (mode === 'exam') {
    return `Generate an exam or quiz for subject: ${body.subject || message}. Difficulty: ${body.difficulty || 'medium'}. Number of questions: ${body.numQuestions || 5}. Include answers.`;
  }
  return message;
}

// @desc    Generic Chatbot
router.post('/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const response = await askAI(message, getSystemPrompt('chat', null, req), { history });
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
      systemPrompt: getSystemPrompt(mode, req.body.topic || req.body.subject, req),
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

// @desc    AI Teacher / Doubt Solver
router.post('/tutor', async (req, res) => {
  try {
    const { topic, question, message, history = [] } = req.body;
    const response = await askAI(question || message, getSystemPrompt('tutor', topic, req), { history });
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    AI Notes Generator
router.post('/notes', async (req, res) => {
  try {
    const topic = req.body.topic || req.body.message;
    const response = await askAI(`Generate comprehensive study notes for the topic: ${topic}. Structure with headings and bullet points.`, getSystemPrompt('notes', topic, req));
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
    const response = await askAI(prompt, getSystemPrompt('exam', subject, req));
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
