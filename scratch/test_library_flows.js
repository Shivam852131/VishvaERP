require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');

const User = require('../backend/models/User');
const College = require('../backend/models/College');
const Subscription = require('../backend/models/Subscription');
const { Book, LibraryRecord } = require('../backend/models/Library');
const { generateToken } = require('../backend/config/jwt');

process.env.VERCEL = 'true'; // Prevent automatic listen in server.js
const app = require('../backend/server');

let BASE_URL = '';
let server = null;

async function runLibraryTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       SUITE 14: LIBRARY & CIRCULATION MANAGEMENT SUITE     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/vishva_erp');
  console.log(' Connected to MongoDB');

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  BASE_URL = `http://127.0.0.1:${port}/api`;
  console.log(` Test server listening at ${BASE_URL}\n`);

  let college = await College.findOne({ isActive: true });
  if (!college) {
    college = await College.create({
      name: 'Central Library Technical University',
      code: 'CLTU-01',
      address: 'Knowledge Park, Hyderabad',
      email: 'library@cltu.edu',
      phone: '9876511223',
      isActive: true,
    });
  }

  // Ensure active subscription for requireSubscription middleware
  await Subscription.findOneAndUpdate(
    { collegeId: college._id },
    {
      collegeId: college._id,
      plan: 'enterprise',
      amount: 99999,
      status: 'active',
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    { upsert: true, new: true }
  );
  college.planExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await college.save();

  const uniqueSuffix = Date.now().toString();

  // Create Librarian Admin
  const admin = await User.create({
    name: 'Chief Librarian S. Mukherjee',
    email: `librarian.${uniqueSuffix}@cltu.edu`,
    password: 'Password123!',
    role: 'collegeAdmin',
    collegeId: college._id,
    department: 'Central Library Services',
    phone: '9811223344',
    isActive: true,
  });

  // Create Student
  const student = await User.create({
    name: 'Pooja Bhatt',
    email: `pooja.${uniqueSuffix}@cltu.edu`,
    password: 'Password123!',
    role: 'student',
    collegeId: college._id,
    rollNo: `CS-LIB-${uniqueSuffix.slice(-4)}`,
    department: 'Computer Science',
    semester: 5,
    phone: '9822334455',
    isActive: true,
  });

  // Create Second Student (for desk issue testing)
  const student2 = await User.create({
    name: 'Aditya Rao',
    email: `aditya.${uniqueSuffix}@cltu.edu`,
    password: 'Password123!',
    role: 'student',
    collegeId: college._id,
    rollNo: `EC-LIB-${uniqueSuffix.slice(-4)}`,
    department: 'Electronics & Communication',
    semester: 5,
    phone: '9833445566',
    isActive: true,
  });

  const adminToken = generateToken({ id: admin._id, role: admin.role, collegeId: college._id });
  const studentToken = generateToken({ id: student._id, role: student.role, collegeId: college._id });

  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
  const studentHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` };

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  PASS: ${message}`);
      passed++;
    } else {
      console.error(`  FAIL: ${message}`);
    }
  }

  let book1Id = null;
  let book2Id = null;
  let testIssueId = null;
  let testReserveId = null;
  let overdueLoanId = null;

  console.log('--- Phase 1: Book Cataloging & Metadata Ingestion ---');
  {
    // 1. Catalog Book 1
    const bookRes1 = await fetch(`${BASE_URL}/library/books`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: 'Designing Data-Intensive Applications',
        author: 'Martin Kleppmann',
        isbn: `978-1449373320-${uniqueSuffix.slice(-4)}`,
        barcode: `BAR-DDIA-${uniqueSuffix.slice(-4)}`,
        category: 'Computer Science',
        subject: 'Distributed Systems',
        publisher: "O'Reilly Media",
        edition: '1st Edition',
        totalCopies: 4,
        location: 'Rack B-14',
        description: 'The definitive handbook to reliable, scalable, and maintainable systems.',
      }),
    });
    const bookData1 = await bookRes1.json();
    assert(bookRes1.status === 201 && bookData1.success, 'Cataloged Book 1 with copies and shelf location');
    book1Id = bookData1.book?._id || bookData1.data?._id;

    // 2. Catalog Book 2
    const bookRes2 = await fetch(`${BASE_URL}/library/books`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: 'Clean Architecture: A Craftsman\'s Guide',
        author: 'Robert C. Martin',
        isbn: `978-0134494166-${uniqueSuffix.slice(-4)}`,
        barcode: `BAR-ARCH-${uniqueSuffix.slice(-4)}`,
        category: 'Software Engineering',
        subject: 'Software Design Patterns',
        publisher: 'Prentice Hall',
        totalCopies: 1,
        location: 'Rack A-02',
      }),
    });
    const bookData2 = await bookRes2.json();
    assert(bookRes2.status === 201 && bookData2.success, 'Cataloged Book 2 with single copy availability');
    book2Id = bookData2.book?._id || bookData2.data?._id;

    // 3. Prevent Missing Title/Author Book Creation
    const invalidBookRes = await fetch(`${BASE_URL}/library/books`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ totalCopies: 2 }),
    });
    assert(invalidBookRes.status === 400, 'Blocked cataloging without title or author');
  }

  console.log('\n--- Phase 2: Catalog Search & ISBN / Barcode Fast Lookup ---');
  {
    // 4. Query All Books
    const getBooksRes = await fetch(`${BASE_URL}/library/books`, { headers: studentHeaders });
    const getBooksData = await getBooksRes.json();
    assert(getBooksRes.status === 200 && (getBooksData.books?.length >= 2 || getBooksData.data?.length >= 2), 'Retrieved catalog books list');

    // 5. Query by Text Search
    const searchRes = await fetch(`${BASE_URL}/library/books?search=Kleppmann`, { headers: studentHeaders });
    const searchData = await searchRes.json();
    assert(searchRes.status === 200 && (searchData.books?.[0]?.title || searchData.data?.[0]?.title).includes('Data-Intensive'), 'Search filter matched by author');

    // 6. Direct ISBN / Barcode Endpoint Lookup
    const isbnQuery = `978-1449373320-${uniqueSuffix.slice(-4)}`;
    const isbnRes = await fetch(`${BASE_URL}/library/books/isbn/${isbnQuery}`, { headers: studentHeaders });
    const isbnData = await isbnRes.json();
    assert(isbnRes.status === 200 && (isbnData.book?.title || isbnData.data?.title).includes('Data-Intensive'), 'Looked up book by ISBN directly');

    // 7. Direct /api/books alias parity
    const aliasRes = await fetch(`${BASE_URL}/books`, { headers: studentHeaders });
    const aliasData = await aliasRes.json();
    assert(aliasRes.status === 200 && (aliasData.books?.length >= 2 || aliasData.data?.length >= 2), 'Route alias /api/books returns full catalog parity');
  }

  console.log('\n--- Phase 3: Student Self-Reservation & Hold ---');
  {
    // 8. Student Reserves Book
    const reserveRes = await fetch(`${BASE_URL}/library/reserve`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ bookId: book2Id }),
    });
    const reserveData = await reserveRes.json();
    assert(reserveRes.status === 201 && reserveData.record?.status === 'reserved', 'Student reserved single-copy book');
    testReserveId = reserveData.record?._id;

    // 9. Verify Available Copies Decrement After Reservation
    const checkBook2 = await fetch(`${BASE_URL}/library/books/${book2Id}`, { headers: studentHeaders });
    const checkBook2Data = await checkBook2.json();
    assert(checkBook2Data.book?.availableCopies === 0, 'Available copies decremented to 0 after reservation hold');

    // 10. Prevent Duplicate Loan/Reservation for Same Book
    const dupRes = await fetch(`${BASE_URL}/library/reserve`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ bookId: book2Id }),
    });
    assert(dupRes.status === 400, 'Blocked duplicate reservation by same student');
  }

  console.log('\n--- Phase 4: Desk Issue Terminal by Student Roll Number ---');
  {
    // 11. Admin Issues Book 1 to Student 2 via Roll Number
    const issueRes = await fetch(`${BASE_URL}/library/issue`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        bookId: book1Id,
        rollNo: student2.rollNo,
        dueDays: 14,
      }),
    });
    const issueData = await issueRes.json();
    assert(issueRes.status === 201 && issueData.record?.status === 'issued', 'Issued book via student roll number at desk terminal');
    testIssueId = issueData.record?._id;

    // 12. Check Book 1 Available Copies Decrement
    const checkBook1 = await fetch(`${BASE_URL}/library/books/${book1Id}`, { headers: adminHeaders });
    const checkBook1Data = await checkBook1.json();
    assert(checkBook1Data.book?.availableCopies === 3, 'Book 1 available copies decremented from 4 to 3');
  }

  console.log('\n--- Phase 5: Student Loan Dashboard & Renewal Flow ---');
  {
    // 13. Student Checks Personal Active Loans
    const myLoansRes = await fetch(`${BASE_URL}/library/books/mine`, { headers: studentHeaders });
    const myLoansData = await myLoansRes.json();
    assert(myLoansRes.status === 200 && Array.isArray(myLoansData.records) && myLoansData.records.length >= 1, 'Student retrieved personal loan ledger');

    // 14. Admin / Student Renews Active Loan (+14 Days)
    const renewRes = await fetch(`${BASE_URL}/library/renew/${testIssueId}`, {
      method: 'POST',
      headers: adminHeaders,
    });
    const renewData = await renewRes.json();
    assert(renewRes.status === 200 && renewData.record?.renewalCount >= 1, 'Loan successfully renewed and renewalCount incremented');
  }

  console.log('\n--- Phase 6: Overdue Loan Sweep & Automated Fine Calculation ---');
  {
    // 15. Seed an Overdue Loan (Borrowed 20 days ago, due 6 days ago)
    const overdueRecord = await LibraryRecord.create({
      collegeId: college._id,
      bookId: book1Id,
      userId: student._id,
      issuedDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      dueDate: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      status: 'issued',
    });
    overdueLoanId = overdueRecord._id;

    // 16. Trigger Overdue Sweep
    const sweepRes = await fetch(`${BASE_URL}/library/scan-overdue`, {
      method: 'POST',
      headers: adminHeaders,
    });
    const sweepData = await sweepRes.json();
    assert(sweepRes.status === 200 && sweepData.updatedCount >= 1, 'Automated overdue sweep detected and transitioned expired loan');

    // 17. Verify Calculated Fine for Overdue Loan
    const checkOverdue = await LibraryRecord.findById(overdueLoanId);
    assert(checkOverdue.status === 'overdue' && checkOverdue.fine >= 50, `Calculated overdue fine correctly (Fine: ₹${checkOverdue.fine})`);
  }

  console.log('\n--- Phase 7: Book Return & Fine Settlement ---');
  {
    // 18. Process Book Return on Overdue Loan
    const returnRes = await fetch(`${BASE_URL}/library/return/${overdueLoanId}`, {
      method: 'POST',
      headers: adminHeaders,
    });
    const returnData = await returnRes.json();
    assert(returnRes.status === 200 && returnData.record?.status === 'returned' && returnData.record?.returnDate, 'Book returned with return timestamp and calculated fine');

    // 19. Verify Book 1 Available Copies Restored
    const restoredBook1 = await Book.findById(book1Id);
    assert(restoredBook1.availableCopies === 4, 'Book 1 available copies restored back to 4');

    // 20. Pay Pending Fine
    const payRes = await fetch(`${BASE_URL}/library/pay-fine/${overdueLoanId}`, {
      method: 'POST',
      headers: adminHeaders,
    });
    const payData = await payRes.json();
    assert(payRes.status === 200 && payData.record?.finePaid === true, 'Library fine marked settled and paid');

    // 21. Also Return the Second Active Loan
    const returnLoan2 = await fetch(`${BASE_URL}/library/return/${testIssueId}`, {
      method: 'POST',
      headers: adminHeaders,
    });
    assert(returnLoan2.status === 200, 'Returned second active loan');
  }

  console.log('\n--- Phase 8: Library Statistics & Catalog CSV Export ---');
  {
    // 22. Library Statistics Dashboard
    const statsRes = await fetch(`${BASE_URL}/library/stats`, { headers: adminHeaders });
    const statsData = await statsRes.json();
    assert(statsRes.status === 200 && statsData.stats?.totalBooks >= 2, 'Library statistics retrieved with catalog volume');
    assert(typeof statsData.stats?.totalFineCollected === 'number', 'Stats include totalFineCollected ledger');

    // 23. Catalog CSV Export
    const exportRes = await fetch(`${BASE_URL}/library/export`, { headers: adminHeaders });
    const csvContent = await exportRes.text();
    assert(exportRes.status === 200 && csvContent.includes('Book ID') && csvContent.includes('Designing Data-Intensive Applications'), 'Catalog exported as RFC compliant CSV');
  }

  console.log('\n--- Phase 9: Active Loan Deletion Safeguards ---');
  {
    // 24. Delete Clean Returned Book (Permitted)
    const deleteRes = await fetch(`${BASE_URL}/library/books/${book1Id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    const deleteData = await deleteRes.json();
    assert(deleteRes.status === 200 && deleteData.success, 'Deactivated catalog title with no active issues');

    // 25. Delete Book with Active Reservation (Safeguard Blocks)
    const blockedDelete = await fetch(`${BASE_URL}/library/books/${book2Id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    assert(blockedDelete.status === 400, 'Safeguard blocked deactivating book with active reservation');
  }

  console.log('\n--- Phase 10: Cleanup & Teardown ---');
  {
    await LibraryRecord.deleteMany({ collegeId: college._id });
    await Book.deleteMany({ collegeId: college._id });
    await User.deleteMany({ _id: { $in: [admin._id, student._id, student2._id] } });
    console.log(' Cleaned up test database records.');
  }

  console.log(`\n============================================================`);
  console.log(` RESULTS: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log(`============================================================\n`);

  server.close();
  await mongoose.disconnect();

  if (passed !== total) {
    process.exit(1);
  }
}

runLibraryTests().catch(err => {
  console.error('Library test error:', err);
  if (server) server.close();
  mongoose.disconnect().finally(() => process.exit(1));
});
