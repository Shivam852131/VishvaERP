const assert = require('assert');
const { setIO, getIO, emitNotification, emitDataChange, emitDirectMessage } = require('../backend/utils/realtime');

console.log('--- RUNNING NOTIFICATION REAL-TIME VERIFICATION TESTS ---');

// Test 1: Realtime module exports
assert.strictEqual(typeof setIO, 'function', 'setIO must be a function');
assert.strictEqual(typeof getIO, 'function', 'getIO must be a function');
assert.strictEqual(typeof emitNotification, 'function', 'emitNotification must be a function');
console.log('✓ Test 1 Passed: Realtime exports are properly defined');

// Test 2: Mock IO set and retrieval
const emittedEvents = [];
const mockSocketIO = {
  to(room) {
    return {
      emit(event, payload) {
        emittedEvents.push({ room, event, payload });
      },
    };
  },
};

setIO(mockSocketIO);
assert.strictEqual(getIO(), mockSocketIO, 'getIO must return the registered instance');
console.log('✓ Test 2 Passed: setIO & getIO instance retention works');

// Test 3: emitNotification triggers real-time socket events
const sampleNotif = {
  _id: 'notif_12345',
  title: 'Fee Payment Received',
  body: 'Your semester fee payment of Rs. 45,000 has been confirmed.',
  type: 'fee',
  link: '/pages/student/fees.html',
  isRead: false,
};

emitNotification('user_999', sampleNotif);
assert.strictEqual(emittedEvents.length, 2, 'Must emit both notification and erp:notification');
assert.strictEqual(emittedEvents[0].room, 'user:user_999');
assert.strictEqual(emittedEvents[0].event, 'notification');
assert.strictEqual(emittedEvents[0].payload._id, 'notif_12345');
assert.strictEqual(emittedEvents[1].room, 'user:user_999');
assert.strictEqual(emittedEvents[1].event, 'erp:notification');
console.log('✓ Test 3 Passed: emitNotification broadcasts to personal user room with full payload');

// Test 4: emitDataChange fallback to global IO instance
emittedEvents.length = 0;
emitDataChange(null, { collegeId: 'col_1', userIds: ['u1', 'u2'], roles: ['student'], resource: 'notices' });
assert.strictEqual(emittedEvents.some(e => e.room === 'college:col_1' && e.event === 'erp:data-change'), true);
assert.strictEqual(emittedEvents.some(e => e.room === 'user:u1' && e.event === 'erp:data-change'), true);
assert.strictEqual(emittedEvents.some(e => e.room === 'role:student' && e.event === 'erp:data-change'), true);
console.log('✓ Test 4 Passed: emitDataChange successfully broadcasts using global IO');

// Test 5: Verify Notification model schema allows custom types
const { Notification } = require('../backend/models/Communication');
const testDoc = new Notification({
  userId: '507f191e810c19729de860ea',
  title: 'Attendance Warning',
  body: 'Attendance dropped below 75%',
  type: 'urgent',
});
const valErr = testDoc.validateSync();
assert.strictEqual(valErr, undefined, 'Type urgent should not trigger schema validation error');
console.log('✓ Test 5 Passed: Notification model accepts dynamic event types without schema validation rejection');

// Test 6: Verify notificationController methods
const notificationController = require('../backend/controllers/notificationController');
assert.strictEqual(typeof notificationController.getNotifications, 'function');
assert.strictEqual(typeof notificationController.createNotification, 'function');
assert.strictEqual(typeof notificationController.markAsRead, 'function');
assert.strictEqual(typeof notificationController.markAllAsRead, 'function');
assert.strictEqual(typeof notificationController.deleteNotification, 'function');
assert.strictEqual(typeof notificationController.sendSelfTestNotification, 'function');
console.log('✓ Test 6 Passed: All controller methods including sendSelfTestNotification are exported');

console.log('--- ALL NOTIFICATION REAL-TIME TESTS PASSED SUCCESSFULLY! ---');
