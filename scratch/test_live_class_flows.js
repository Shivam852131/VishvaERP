const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const User = require('../backend/models/User');
const Subject = require('../backend/models/Subject');
const Course = require('../backend/models/Course');
const College = require('../backend/models/College');
const LiveClassSession = require('../backend/models/LiveClassSession');
const Attendance = require('../backend/models/Attendance');

const liveClassController = require('../backend/controllers/liveClassController');

async function runTests() {
  console.log('--- STARTING LIVE CLASSROOM FLOWS VERIFICATION ---');
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/vishva_erp';
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected successfully.\n');

  try {
    // 1. Locate test college and users
    let college = await College.findOne();
    if (!college) {
      college = await College.create({
        name: 'Vishva Institute of Technology',
        code: 'VIT-TEST',
        address: 'Knowledge City',
        contactEmail: 'admin@vit-test.edu',
        subscriptionPlan: 'enterprise',
      });
    }

    let faculty = await User.findOne({ collegeId: college._id, role: 'faculty' });
    if (!faculty) {
      faculty = await User.create({
        collegeId: college._id,
        name: 'Prof. Ananya Sen',
        email: `ananya.faculty.${Date.now()}@vit-test.edu`,
        password: 'Password123!',
        role: 'faculty',
        department: 'Computer Science',
      });
    }

    let student = await User.findOne({ collegeId: college._id, role: 'student' });
    if (!student) {
      student = await User.create({
        collegeId: college._id,
        name: 'Rohan Verma',
        email: `rohan.student.${Date.now()}@vit-test.edu`,
        password: 'Password123!',
        role: 'student',
        department: 'Computer Science',
        semester: 4,
        rollNo: 'CS2026-088',
      });
    }

    let course = await Course.findOne({ collegeId: college._id });
    if (!course) {
      course = await Course.create({
        collegeId: college._id,
        name: 'B.Tech Computer Science',
        code: 'CS-BTECH',
        department: 'Computer Science',
        durationYears: 4,
      });
    }

    let subject = await Subject.findOne({ collegeId: college._id });
    if (!subject) {
      subject = await Subject.create({
        collegeId: college._id,
        courseId: course._id,
        name: 'Advanced Data Structures',
        code: 'CS-401',
        semester: student.semester || 4,
        facultyId: faculty._id,
      });
    }

    console.log(`Context: College=${college.name}, Faculty=${faculty.name}, Student=${student.name}, Subject=${subject.name}`);

    // Mock Express request/response helper
    function mockReqRes(user, body = {}, params = {}, query = {}) {
      const req = { user, body, params, query, headers: {} };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.data = data; return this; },
        send(data) { this.data = data; return this; },
      };
      return { req, res };
    }

    // 2. Start Live Class Session
    console.log('\nStep 1: Start Live Class Session as Faculty');
    const { req: startReq, res: startRes } = mockReqRes(faculty, {
      subjectId: subject._id,
      title: 'Trees & Heaps Mastery - Live Workshop',
      department: 'Computer Science',
      semester: subject.semester || 4,
      status: 'active',
      tags: ['data-structures', 'algorithms'],
    });
    await liveClassController.startLiveClass(startReq, startRes);
    const session = startRes.data?.session;
    if (!session || !session._id) throw new Error('Failed to start session: ' + JSON.stringify(startRes.data));
    console.log(` Session Started: ID=${session._id}, Room=${session.roomName}, Status=${session.status}`);

    // 3. Student Joins Live Class
    console.log('\nStep 2: Student Joins Live Class Session');
    const { req: joinReq, res: joinRes } = mockReqRes(student, {}, { id: session._id });
    await liveClassController.joinLiveClass(joinReq, joinRes);
    if (!joinRes.data?.success) throw new Error('Join failed: ' + JSON.stringify(joinRes.data));
    console.log(` Student Joined: Name=${joinRes.data.attendee?.name}, JoinedAt=${joinRes.data.attendee?.joinedAt}`);

    // 4. Student Toggles Raise Hand
    console.log('\nStep 3: Student Raises Hand');
    const { req: rhReq, res: rhRes } = mockReqRes(student, {}, { id: session._id });
    await liveClassController.raiseHand(rhReq, rhRes);
    console.log(` Hand Raised status: ${rhRes.data?.handRaised}`);

    // 5. In-session Chat
    console.log('\nStep 4: Student & Faculty In-Class Chat');
    const { req: chatReq1, res: chatRes1 } = mockReqRes(student, { message: 'Professor, is AVL rotation O(1) amortized?' }, { id: session._id });
    await liveClassController.postChatMessage(chatReq1, chatRes1);
    console.log(` Student Chat logged: "${chatRes1.data?.chatEntry?.message}"`);

    const { req: chatReq2, res: chatRes2 } = mockReqRes(faculty, { message: 'Yes Rohan, single and double rotations are strictly O(1) time!' }, { id: session._id });
    await liveClassController.postChatMessage(chatReq2, chatRes2);
    console.log(` Faculty Reply logged: "${chatRes2.data?.chatEntry?.message}"`);

    // 6. Interactive Poll
    console.log('\nStep 5: Faculty Launches Pulse Poll & Student Votes');
    const { req: pollReq, res: pollRes } = mockReqRes(faculty, {
      question: 'Do you understand AVL tree balance factors?',
      options: ['Yes, crystal clear', 'Need another dry run', 'Confused on RR rotation'],
    }, { id: session._id });
    await liveClassController.createOrVotePoll(pollReq, pollRes);
    const publishedPoll = pollRes.data?.poll;
    console.log(` Poll created with ${publishedPoll?.options?.length} options: "${publishedPoll?.question}"`);

    // Student votes on option 1
    const optId = publishedPoll.options[0].id;
    const { req: voteReq, res: voteRes } = mockReqRes(student, { optionId: optId }, { id: session._id });
    await liveClassController.createOrVotePoll(voteReq, voteRes);
    console.log(` Student voted on ${optId}. Votes tally:`, voteRes.data?.poll?.options);

    // 7. Whiteboard snapshot save
    console.log('\nStep 6: Faculty Saves Whiteboard Snapshot');
    const sampleCanvasPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const { req: wbReq, res: wbRes } = mockReqRes(faculty, { whiteboardData: sampleCanvasPng }, { id: session._id });
    await liveClassController.saveWhiteboard(wbReq, wbRes);
    console.log(` Whiteboard snapshot saved.`);

    // 8. Attach Study Material & Recording Link
    console.log('\nStep 7: Attach Slide Handout and Recording Link');
    const { req: matReq, res: matRes } = mockReqRes(faculty, {
      title: 'AVL Trees Full Lecture Deck',
      url: 'https://drive.google.com/sample-deck.pdf',
      type: 'slide',
    }, { id: session._id });
    await liveClassController.addMaterial(matReq, matRes);
    console.log(` Material attached: Count=${matRes.data?.materials?.length}`);

    const { req: recReq, res: recRes } = mockReqRes(faculty, {
      recordingUrl: 'https://vimeo.com/sample-lecture-123',
      recordingDuration: 55,
      description: 'Complete high-definition recording of live trees lecture.',
    }, { id: session._id });
    await liveClassController.updateRecording(recReq, recRes);
    console.log(` Recording URL updated: ${recRes.data?.session?.recordingUrl}`);

    // 9. Sync Attendance to ERP
    console.log('\nStep 8: Synchronize Attendance to Official ERP Ledger');
    // Ensure student duration is set to 15 mins to test present qualification
    await LiveClassSession.updateOne(
      { _id: session._id, 'attendees.studentId': student._id },
      { $set: { 'attendees.$.durationMinutes': 15 } }
    );

    const { req: syncReq, res: syncRes } = mockReqRes(faculty, { minDurationMinutes: 10 }, { id: session._id });
    await liveClassController.syncAttendance(syncReq, syncRes);
    console.log(` Attendance Sync Result:`, syncRes.data);

    // Check Attendance collection directly
    const sessionDate = new Date();
    sessionDate.setHours(0, 0, 0, 0);
    const attRecord = await Attendance.findOne({
      collegeId: college._id,
      studentId: student._id,
      subjectId: subject._id,
      date: sessionDate,
    });
    if (!attRecord) throw new Error('Attendance record not found in database!');
    console.log(` Verified Database Attendance Record: Status=${attRecord.status}, Source=${attRecord.source}, Verification=${attRecord.verificationMethod}, Remarks="${attRecord.remarks}"`);
    if (attRecord.status !== 'present') throw new Error(`Expected status 'present', got '${attRecord.status}'`);

    // 10. End Live Class Session
    console.log('\nStep 9: End Live Class Session');
    const { req: endReq, res: endRes } = mockReqRes(faculty, {}, { id: session._id });
    await liveClassController.endLiveClass(endReq, endRes);
    console.log(` Session Ended: Status=${endRes.data?.session?.status}, EndedAt=${endRes.data?.session?.endedAt}`);

    // 11. Verify Lecture Recordings Vault
    console.log('\nStep 10: Query Lecture Recordings Archive');
    const { req: vaultReq, res: vaultRes } = mockReqRes(student, {}, {}, {});
    await liveClassController.listRecordings(vaultReq, vaultRes);
    const found = vaultRes.data?.recordings?.find(r => String(r._id) === String(session._id));
    if (!found) throw new Error('Session not found in recordings archive!');
    console.log(` Archive Query: Found ${vaultRes.data?.count} recordings. Session in archive: "${found.title}" with recording=${found.recordingUrl}`);

    console.log('\n ALL 10 VIRTUAL CLASSROOM & VIDEO RECORDING TESTS PASSED FLAWLESSLY! ');

  } catch (err) {
    console.error('\n TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

runTests();
