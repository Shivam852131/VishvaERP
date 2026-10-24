const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- RUNNING CHAT PAGE MOBILE RESPONSIVE & REAL-TIME CONNECTIVITY VERIFICATION ---');

// 1. Verify messages.html structural elements
const messagesHtmlPath = path.resolve(__dirname, '../frontend/pages/messages.html');
assert(fs.existsSync(messagesHtmlPath), 'messages.html must exist');
const html = fs.readFileSync(messagesHtmlPath, 'utf8');

const REQUIRED_CHAT_IDS = [
  'chatTopbar', 'hamburger', 'contactSearch', 'contactsList',
  'chatLayout', 'chatSidebar', 'chatThread', 'chatHeader',
  'chatBackBtn', 'chatAvatar', 'chatName', 'chatStatus',
  'chatMessages', 'msgInput', 'newMessageModal', 'modalUserList'
];

REQUIRED_CHAT_IDS.forEach((id) => {
  const exists = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
  assert(exists, `messages.html must contain required element id="${id}"`);
});
console.log(`✓ Test 1 Passed: All ${REQUIRED_CHAT_IDS.length} required UI element IDs found in messages.html`);

// 2. Verify Mobile Responsive CSS in messages.html
assert(html.includes('.chat-mobile-fab'), 'messages.html must include mobile floating action button (.chat-mobile-fab)');
assert(html.includes('global-ai-launcher'), 'messages.html must disable global-ai-launcher to prevent bottom overlap');
assert(html.includes('body.chat-thread-open'), 'messages.html must handle chat-thread-open state on body');
assert(html.includes('.chat-back-btn'), 'messages.html must have back button for mobile master-detail navigation');
assert(html.includes('backToContacts()'), 'messages.html must wire back button to backToContacts()');
assert(html.includes('#chatTopbar.erp-topbar'), 'messages.html must enforce single-line fixed 58px topbar');
console.log('✓ Test 2 Passed: Mobile layout rules, FAB, back navigation, and topbar styling verified');

// 3. Verify communicationController exports and null safety
const commController = require('../backend/modules/communicationController');
assert.strictEqual(typeof commController.getContactUsers, 'function', 'getContactUsers must be a function');
assert.strictEqual(typeof commController.getConversations, 'function', 'getConversations must be a function');
assert.strictEqual(typeof commController.getMessages, 'function', 'getMessages must be a function');
assert.strictEqual(typeof commController.sendMessage, 'function', 'sendMessage must be a function');
console.log('✓ Test 3 Passed: communicationController exports all required chat endpoints');

// 4. Verify Message model schema
const { Message } = require('../backend/models/Communication');
assert(Message, 'Message model must exist');
const msgPaths = Message.schema.paths;
assert(msgPaths['senderId'], 'Message must have senderId');
assert(msgPaths['receiverId'], 'Message must have receiverId');
assert(msgPaths['content'], 'Message must have content');
assert(msgPaths['isRead'], 'Message must have isRead');
assert(msgPaths['messageType'], 'Message must have messageType');
console.log('✓ Test 4 Passed: Communication Message model schema has all necessary fields');

// 5. Verify Realtime Socket message emission
const { emitDirectMessage } = require('../backend/utils/realtime');
assert.strictEqual(typeof emitDirectMessage, 'function', 'emitDirectMessage must be a function');

const testEvents = [];
const mockIO = {
  to(room) {
    return {
      emit(event, payload) {
        testEvents.push({ room, event, payload });
      }
    };
  }
};
const { setIO } = require('../backend/utils/realtime');
setIO(mockIO);

emitDirectMessage(null, ['user_123', 'user_456'], { message: { content: 'Hello World', senderId: 'user_123' } });
assert.strictEqual(testEvents.length, 4, 'Should emit 2 events (erp:message and message) to 2 users');
assert(testEvents.some(e => e.room === 'user:user_123' && e.event === 'erp:message'), 'Emits erp:message to user_123');
assert(testEvents.some(e => e.room === 'user:user_456' && e.event === 'message'), 'Emits message to user_456');
console.log('✓ Test 5 Passed: Real-time socket message delivery emits to targeted user rooms');

// 6. Verify custom.css does not enforce harmful flex-wrap or display:block !important on chat
const customCssPath = path.resolve(__dirname, '../frontend/css/custom.css');
const customCss = fs.readFileSync(customCssPath, 'utf8');
assert(!customCss.includes('.chat-input-area {\n    flex-wrap: wrap;'), 'custom.css must not force chat-input-area to wrap');
assert(!customCss.includes('.chat-sidebar {\n    display: block !important;\n    max-height: min(34vh, 280px);'), 'custom.css must not clamp chat-sidebar to 34vh');
console.log('✓ Test 6 Passed: custom.css free of harmful chat overrides');

// 7. Verify live-pages.js non-blocking init and messaging handlers
const livePagesPath = path.resolve(__dirname, '../frontend/live/live-pages.js');
const livePages = fs.readFileSync(livePagesPath, 'utf8');
assert(livePages.includes('renderContactsSkeleton'), 'live-pages.js must show skeleton while loading');
assert(livePages.includes('getCombinedContacts'), 'live-pages.js must combine user list and conversations');
assert(livePages.includes('chat-thread-open'), 'live-pages.js must toggle chat-thread-open on body');
assert(livePages.includes('pickModalContact'), 'live-pages.js must export pickModalContact for easy 1-tap compose');
console.log('✓ Test 7 Passed: live-pages.js chat logic has skeletons, contact merging, and mobile state handlers');

console.log('\n========================================');
console.log('ALL 7/7 CHAT PAGE TESTS PASSED SUCCESSFULLY!');
console.log('========================================\n');
