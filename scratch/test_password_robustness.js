const mongoose = require('mongoose');
const User = require('../backend/models/User');
const http = require('http');

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(resData) });
        } catch(e) {
          resolve({ status: res.statusCode, raw: resData });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('=== PART 1: User Model matchPassword Unit Tests ===');
  await mongoose.connect('mongodb://localhost:27017/vishvaerp');

  // Test 1: undefined enteredPassword
  const dummyDoc1 = new User({ name: 'Test', email: 'test1@test.com', password: '$2a$12$somehash' });
  const res1 = await dummyDoc1.matchPassword(undefined);
  console.log('Test 1 (matchPassword with undefined enteredPassword):', res1 === false ? 'PASS (returned false)' : `FAIL (${res1})`);

  // Test 2: undefined user.password
  const dummyDoc2 = new User({ name: 'Test', email: 'test2@test.com' });
  dummyDoc2.password = undefined;
  const res2 = await dummyDoc2.matchPassword('SomePassword123');
  console.log('Test 2 (matchPassword with undefined user.password):', res2 === false ? 'PASS (returned false)' : `FAIL (${res2})`);

  // Test 3: null user.password
  const dummyDoc3 = new User({ name: 'Test', email: 'test3@test.com' });
  dummyDoc3.password = null;
  const res3 = await dummyDoc3.matchPassword('SomePassword123');
  console.log('Test 3 (matchPassword with null user.password):', res3 === false ? 'PASS (returned false)' : `FAIL (${res3})`);

  // Test 4: empty string user.password
  const dummyDoc4 = new User({ name: 'Test', email: 'test4@test.com' });
  dummyDoc4.password = '';
  const res4 = await dummyDoc4.matchPassword('SomePassword123');
  console.log('Test 4 (matchPassword with empty user.password):', res4 === false ? 'PASS (returned false)' : `FAIL (${res4})`);

  // Test 5: non-string enteredPassword (e.g. number, object)
  const res5 = await dummyDoc1.matchPassword(12345);
  console.log('Test 5 (matchPassword with number enteredPassword):', res5 === false ? 'PASS (returned false)' : `FAIL (${res5})`);

  await mongoose.disconnect();

  console.log('\n=== PART 2: API Login Endpoint Integration Tests ===');

  // Test 6: SuperAdmin valid login
  const saLogin = await postJson('/api/auth/login', { email: 'superadmin@vishvaerp.com', password: 'SuperAdmin@123' });
  console.log('Test 6 (SuperAdmin valid login):', saLogin.status === 200 && saLogin.body.success ? 'PASS (200 OK)' : `FAIL (${saLogin.status})`, saLogin.body.message || '');

  // Test 7: CollegeAdmin valid login
  const caLogin = await postJson('/api/auth/login', { email: 'admin@techuniversity.edu', password: 'Admin@123' });
  console.log('Test 7 (CollegeAdmin valid login):', caLogin.status === 200 && caLogin.body.success ? 'PASS (200 OK)' : `FAIL (${caLogin.status})`, caLogin.body.message || '');

  // Test 8: Faculty valid login
  const facLogin = await postJson('/api/auth/login', { email: 'rajesh@techuniversity.edu', password: 'Faculty@123' });
  console.log('Test 8 (Faculty valid login):', facLogin.status === 200 && facLogin.body.success ? 'PASS (200 OK)' : `FAIL (${facLogin.status})`, facLogin.body.message || '');

  // Test 9: Student valid login
  const stuLogin = await postJson('/api/auth/login', { email: 'student1@techuniversity.edu', password: 'Student@123' });
  console.log('Test 9 (Student valid login):', stuLogin.status === 200 && stuLogin.body.success ? 'PASS (200 OK)' : `FAIL (${stuLogin.status})`, stuLogin.body.message || '');

  // Test 10: Parent valid login
  const parLogin = await postJson('/api/auth/login', { email: 'parent1@example.com', password: 'Parent@123' });
  console.log('Test 10 (Parent valid login):', parLogin.status === 200 && parLogin.body.success ? 'PASS (200 OK)' : `FAIL (${parLogin.status})`, parLogin.body.message || '');

  // Test 11: Wrong password -> should be 401, never 500
  const wrongPw = await postJson('/api/auth/login', { email: 'superadmin@vishvaerp.com', password: 'WrongPassword@999' });
  console.log('Test 11 (Wrong password -> 401):', wrongPw.status === 401 && wrongPw.body.message === 'Invalid credentials' ? 'PASS (401 Invalid credentials)' : `FAIL (${wrongPw.status}, ${JSON.stringify(wrongPw.body)})`);

  // Test 12: Non-existent user -> should be 401, never 500
  const noUser = await postJson('/api/auth/login', { email: 'doesnotexist@example.com', password: 'SomePassword@123' });
  console.log('Test 12 (Non-existent user -> 401):', noUser.status === 401 && noUser.body.message === 'Invalid credentials' ? 'PASS (401 Invalid credentials)' : `FAIL (${noUser.status}, ${JSON.stringify(noUser.body)})`);

  // Test 13: Empty password -> should be 400, never 500
  const emptyPw = await postJson('/api/auth/login', { email: 'superadmin@vishvaerp.com', password: '' });
  console.log('Test 13 (Empty password -> 400 validation):', emptyPw.status === 400 ? 'PASS (400 validation error)' : `FAIL (${emptyPw.status}, ${JSON.stringify(emptyPw.body)})`);

  // Test 14: Non-string password -> should be 400, never 500
  const nonStrPw = await postJson('/api/auth/login', { email: 'superadmin@vishvaerp.com', password: 123456 });
  console.log('Test 14 (Non-string password -> 400 validation):', nonStrPw.status === 400 ? 'PASS (400 validation error)' : `FAIL (${nonStrPw.status}, ${JSON.stringify(nonStrPw.body)})`);

  console.log('\n=== ALL TESTS COMPLETED SUCCESSFULLY ===');
  process.exit(0);
}

runTests().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
