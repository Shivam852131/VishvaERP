const asyncHandler = require('../middleware/asyncHandler');
const { Book, LibraryRecord } = require('../models/Library');
const User = require('../models/User');
const { logAudit } = require('../services/auditService');
const { emitDataChange } = require('../utils/realtime');

// --- BOOK MANAGEMENT ---
const addBook = asyncHandler(async (req, res) => {
  const { title, author, isbn, barcode, publisher, edition, category, subject, totalCopies, location, description } = req.body;
  if (!title || !author) return res.status(400).json({ success: false, message: 'Title and author are required' });

  const book = await Book.create({
    collegeId: req.user.collegeId,
    title: title.trim(),
    author: author.trim(),
    isbn: isbn ? isbn.trim() : undefined,
    barcode: barcode ? barcode.trim() : undefined,
    publisher,
    edition,
    category: category || 'General',
    subject,
    totalCopies: Number(totalCopies) || 1,
    availableCopies: Number(totalCopies) || 1,
    location,
    description,
  });

  logAudit(req, 'create', 'library-book', { resourceId: book._id, description: `Cataloged book: ${book.title}` });
  emitDataChange(req, { collegeId: String(req.user.collegeId), roles: ['student', 'faculty'], resource: 'library', action: 'created' });
  res.status(201).json({ success: true, book, data: book });
});

const getBooks = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, category, subject } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };
  if (category && category !== 'all') query.category = category;
  if (subject) query.subject = { $regex: subject, $options: 'i' };
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { author: { $regex: search, $options: 'i' } },
      { isbn: { $regex: search, $options: 'i' } },
      { barcode: { $regex: search, $options: 'i' } },
      { subject: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [books, total] = await Promise.all([
    Book.find(query).sort({ title: 1 }).skip(skip).limit(Number(limit)),
    Book.countDocuments(query),
  ]);

  res.json({
    success: true,
    books,
    data: books,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit))
  });
});

const getBookById = asyncHandler(async (req, res) => {
  const book = await Book.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  res.json({ success: true, book, data: book });
});

const getBookByISBN = asyncHandler(async (req, res) => {
  const { isbn } = req.params;
  const book = await Book.findOne({
    collegeId: req.user.collegeId,
    isActive: true,
    $or: [{ isbn: isbn.trim() }, { barcode: isbn.trim() }]
  });
  if (!book) return res.status(404).json({ success: false, message: `Book with identifier ${isbn} not found` });
  res.json({ success: true, book, data: book });
});

const updateBook = asyncHandler(async (req, res) => {
  const book = await Book.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body,
    { new: true, runValidators: true }
  );
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  logAudit(req, 'update', 'library-book', { resourceId: book._id, description: `Updated book: ${book.title}` });
  res.json({ success: true, book, data: book });
});

const deleteBook = asyncHandler(async (req, res) => {
  const book = await Book.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  const activeIssues = await LibraryRecord.countDocuments({ bookId: book._id, status: { $in: ['issued', 'overdue', 'reserved'] } });
  if (activeIssues > 0) {
    return res.status(400).json({ success: false, message: `Cannot delete: ${activeIssues} active loan/reservation(s) exist` });
  }
  book.isActive = false;
  await book.save();
  logAudit(req, 'delete', 'library-book', { resourceId: book._id, description: `Deactivated book: ${book.title}` });
  res.json({ success: true, message: 'Book deactivated' });
});

// --- ISSUE / RETURN / RENEW / RESERVE ---
const issueBook = asyncHandler(async (req, res) => {
  const bookId = req.params.id || req.body.bookId || req.body.id;
  const { userId, rollNo, dueDays = 14 } = req.body;
  if (!bookId) return res.status(400).json({ success: false, message: 'bookId is required' });

  let targetUserId = userId;
  if (req.user.role === 'student') {
    targetUserId = req.user._id;
  } else if (rollNo) {
    const student = await User.findOne({ rollNo: rollNo.trim(), collegeId: req.user.collegeId });
    if (!student) return res.status(404).json({ success: false, message: `Student with roll number "${rollNo}" not found` });
    targetUserId = student._id;
  }

  if (!targetUserId) return res.status(400).json({ success: false, message: 'Student / User is required' });

  const book = await Book.findOne({ _id: bookId, collegeId: req.user.collegeId, isActive: true });
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  if (book.availableCopies <= 0) return res.status(400).json({ success: false, message: 'No copies available for issue' });

  const student = await User.findOne({ _id: targetUserId, collegeId: req.user.collegeId }).select('name rollNo email department');
  if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

  const activeIssue = await LibraryRecord.findOne({ bookId: book._id, userId: targetUserId, status: { $in: ['issued', 'overdue', 'reserved'] } });
  if (activeIssue) return res.status(400).json({ success: false, message: 'Student already has this book issued or reserved' });

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + parseInt(dueDays));

  const record = await LibraryRecord.create({
    collegeId: req.user.collegeId,
    bookId: book._id,
    userId: targetUserId,
    issuedDate: new Date(),
    dueDate,
    status: 'issued',
  });

  book.availableCopies = Math.max(0, book.availableCopies - 1);
  await book.save();

  const populated = await LibraryRecord.findById(record._id)
    .populate('bookId', 'title author isbn category location')
    .populate('userId', 'name rollNo email department');

  logAudit(req, 'create', 'library-issue', { resourceId: record._id, description: `Issued "${book.title}" to ${student.name}` });
  res.status(201).json({
    success: true,
    message: `"${book.title}" successfully issued to ${student.name}`,
    record: populated,
    data: populated
  });
});

const reserveBook = asyncHandler(async (req, res) => {
  const bookId = req.params.id || req.body.bookId || req.body.id;
  if (!bookId) return res.status(400).json({ success: false, message: 'bookId is required' });

  const book = await Book.findOne({ _id: bookId, collegeId: req.user.collegeId, isActive: true });
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });

  const active = await LibraryRecord.findOne({ bookId: book._id, userId: req.user._id, status: { $in: ['issued', 'reserved', 'overdue'] } });
  if (active) return res.status(400).json({ success: false, message: 'You already have an active loan or reservation for this book' });

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7); // 7 days hold

  const record = await LibraryRecord.create({
    collegeId: req.user.collegeId,
    bookId: book._id,
    userId: req.user._id,
    issuedDate: new Date(),
    dueDate,
    status: 'reserved',
    remarks: 'Student self-reservation hold',
  });

  if (book.availableCopies > 0) {
    book.availableCopies -= 1;
    await book.save();
  }

  const populated = await LibraryRecord.findById(record._id)
    .populate('bookId', 'title author isbn category location')
    .populate('userId', 'name rollNo email department');

  logAudit(req, 'create', 'library-reservation', { resourceId: record._id, description: `Reserved book: ${book.title}` });
  res.status(201).json({
    success: true,
    message: `"${book.title}" successfully reserved`,
    record: populated,
    data: populated
  });
});

const renewBook = asyncHandler(async (req, res) => {
  const recordId = req.params.id || req.body.recordId || req.body.id;
  if (!recordId) return res.status(400).json({ success: false, message: 'Loan record ID is required' });

  const query = { _id: recordId, collegeId: req.user.collegeId };
  if (req.user.role === 'student') query.userId = req.user._id;

  const record = await LibraryRecord.findOne(query).populate('bookId', 'title');
  if (!record) return res.status(404).json({ success: false, message: 'Issue record not found' });
  if (record.status === 'returned') return res.status(400).json({ success: false, message: 'Book is already returned' });

  // Extend due date by 14 days
  const baseDate = new Date() > record.dueDate ? new Date() : record.dueDate;
  const newDueDate = new Date(baseDate);
  newDueDate.setDate(newDueDate.getDate() + 14);

  record.dueDate = newDueDate;
  record.renewalCount = (record.renewalCount || 0) + 1;
  if (record.status === 'overdue') record.status = 'issued';
  await record.save();

  logAudit(req, 'update', 'library-renew', { resourceId: record._id, description: `Renewed loan for: ${record.bookId?.title || 'Book'}` });
  res.json({ success: true, message: 'Book loan renewed for 14 days', record, data: record });
});

const returnBook = asyncHandler(async (req, res) => {
  const recordId = req.params.id || req.body.recordId || req.body.id;
  if (!recordId) return res.status(400).json({ success: false, message: 'Loan record ID is required' });

  const record = await LibraryRecord.findOne({ _id: recordId, collegeId: req.user.collegeId }).populate('bookId', 'title');
  if (!record) return res.status(404).json({ success: false, message: 'Issue record not found' });
  if (record.status === 'returned') return res.status(400).json({ success: false, message: 'Book already returned' });

  record.returnDate = new Date();
  record.status = 'returned';
  if (record.returnDate > record.dueDate) {
    const daysLate = Math.ceil((record.returnDate - record.dueDate) / (1000 * 60 * 60 * 24));
    record.fine = daysLate * 10;
  }
  await record.save();

  await Book.findByIdAndUpdate(record.bookId, { $inc: { availableCopies: 1 } });
  logAudit(req, 'update', 'library-return', { resourceId: record._id, description: `Returned book: ${record.bookId?.title || 'Book'}. Fine: ₹${record.fine || 0}` });
  res.json({
    success: true,
    message: record.fine > 0 ? `Returned. Overdue Fine: ₹${record.fine}` : 'Returned successfully',
    record,
    data: record
  });
});

const payFine = asyncHandler(async (req, res) => {
  const recordId = req.params.id || req.body.recordId || req.body.id;
  const query = { _id: recordId, collegeId: req.user.collegeId };
  if (req.user.role === 'student') query.userId = req.user._id;

  const record = await LibraryRecord.findOne(query);
  if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
  if (!record.fine || record.fine <= 0) return res.status(400).json({ success: false, message: 'No fine pending on this loan' });

  record.finePaid = true;
  await record.save();
  logAudit(req, 'update', 'library-fine-paid', { resourceId: record._id, description: `Fine of ₹${record.fine} paid` });
  res.json({ success: true, message: `Fine of ₹${record.fine} marked as paid`, record, data: record });
});

const scanOverdue = asyncHandler(async (req, res) => {
  const now = new Date();
  const overdueRecords = await LibraryRecord.find({
    collegeId: req.user.collegeId,
    status: 'issued',
    dueDate: { $lt: now },
  });

  let updatedCount = 0;
  for (const record of overdueRecords) {
    const daysLate = Math.ceil((now - record.dueDate) / (1000 * 60 * 60 * 24));
    record.status = 'overdue';
    record.fine = daysLate * 10;
    await record.save();
    updatedCount++;
  }

  res.json({ success: true, message: `Overdue scan complete. Updated ${updatedCount} records`, updatedCount });
});

const getIssueRecords = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, status, userId, bookId } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (status) query.status = status;
  if (userId) query.userId = userId;
  if (bookId) query.bookId = bookId;

  const skip = (Number(page) - 1) * Number(limit);
  const [records, total] = await Promise.all([
    LibraryRecord.find(query)
      .populate('bookId', 'title author isbn category location barcode')
      .populate('userId', 'name rollNo email department')
      .sort({ issuedDate: -1 })
      .skip(skip)
      .limit(Number(limit)),
    LibraryRecord.countDocuments(query),
  ]);

  res.json({
    success: true,
    records,
    data: records,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit))
  });
});

const getMyIssues = asyncHandler(async (req, res) => {
  const records = await LibraryRecord.find({ userId: req.user._id, collegeId: req.user.collegeId })
    .populate('bookId', 'title author isbn category location barcode')
    .sort({ issuedDate: -1 });

  // Auto calculate fine for overdue items if still issued
  const now = new Date();
  const enriched = records.map(r => {
    const obj = r.toObject();
    if ((obj.status === 'issued' || obj.status === 'overdue') && new Date(obj.dueDate) < now) {
      const daysLate = Math.ceil((now - new Date(obj.dueDate)) / (1000 * 60 * 60 * 24));
      obj.fine = daysLate * 10;
      obj.isOverdue = true;
    }
    return obj;
  });

  res.json({ success: true, records: enriched, data: enriched });
});

const getLibraryStats = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const [totalBooks, availableCopies, issuedCount, overdueCount, fineSum, reservedCount] = await Promise.all([
    Book.countDocuments({ collegeId, isActive: true }),
    Book.aggregate([
      { $match: { collegeId: collegeId, isActive: true } },
      { $group: { _id: null, total: { $sum: '$availableCopies' } } },
    ]),
    LibraryRecord.countDocuments({ collegeId, status: 'issued' }),
    LibraryRecord.countDocuments({ collegeId, status: 'overdue' }),
    LibraryRecord.aggregate([
      { $match: { collegeId, status: { $in: ['returned', 'overdue'] } } },
      { $group: { _id: null, total: { $sum: '$fine' } } },
    ]),
    LibraryRecord.countDocuments({ collegeId, status: 'reserved' }),
  ]);

  const stats = {
    totalBooks,
    availableCopies: availableCopies[0]?.total || 0,
    currentlyIssued: issuedCount,
    overdue: overdueCount,
    reserved: reservedCount,
    totalFineCollected: fineSum[0]?.total || 0,
  };

  // If student requests, enrich with personal loan statistics
  if (req.user.role === 'student') {
    const studentIssues = await LibraryRecord.find({ collegeId, userId: req.user._id });
    const now = new Date();
    stats.myIssued = studentIssues.filter(r => r.status === 'issued' || r.status === 'overdue').length;
    stats.myOverdue = studentIssues.filter(r => (r.status === 'overdue') || (r.status === 'issued' && new Date(r.dueDate) < now)).length;
    stats.myReserved = studentIssues.filter(r => r.status === 'reserved').length;
    stats.myFines = studentIssues.reduce((acc, r) => acc + (r.fine || 0), 0);
  }

  res.json({
    success: true,
    stats,
    data: stats,
  });
});

const exportLibraryReport = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const books = await Book.find({ collegeId, isActive: true }).sort({ title: 1 });

  let csv = 'Book ID,Title,Author,ISBN,Barcode,Category,Subject,Location / Shelf,Total Copies,Available Copies,Currently Issued\n';
  const clean = (str) => `"${String(str || '').replace(/"/g, '""')}"`;

  books.forEach(b => {
    const issued = (b.totalCopies || 1) - (b.availableCopies !== undefined ? b.availableCopies : 1);
    csv += [
      clean(b._id),
      clean(b.title),
      clean(b.author),
      clean(b.isbn || 'N/A'),
      clean(b.barcode || 'N/A'),
      clean(b.category || 'General'),
      clean(b.subject || 'N/A'),
      clean(b.location || 'Main Stack'),
      b.totalCopies || 1,
      b.availableCopies !== undefined ? b.availableCopies : 1,
      Math.max(0, issued)
    ].join(',') + '\n';
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=library-catalog-${new Date().toISOString().slice(0, 10)}.csv`);
  res.status(200).send(csv);
});

module.exports = {
  addBook,
  getBooks,
  getBookById,
  getBookByISBN,
  updateBook,
  deleteBook,
  issueBook,
  reserveBook,
  renewBook,
  returnBook,
  payFine,
  scanOverdue,
  getIssueRecords,
  getMyIssues,
  getLibraryStats,
  exportLibraryReport,
};
