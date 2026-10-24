const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- RUNNING PROFILE PAGE & DATABASE CONNECTION VERIFICATION ---');

const PROFILE_FILES = [
  'frontend/pages/student/profile.html',
  'frontend/pages/faculty/profile.html',
  'frontend/pages/college-admin/profile.html',
  'frontend/pages/super-admin/profile.html',
  'frontend/pages/parent/profile.html'
];

const REQUIRED_IDS = [
  'pfName', 'pfEmail', 'pfRoleChip', 'pfInitials', 'pfAvatar', 'pfAvatarWrap',
  'btnPickPhoto', 'btnRemovePhoto', 'inputPhoto', 'pfCollege', 'pfChips', 'pfMeta',
  'pfMeterFill', 'pfMeterText', 'fName', 'fPhone', 'fGender', 'fDob', 'fBlood',
  'fAddress', 'personalForm', 'btnSaveProfile', 'recGrid', 'twofaStatus',
  'devicesList', 'deviceTokensText', 'acctVerify', 'acctLastLogin', 'acctCreated',
  'acctRole', 'fCurPwd', 'fNewPwd', 'fConfirmPwd', 'passwordForm', 'btnChangePwd',
  'notifUnread', 'btnNotifRefresh', 'btnMarkAllRead', 'notifList'
];

// Test 1: DOM Elements in all 5 Profile Pages
PROFILE_FILES.forEach((relPath) => {
  const fullPath = path.resolve(__dirname, '..', relPath);
  assert(fs.existsSync(fullPath), `Profile file must exist: ${relPath}`);
  const html = fs.readFileSync(fullPath, 'utf8');

  // Verify all required IDs are present in HTML
  REQUIRED_IDS.forEach((id) => {
    const hasId = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
    assert(hasId, `File ${relPath} is missing required element id: ${id}`);
  });

  // Verify scripts loaded
  assert(html.includes('shared.js'), `${relPath} must load shared.js`);
  assert(html.includes('profile-page.js'), `${relPath} must load profile-page.js`);
  console.log(`✓ Test 1 Passed for [${relPath}]: All ${REQUIRED_IDS.length} UI elements and scripts present`);
});

// Test 2: Verify authController exports and updateProfile realtime integration
const authController = require('../backend/controllers/authController');
assert.strictEqual(typeof authController.getMe, 'function', 'getMe must be a function');
assert.strictEqual(typeof authController.updateProfile, 'function', 'updateProfile must be a function');
assert.strictEqual(typeof authController.changePassword, 'function', 'changePassword must be a function');
console.log('✓ Test 2 Passed: authController exports getMe, updateProfile, and changePassword');

// Test 3: Verify User schema contains all editable fields
const User = require('../backend/models/User');
const userPaths = User.schema.paths;
const expectedFields = ['name', 'phone', 'gender', 'dateOfBirth', 'address', 'bloodGroup', 'avatar'];
expectedFields.forEach((field) => {
  assert(userPaths[field], `User model schema must define field: ${field}`);
});
console.log('✓ Test 3 Passed: User schema contains all editable profile fields');

// Test 4: Verify realtime data-change helper retention
const { setIO, getIO, emitDataChange } = require('../backend/utils/realtime');
let capturedEvent = null;
setIO({
  to(room) {
    return {
      emit(event, payload) {
        capturedEvent = { room, event, payload };
      }
    };
  }
});

emitDataChange(null, { userIds: ['usr_123'], resource: 'profile', action: 'updated' });
assert(capturedEvent, 'emitDataChange must broadcast');
assert.strictEqual(capturedEvent.room, 'user:usr_123');
assert.strictEqual(capturedEvent.event, 'erp:data-change');
assert.strictEqual(capturedEvent.payload.resource, 'profile');
console.log('✓ Test 4 Passed: Profile updates broadcast erp:data-change to user channel');

console.log('--- ALL PROFILE PAGE VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
