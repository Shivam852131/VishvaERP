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

  if (isExam) {
    return `I can help generate an exam draft. Since the live AI key is not configured, here is a structured local draft for: **${text || 'the selected topic'}**\n\n**Question Pattern**\n- 5 objective questions for quick recall\n- 3 short-answer questions for concept clarity\n- 2 application questions for problem solving\n\n**Sample Questions**\n1. Define the core concept in your own words.\n2. Compare two related terms with one example each.\n3. Solve one medium-level application problem.\n4. Identify the most common mistake students make in this topic.\n\nSet \`OPENAI_API_KEY\` in the server environment to generate full AI-created question papers.`;
  }

  if (isNotes) {
    return `Here are structured study notes for **${text || 'your topic'}**.\n\n**1. Big Idea**\n- Start with the purpose of the topic.\n- Understand where it is used in real college coursework and projects.\n\n**2. Core Points**\n- Definition and important terms.\n- Main formula, algorithm, or workflow.\n- One simple example.\n\n**3. Exam Focus**\n- Write clear definitions.\n- Use diagrams or steps where possible.\n- Practice one numerical or application-based question.\n\n**4. Revision Prompt**\nExplain this topic to a friend in 90 seconds. If you get stuck, ask me a specific sub-question.\n\nLive AI is currently using local fallback. Add \`OPENAI_API_KEY\` for full dynamic notes.`;
  }

  if (isTutor || lower.includes('why') || lower.includes('how')) {
    return `Let's work through this like a real tutor.\n\n**Your doubt**\n${text || 'No question provided.'}\n\n**Step 1: Identify the concept**\nBreak the problem into the main topic, given data, and what you need to find or understand.\n\n**Step 2: Learn the intuition**\nMost difficult topics become easier when you ask: \"What is the system trying to achieve?\" and \"What changes at each step?\"\n\n**Step 3: Try a small example**\nUse the smallest possible example first. Trace it manually before jumping to the full problem.\n\n**Step 4: Check yourself**\nReply with your topic name, syllabus unit, or a sample problem, and I will guide you step by step.\n\nNote: the server is in local fallback mode because \`OPENAI_API_KEY\` is not configured.`;
  }

  return `I can help with that.\n\n**You asked:** ${text || 'No message provided.'}\n\nHere is a practical way to proceed:\n- Clarify the exact goal.\n- Break it into smaller steps.\n- Share any course name, subject, or expected output.\n- Ask follow-up questions one by one for better answers.\n\nThe live AI provider is not configured yet. Add \`OPENAI_API_KEY\` to enable full real AI responses.`;
}

const askAI = async (prompt, systemPrompt = "You are a helpful AI assistant for Vishva ERP.", options = {}) => {
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
      max_tokens: options.maxTokens || 1200,
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error("OpenAI Error:", error);
    return buildFallbackResponse(prompt, systemPrompt);
  }
};

const streamAI = async ({ prompt, systemPrompt = "You are a helpful AI assistant for Vishva ERP.", history = [], onToken }) => {
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
      max_tokens: 1400,
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

module.exports = { askAI, streamAI };
