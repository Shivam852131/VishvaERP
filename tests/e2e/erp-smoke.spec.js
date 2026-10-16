const { test, expect } = require('@playwright/test');
const { cleanupQaData, closeDb } = require('./helpers/dbCleanup');

const SUPER_ADMIN_EMAIL = process.env.E2E_SUPERADMIN_EMAIL || 'superadmin@vishvaerp.com';
const SUPER_ADMIN_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD || 'SuperAdmin@123';
const QA_STAMP = Date.now().toString().slice(-6);
const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

const state = {
  college: {
    name: `QA College ${QA_STAMP}`,
    code: `QAC${QA_STAMP}`,
    adminName: `QA Admin ${QA_STAMP}`,
    adminEmail: `qa.admin.${QA_STAMP}@example.com`,
    adminPassword: 'Admin@123',
    adminPhone: '9876543210',
  },
  student: {
    name: `QA Student ${QA_STAMP}`,
    roll: `QA${QA_STAMP}`,
    email: `qa.student.${QA_STAMP}@example.com`,
    password: 'Student@123',
    phone: '9123456789',
    branch: 'B.Tech CS',
    semester: 'Sem 4',
    parentName: `QA Parent ${QA_STAMP}`,
    parentEmail: `qa.parent.${QA_STAMP}@example.com`,
  },
  faculty: {
    name: `QA Faculty ${QA_STAMP}`,
    email: `qa.faculty.${QA_STAMP}@example.com`,
    password: 'Faculty@123',
    designation: 'Assistant Professor',
    department: 'CS',
    phone: '9234567890',
  },
  parent: null,
  subject: {
    name: `QA Subject ${QA_STAMP}`,
    code: `QAS${QA_STAMP}`,
    credits: '4',
    branch: 'B.Tech CS',
    semester: 'Sem 4',
  },
  notice: {
    title: `QA Notice ${QA_STAMP}`,
    body: `QA notice body ${QA_STAMP} for end-to-end verification.`,
  },
  hostel: {
    name: `QA Hostel ${QA_STAMP}`,
    roomNumber: `R${QA_STAMP}`,
  },
  route: {
    name: `QA Route ${QA_STAMP}`,
    busNumber: `BUS-${QA_STAMP}`,
  },
  fee: {
    amount: '12000',
    type: 'Exam Fee',
    mode: 'Online',
    txn: `TXN-${QA_STAMP}`,
  },
  assignment: {
    title: `QA Assignment ${QA_STAMP}`,
    description: `Solve the assigned QA problems for ${QA_STAMP}.`,
    marks: '20',
  },
  liveClassTopic: `QA Live Session ${QA_STAMP}`,
};

async function login(page, email, password, expectedPath) {
  await page.goto('/pages/login.html', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL(new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
    page.locator('#loginBtn').click(),
  ]);
}

async function selectOptionContaining(page, selector, text) {
  await page.waitForFunction(({ selector, text }) => {
    const element = document.querySelector(selector);
    return !!element && Array.from(element.options).some((option) => (option.textContent || '').includes(text));
  }, { selector, text });

  const value = await page.$eval(selector, (element, searchText) => {
    const option = Array.from(element.options).find((item) => (item.textContent || '').includes(searchText));
    return option ? option.value : '';
  }, text);

  expect(value).toBeTruthy();
  await page.selectOption(selector, value);
}

test.describe.serial('ERP smoke suite', () => {
  test.beforeAll(async () => {
    await cleanupQaData();
  });

  test.afterAll(async () => {
    await cleanupQaData();
    await closeDb();
  });

  test('redirects protected routes to login', async ({ page }) => {
    await page.goto('/pages/super-admin/dashboard.html', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/pages\/login\.html$/);
  });

  test('super admin can create a college tenant', async ({ page }) => {
    await login(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, '/pages/super-admin/dashboard.html');
    await page.goto('/pages/super-admin/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Register College/i }).first().click();
    await page.waitForSelector('#addCollegeModal.open');

    await page.fill('#collegeName', state.college.name);
    await page.fill('#collegeCode', state.college.code);
    await page.fill('#adminName', state.college.adminName);
    await page.fill('#adminEmail', state.college.adminEmail);
    await page.fill('#adminPass', state.college.adminPassword);
    await page.fill('#adminPhone', state.college.adminPhone);

    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/super-admin/register-college') && response.request().method() === 'POST');
    await page.locator('#addCollegeBtn').click();
    const response = await responsePromise;
    const json = await response.json();
    expect(json.success).toBeTruthy();

    await page.goto('/pages/super-admin/colleges.html', { waitUntil: 'domcontentloaded' });
    await page.fill('#searchInput', state.college.name);
    await page.waitForFunction((name) => (document.body.innerText || '').includes(name), state.college.name);
  });

  test('college admin can create core college records', async ({ page }) => {
    await login(page, state.college.adminEmail, state.college.adminPassword, '/pages/college-admin/dashboard.html');

    await page.goto('/pages/college-admin/students.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add Student/i }).click();
    await page.waitForSelector('#addStudentModal.open');
    await page.fill('#sName', state.student.name);
    await page.fill('#sRoll', state.student.roll);
    await page.fill('#sEmail', state.student.email);
    await page.fill('#sPhone', state.student.phone);
    await page.selectOption('#sBranch', { label: state.student.branch });
    await page.selectOption('#sSem', { label: state.student.semester });
    await page.fill('#sPass', state.student.password);
    await page.fill('#sParent', state.student.parentName);
    await page.fill('#sParentEmail', state.student.parentEmail);
    const studentResponsePromise = page.waitForResponse((response) => response.url().includes('/api/college-admin/add-student') && response.request().method() === 'POST');
    await page.locator('#addStudentBtn').click();
    const studentResponse = await studentResponsePromise;
    const studentJson = await studentResponse.json();
    expect(studentJson.success).toBeTruthy();
    expect(studentJson.parentCredentials).toBeTruthy();
    state.parent = studentJson.parentCredentials;
    await page.waitForFunction((name) => (document.body.innerText || '').includes(name), state.student.name);

    await page.goto('/pages/college-admin/faculty.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add Faculty/i }).click();
    await page.waitForSelector('#addFacultyModal.open');
    await page.fill('#fName', state.faculty.name);
    await page.fill('#fDesig', state.faculty.designation);
    await page.fill('#fEmail', state.faculty.email);
    await page.fill('#fPhone', state.faculty.phone);
    await page.selectOption('#fDept', { label: state.faculty.department });
    await page.fill('#fPass', state.faculty.password);
    const facultyResponsePromise = page.waitForResponse((response) => response.url().includes('/api/college-admin/add-faculty') && response.request().method() === 'POST');
    await page.locator('#addFacultyBtn').click();
    const facultyResponse = await facultyResponsePromise;
    const facultyJson = await facultyResponse.json();
    expect(facultyJson.success).toBeTruthy();
    await page.waitForFunction((name) => (document.body.innerText || '').includes(name), state.faculty.name);

    await page.goto('/pages/college-admin/courses.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.erp-topbar .btn.btn-primary').click();
    await page.waitForSelector('#addCourseModal.open');
    await page.fill('#cName', state.subject.name);
    await page.fill('#cCode', state.subject.code);
    await page.fill('#cCredits', state.subject.credits);
    await page.selectOption('#cBranch', { label: state.subject.branch });
    await page.selectOption('#cSem', { label: state.subject.semester });
    await selectOptionContaining(page, '#cFaculty', state.faculty.name);
    const subjectResponsePromise = page.waitForResponse((response) => response.url().includes('/api/academics/subjects') && response.request().method() === 'POST');
    await page.locator('#addCourseModal .btn.btn-primary').click();
    const subjectResponse = await subjectResponsePromise;
    const subjectJson = await subjectResponse.json();
    expect(subjectJson.success).toBeTruthy();
    await page.waitForFunction((name) => (document.getElementById('coursesGrid')?.innerText || '').includes(name), state.subject.name);

    await page.goto('/pages/college-admin/fees.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Record Payment/i }).click();
    await page.waitForSelector('#recordFeeModal.open');
    await page.fill('#fRoll', state.student.roll);
    await page.fill('#fAmount', state.fee.amount);
    await page.selectOption('#fMode', { label: state.fee.mode });
    await page.selectOption('#fType', { label: state.fee.type });
    await page.fill('#fTxn', state.fee.txn);
    const feeResponsePromise = page.waitForResponse((response) => response.url().includes('/api/fees') && response.request().method() === 'POST');
    await page.locator('#recordFeeModal .btn.btn-primary').click();
    const feeResponse = await feeResponsePromise;
    const feeJson = await feeResponse.json();
    expect(feeJson.success).toBeTruthy();
    await page.waitForFunction((name) => (document.getElementById('feeBody')?.innerText || '').includes(name), state.student.name);

    await page.goto('/pages/college-admin/notices.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Post Notice/i }).click();
    await page.waitForSelector('#postNoticeModal.open');
    await page.fill('#nTitle', state.notice.title);
    await page.selectOption('#nCategory', { label: 'Urgent' });
    await page.selectOption('#nTarget', { label: 'Students Only' });
    await page.fill('#nBody', state.notice.body);
    await page.fill('#nExpiry', TOMORROW);
    const noticeResponsePromise = page.waitForResponse((response) => response.url().includes('/api/notices') && response.request().method() === 'POST');
    await page.locator('#postNoticeModal .btn.btn-primary').click();
    const noticeResponse = await noticeResponsePromise;
    const noticeJson = await noticeResponse.json();
    expect(noticeJson.success).toBeTruthy();
    await page.waitForFunction((title) => (document.getElementById('noticesGrid')?.innerText || '').includes(title), state.notice.title);

    await page.goto('/pages/college-admin/logistics.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add Hostel/i }).click();
    await page.waitForSelector('#addHostelModal.open');
    await page.fill('#hostelNameInput', state.hostel.name);
    await page.selectOption('#hostelTypeInput', { label: 'Boys' });
    await page.fill('#hostelRoomsInput', '10');
    await page.fill('#hostelFacilitiesInput', 'WiFi, Mess');
    const hostelResponsePromise = page.waitForResponse((response) => response.url().includes('/api/logistics/hostels') && response.request().method() === 'POST');
    await page.locator('#addHostelModal .btn.btn-primary').click();
    const hostelResponse = await hostelResponsePromise;
    const hostelJson = await hostelResponse.json();
    expect(hostelJson.success).toBeTruthy();
    await page.waitForFunction((name) => (document.getElementById('hostelsGrid')?.innerText || '').includes(name), state.hostel.name);
    // Socket-driven refresh (erp:data-change → 300ms debounce → loadLogistics)
    // repopulates the hostel <select>s and clears any selection — let it settle
    // before interacting with the room modal.
    await page.waitForTimeout(700);

    await page.getByRole('button', { name: /Add Room/i }).click();
    await page.waitForSelector('#addRoomModal.open');
    await page.fill('#roomNumberInput', state.hostel.roomNumber);
    await page.fill('#roomCapacityInput', '2');
    await page.fill('#roomFeeInput', '25000');
    // Select last so a stray refresh cannot clear it before submit.
    await page.selectOption('#roomHostelSelect', hostelJson.hostel._id);
    const roomResponsePromise = page.waitForResponse((response) => response.url().includes('/api/logistics/hostels/rooms') && response.request().method() === 'POST');
    await page.locator('#addRoomModal .btn.btn-primary').click();
    const roomResponse = await roomResponsePromise;
    const roomJson = await roomResponse.json();
    expect(roomJson.success).toBeTruthy();
    await page.waitForTimeout(700); // let the room-create refresh settle too

    await page.getByRole('button', { name: /Allocate Room/i }).click();
    await page.waitForSelector('#allocateRoomModal.open');
    await page.fill('#allocateRollInput', state.student.roll);
    await page.fill('#allocateRoomNumberInput', state.hostel.roomNumber);
    await page.selectOption('#hostelSelectAllocate', hostelJson.hostel._id);
    const allocateResponsePromise = page.waitForResponse((response) => response.url().includes('/api/logistics/hostels/allocate') && response.request().method() === 'POST');
    await page.locator('#allocateRoomModal .btn.btn-primary').click();
    const allocateResponse = await allocateResponsePromise;
    const allocateJson = await allocateResponse.json();
    expect(allocateJson.success).toBeTruthy();

    await page.locator('.card.mb-6 .card-header .btn.btn-primary.btn-sm').click();
    await page.waitForSelector('#addRouteModal.open');
    await page.fill('#routeNoInput', state.route.name);
    await page.fill('#routeBusInput', state.route.busNumber);
    await page.fill('#routeStopsInput', 'City Center, Station');
    await page.fill('#routeDriverInput', `Driver ${QA_STAMP}`);
    await page.fill('#routeDriverPhoneInput', '9345678901');
    await page.fill('#routeMorningInput', '08:00');
    await page.fill('#routeEveningInput', '17:00');
    const routeResponsePromise = page.waitForResponse((response) => response.url().includes('/api/logistics/transport') && response.request().method() === 'POST');
    await page.locator('#addRouteModal .btn.btn-primary').click();
    const routeResponse = await routeResponsePromise;
    const routeJson = await routeResponse.json();
    expect(routeJson.success).toBeTruthy();
    await page.waitForFunction((name) => (document.getElementById('routesBody')?.innerText || '').includes(name), state.route.name);
  });

  test('faculty student parent and database views stay in sync', async ({ browser, baseURL }) => {
    const facultyContext = await browser.newContext();
    const facultyPage = await facultyContext.newPage();
    await login(facultyPage, state.faculty.email, state.faculty.password, '/pages/faculty/dashboard.html');

    await facultyPage.goto(`${baseURL}/pages/faculty/grades.html`, { waitUntil: 'domcontentloaded' });
    await selectOptionContaining(facultyPage, '#gradeSubject', state.subject.name);
    await facultyPage.evaluate(() => window.loadMarks && window.loadMarks());
    await expect(facultyPage.getByText(state.student.name).first()).toBeVisible();
    await facultyPage.getByRole('button', { name: /Bulk Upload/i }).click();
    await facultyPage.waitForSelector('#bulkUploadModal', { state: 'visible' });
    await facultyPage.setInputFiles('#csvFileInput', {
      name: `grades-${QA_STAMP}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(`roll_no,marks,remarks\n${state.student.roll},18,Good work`, 'utf8'),
    });
    await facultyPage.locator('#bulkUploadModal .btn.btn-primary').click();
    await facultyPage.waitForFunction(() => Array.from(document.querySelectorAll('#gradesBody input[type="number"]')).some((input) => input.value === '18'));
    const gradeSavePromise = facultyPage.waitForResponse((response) => response.url().includes('/api/exams/results') && response.request().method() === 'POST');
    await facultyPage.locator('#headerSaveBtn').click();
    const gradeSaveResponse = await gradeSavePromise;
    const gradeSaveJson = await gradeSaveResponse.json();
    expect(gradeSaveJson.success).toBeTruthy();

    await facultyPage.goto(`${baseURL}/pages/faculty/assignments.html`, { waitUntil: 'domcontentloaded' });
    await facultyPage.getByRole('button', { name: /Create Assignment/i }).click();
    await facultyPage.waitForSelector('#assignmentModal.open');
    await facultyPage.fill('#formTitle', state.assignment.title);
    await selectOptionContaining(facultyPage, '#formSubject', state.subject.name);
    await facultyPage.fill('#formTotalMarks', state.assignment.marks);
    await facultyPage.fill('#formDueDate', `${TOMORROW}T18:00`);
    await facultyPage.fill('#formDescription', state.assignment.description);
    const assignmentResponsePromise = facultyPage.waitForResponse((response) => response.url().includes('/api/assignments') && response.request().method() === 'POST');
    await facultyPage.locator('#assignmentModal .btn.btn-primary').click();
    const assignmentResponse = await assignmentResponsePromise;
    const assignmentJson = await assignmentResponse.json();
    expect(assignmentJson.success).toBeTruthy();

    await facultyPage.goto(`${baseURL}/pages/faculty/live-class.html`, { waitUntil: 'domcontentloaded' });
    await selectOptionContaining(facultyPage, '#subjectSelect', state.subject.name);
    await facultyPage.fill('#topicInput', state.liveClassTopic);
    const liveResponsePromise = facultyPage.waitForResponse((response) => response.url().includes('/api/live-classes') && response.request().method() === 'POST');
    await facultyPage.getByRole('button', { name: /Launch Live Studio Now/i }).click();
    const liveResponse = await liveResponsePromise;
    const liveJson = await liveResponse.json();
    expect(liveJson.success).toBeTruthy();

    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await login(studentPage, state.student.email, state.student.password, '/pages/student/dashboard.html');
    await studentPage.goto(`${baseURL}/pages/student/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await studentPage.waitForFunction(({ title, hostel }) => {
      const notices = document.getElementById('noticesBody')?.innerText || '';
      const body = document.body.innerText || '';
      return notices.includes(title) && body.includes(hostel);
    }, { title: state.notice.title, hostel: state.hostel.name });

    await studentPage.goto(`${baseURL}/pages/student/fees.html`, { waitUntil: 'domcontentloaded' });
    // Backend normalizes fee types via feeTypeMap ('Exam Fee' → stored 'exam'),
    // and the row renders feeType.toUpperCase() — so assert on 'EXAM', not
    // the raw 'Exam Fee' label.
    await studentPage.waitForFunction(() => (document.getElementById('studentFeeTableBody')?.innerText || '').toUpperCase().includes('EXAM'));

    await studentPage.goto(`${baseURL}/pages/student/assignments.html`, { waitUntil: 'domcontentloaded' });
    await studentPage.waitForSelector('.task-card');
    await studentPage.waitForFunction((title) => (document.body.innerText || '').includes(title), state.assignment.title);

    await studentPage.goto(`${baseURL}/pages/student/live-class.html`, { waitUntil: 'domcontentloaded' });
    await studentPage.waitForFunction((topic) => (document.body.innerText || '').includes(topic), state.liveClassTopic);
    await studentPage.getByRole('button', { name: /Join Live Studio/i }).click();
    await studentPage.waitForSelector('#active-call', { state: 'visible' });

    const parentContext = await browser.newContext();
    const parentPage = await parentContext.newPage();
    await login(parentPage, state.parent.email, state.parent.password, '/pages/parent/dashboard.html');
    await parentPage.goto(`${baseURL}/pages/parent/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await parentPage.waitForFunction((topic) => (document.body.innerText || '').includes(topic), state.liveClassTopic);

    await parentPage.goto(`${baseURL}/pages/parent/child-profile.html`, { waitUntil: 'domcontentloaded' });
    // The mentor card sits on the default "Academic & Faculty" tab; the hostel
    // details live on the "Campus Services & Living" tab. body.innerText excludes
    // hidden tab panels, so assert each on its own visible tab.
    await parentPage.waitForFunction((faculty) => (document.body.innerText || '').includes(faculty), state.faculty.name);
    await parentPage.getByRole('button', { name: /Campus Services & Living/i }).click();
    await parentPage.waitForFunction((hostel) => (document.body.innerText || '').includes(hostel), state.hostel.name);

    await parentPage.goto(`${baseURL}/pages/parent/fees.html`, { waitUntil: 'domcontentloaded' });
    await parentPage.waitForFunction(() => (document.body.innerText || '').toUpperCase().includes('EXAM'));

    const superadminContext = await browser.newContext();
    const superadminPage = await superadminContext.newPage();
    await login(superadminPage, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, '/pages/super-admin/dashboard.html');
    await superadminPage.goto(`${baseURL}/pages/super-admin/database.html`, { waitUntil: 'domcontentloaded' });
    await superadminPage.waitForTimeout(1500);
    await superadminPage.click('#card-colleges');
    await superadminPage.fill('#docSearch', state.college.name);
    await superadminPage.waitForFunction((name) => (document.getElementById('tableArea')?.innerText || '').includes(name), state.college.name);

    await superadminPage.goto(`${baseURL}/pages/super-admin/database.html`, { waitUntil: 'domcontentloaded' });
    await superadminPage.waitForTimeout(1500);
    await superadminPage.click('#card-users');
    await superadminPage.fill('#docSearch', state.student.email);
    await superadminPage.waitForFunction((email) => (document.getElementById('tableArea')?.innerText || '').includes(email), state.student.email);

    await facultyContext.close();
    await studentContext.close();
    await parentContext.close();
    await superadminContext.close();
  });

  test('faculty builds and publishes a quiz, student takes and submits it', async ({ browser, baseURL, request }) => {
    // ── API setup: course + subject (admin), questions + quiz (faculty) ──
    const adminLogin = await request.post(`${baseURL}/api/v1/auth/login`, {
      data: { email: state.college.adminEmail, password: state.college.adminPassword },
    });
    expect(adminLogin.ok()).toBeTruthy();
    const adminToken = (await adminLogin.json()).token;

    const facultyLogin = await request.post(`${baseURL}/api/v1/auth/login`, {
      data: { email: state.faculty.email, password: state.faculty.password },
    });
    expect(facultyLogin.ok()).toBeTruthy();
    const facultyJson = await facultyLogin.json();
    const facultyToken = facultyJson.token;
    const facultyId = facultyJson.user.id;

    const courseRes = await request.post(`${baseURL}/api/v1/academics/courses`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: `QA Quiz Course ${QA_STAMP}`,
        code: `QQC${QA_STAMP}`,
        department: 'Computer Science',
        duration: 4,
        totalSemesters: 8,
      },
    });
    expect(courseRes.ok()).toBeTruthy();
    const courseId = (await courseRes.json()).course._id;

    const subjectRes = await request.post(`${baseURL}/api/v1/academics/subjects`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        courseId,
        name: `QA Quiz Subject ${QA_STAMP}`,
        code: `QQS${QA_STAMP}`,
        semester: 1,
        credits: 3,
        facultyId,
      },
    });
    expect(subjectRes.ok()).toBeTruthy();
    const subjectId = (await subjectRes.json()).subject._id;

    const mkQuestion = async (text, correctIdx) => {
      const r = await request.post(`${baseURL}/api/v1/exam-generator/questions`, {
        headers: { Authorization: `Bearer ${facultyToken}` },
        data: {
          subjectId,
          unit: 'E2E',
          chapter: 'Basics',
          questionText: text,
          questionType: 'mcq',
          options: ['Alpha option', 'Beta option', 'Gamma option'].map((t, i) => ({ text: t, isCorrect: i === correctIdx })),
          difficulty: 'easy',
          marks: 1,
          explanation: 'Because option is correct.',
          tags: ['e2e'],
        },
      });
      expect(r.ok()).toBeTruthy();
      return (await r.json()).question._id;
    };
    const q1 = await mkQuestion(`QA quiz ${QA_STAMP}: pick the right option one?`, 0);
    const q2 = await mkQuestion(`QA quiz ${QA_STAMP}: pick the right option two?`, 1);

    const quizTitle = `QA Quiz ${QA_STAMP}`;
    const quizRes = await request.post(`${baseURL}/api/v1/quizzes`, {
      headers: { Authorization: `Bearer ${facultyToken}` },
      data: {
        title: quizTitle,
        description: 'Practice quiz created by the E2E suite.',
        type: 'quiz',
        subjectId,
        educationLevel: 'undergraduate',
        sections: [{ name: 'Section A', questionIds: [q1, q2], marksEach: 2 }],
        settings: { duration: 10, maxAttempts: 1, passPercentage: 40, negativeMarking: 0, showResults: true, allowReview: true },
      },
    });
    expect(quizRes.ok()).toBeTruthy();
    const quizId = (await quizRes.json()).quiz._id;

    const publishRes = await request.patch(`${baseURL}/api/v1/quizzes/${quizId}/publish`, {
      headers: { Authorization: `Bearer ${facultyToken}` },
      data: { isPublished: true },
    });
    expect(publishRes.ok()).toBeTruthy();

    // ── Student UI: practice dashboard → take quiz → submit → review ──
    const quizContext = await browser.newContext();
    const quizPage = await quizContext.newPage();
    await login(quizPage, state.student.email, state.student.password, '/pages/student/dashboard.html');

    await quizPage.goto(`${baseURL}/pages/student/exam-prep.html`, { waitUntil: 'domcontentloaded' });
    await quizPage.waitForFunction((title) => (document.body.innerText || '').includes(title), quizTitle);
    const startButton = quizPage.locator('.prep-card', { hasText: quizTitle }).locator('button', { hasText: 'Start Quiz' });
    await startButton.click();

    await quizPage.waitForURL(/\/pages\/student\/quiz-take\.html\?quiz=/, { timeout: 15000 });
    await quizPage.waitForSelector('#questionHost .opt-btn', { timeout: 15000 });
    await quizPage.locator('#questionHost .opt-btn').first().click();

    // Jump to the last question and submit through the confirm modal.
    await quizPage.locator('#palette .p-dot').last().click();
    await quizPage.locator('#nextBtn').click();
    await quizPage.waitForSelector('#submitModal.open', { timeout: 5000 });
    await quizPage.locator('#submitModal button', { hasText: 'Submit Now' }).click();

    await quizPage.waitForSelector('#resultView', { state: 'visible', timeout: 20000 });
    const resultText = await quizPage.locator('#resultView').innerText();
    expect(resultText).toContain('Submitted successfully');
    expect(resultText).toContain('Answer Review');

    // Result is visible in history with the graded review.
    await quizPage.goto(`${baseURL}/pages/student/quiz-history.html`, { waitUntil: 'domcontentloaded' });
    await quizPage.waitForFunction((title) => (document.body.innerText || '').includes(title), quizTitle);
    await quizPage.locator('#histList button, #histList a').first().click();
    await quizPage.waitForSelector('#reviewModal.open', { timeout: 5000 });
    const reviewText = await quizPage.locator('#reviewModal').innerText();
    expect(reviewText).toContain('Your answer:');

    await quizContext.close();
  });
});
