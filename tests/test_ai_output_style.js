/**
 * Vishva ERP — AI Output Style & Persona Test Runner
 *
 * Verifies that the AI generation engine produces advanced,
 * articulate, natural human language across all key academic personas.
 */

const { askAI, getSystemPrompt } = require('../backend/services/aiService');

async function testStyle() {
  console.log('================================================================');
  console.log(' VISHVA ERP — TESTING ADVANCED HUMAN-LEVEL AI OUTPUT STYLE');
  console.log('================================================================\n');

  // Test 1: System Prompt Check
  console.log('----------------------------------------------------------------');
  console.log('TEST 1: Injected System Prompt & Human Voice Guidelines');
  console.log('----------------------------------------------------------------');
  const mockReq = { user: { role: 'student', collegeId: 'Apex University' } };
  const systemPrompt = getSystemPrompt('tutor', mockReq);
  console.log(systemPrompt);
  console.log('\n');

  // Test 2: AI Tutor Mode (Academic Concept Breakdown)
  console.log('----------------------------------------------------------------');
  console.log('TEST 2: Master Academic Tutor Mode (Concept: Database Indexing)');
  console.log('----------------------------------------------------------------');
  const tutorOutput = await askAI(
    'How do B-Tree indexes work in relational databases?',
    getSystemPrompt('tutor', mockReq)
  );
  console.log(tutorOutput);
  console.log('\n');

  // Test 3: AI Notes Architect Mode (University Lecture Notes)
  console.log('----------------------------------------------------------------');
  console.log('TEST 3: Academic Notes Architect Mode (Topic: Microservices Architecture)');
  console.log('----------------------------------------------------------------');
  const notesOutput = await askAI(
    'Generate notes for: Event-Driven Microservices Architecture',
    getSystemPrompt('notes', mockReq)
  );
  console.log(notesOutput);
  console.log('\n');

  // Test 4: Senior Technical Interview Coach Mode
  console.log('----------------------------------------------------------------');
  console.log('TEST 4: Technical Interview Coach Mode');
  console.log('----------------------------------------------------------------');
  const interviewOutput = await askAI(
    'I handled a high concurrency spike by introducing Redis caching in front of PostgreSQL, reducing query latency from 320ms to 8ms.',
    getSystemPrompt('interviewCoach', mockReq)
  );
  console.log(interviewOutput);
  console.log('\n');

  // Test 5: Cognitive Learning Strategist (Student Assistant)
  console.log('----------------------------------------------------------------');
  console.log('TEST 5: Senior Student Mentor & Cognitive Strategy');
  console.log('----------------------------------------------------------------');
  const studentOutput = await askAI(
    'I feel overwhelmed by my 6 engineering subjects this semester and have 3 weeks left for midterms.',
    getSystemPrompt('studentAssistant', mockReq)
  );
  console.log(studentOutput);
  console.log('\n');

  console.log('================================================================');
  console.log(' ALL STYLE TESTS COMPLETED SUCCESSFULLY');
  console.log('================================================================');
}

testStyle().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
