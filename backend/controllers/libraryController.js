const asyncHandler = require('../middleware/asyncHandler');
const { Book, LibraryRecord } = require('../models/Library');
const User = require('../models/User');

// --- BOOK MANAGEMENT ---
const addBook = asyncHandler(async (req, res) => {
  const { title, author, isbn, publisher, edition, category, subject, totalCopies, location } = req.body;
  if (!title || !author) return res.status(400).json({ success: false, message: 'Title and author are required' });
  const book = await Book.create({
    collegeId: req.user.collegeId, title, author, isbn, publisher, edition,
    category, subject, totalCopies: totalCopies || 1,
    availableCopies: totalCopies || 1, location,
  });
  res.status(201).json({ success: true, book });
});

const getBooks = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, category, subject } = req.query;
  const query = { collegeId: req.user.collegeId, isActive: true };
  if (category) query.category = category;
  if (subject) query.subject = { $regex: subject, $options: 'i' };
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { author: { $regex: search, $options: 'i' } },
      { isbn: { $regex: search, $options: 'i' } },
    ];
  }
  const total = await Book.countDocuments(query);
  const books = await Book.find(query).sort({ title: 1 }).skip((page - 1) * limit).limit(parseInt(limit));
  res.json({ success: true, books, total, page: parseInt(page), pages: Math.ceil(total / limit) });
});

const getBookById = asyncHandler(async (req, res) => {
  const book = await Book.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  res.json({ success: true, book });
});

const updateBook = asyncHandler(async (req, res) => {
  const book = await Book.findOneAndUpdate(
    { _id: req.params.id, collegeId: req.user.collegeId },
    req.body, { new: true, runValidators: true }
  );
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  res.json({ success: true, book });
});

const deleteBook = asyncHandler(async (req, res) => {
  const book = await Book.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  const activeIssues = await LibraryRecord.countDocuments({ bookId: book._id, status: { $in: ['issued', 'overdue'] } });
  if (activeIssues > 0) return res.status(400).json({ success: false, message: `Cannot delete: ${activeIssues} active issue(s) exist` });
  book.isActive = false;
  await book.save();
  res.json({ success: true, message: 'Book deactivated' });
});

// --- ISSUE / RETURN ---
const issueBook = asyncHandler(async (req, res) => {
  const { bookId, userId, dueDays = 14 } = req.body;
  if (!bookId || !userId) return res.status(400).json({ success: false, message: 'bookId and userId required' });

  const book = await Book.findOne({ _id: bookId, collegeId: req.user.collegeId });
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  if (book.availableCopies <= 0) return res.status(400).json({ success: false, message: 'No copies available' });

  const student = await User.findOne({ _id: userId, collegeId: req.user.collegeId }).select('name');
  if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

  const activeIssue = await LibraryRecord.findOne({ bookId, userId, status: { $in: ['issued', 'overdue'] } });
  if (activeIssue) return res.status(400).json({ success: false, message: 'Student already has this book issued' });

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + parseInt(dueDays));

  const record = await LibraryRecord.create({
    collegeId: req.user.collegeId, bookId, userId,
    issuedDate: new Date(), dueDate, status: 'issued',
  });

  book.availableCopies -= 1;
  await book.save();

  res.status(201).json({ success: true, message: `${book.title} issued to ${student.name}`, record });
});

const returnBook = asyncHandler(async (req, res) => {
  const record = await LibraryRecord.findOne({ _id: req.params.id, collegeId: req.user.collegeId });
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

  res.json({ success: true, message: record.fine > 0 ? `Returned. Fine: ₹${record.fine}` : 'Returned successfully', record });
});

const getIssueRecords = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, userId, bookId, search } = req.query;
  const query = { collegeId: req.user.collegeId };
  if (status) query.status = status;
  if (userId) query.userId = userId;
  if (bookId) query.bookId = bookId;

  const total = await LibraryRecord.countDocuments(query);
  const records = await LibraryRecord.find(query)
    .populate('bookId', 'title author isbn')
    .populate('userId', 'name rollNo email')
    .sort({ issuedDate: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  res.json({ success: true, records, total, page: parseInt(page), pages: Math.ceil(total / limit) });
});

const getMyIssues = asyncHandler(async (req, res) => {
  const records = await LibraryRecord.find({ userId: req.user._id, collegeId: req.user.collegeId })
    .populate('bookId', 'title author isbn')
    .sort({ issuedDate: -1 });
  res.json({ success: true, records });
});

const getLibraryStats = asyncHandler(async (req, res) => {
  const collegeId = req.user.collegeId;
  const [totalBooks, availableCopies, issuedCount, overdueCount, fineSum] = await Promise.all([
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
  ]);

  res.json({
    success: true,
    stats: {
      totalBooks,
      availableCopies: availableCopies[0]?.total || 0,
      currentlyIssued: issuedCount,
      overdue: overdueCount,
      totalFineCollected: fineSum[0]?.total || 0,
    },
  });
});

module.exports = {
  addBook, getBooks, getBookById, updateBook, deleteBook,
  issueBook, returnBook, getIssueRecords, getMyIssues, getLibraryStats,
};
