const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  title: { type: String, required: true },
  author: { type: String, required: true },
  isbn: { type: String },
  barcode: { type: String },
  publisher: { type: String },
  edition: { type: String },
  category: { type: String },
  subject: { type: String },
  totalCopies: { type: Number, default: 1 },
  availableCopies: { type: Number, default: 1 },
  location: { type: String }, // shelf/rack
  coverImage: { type: String },
  description: { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

bookSchema.index({ collegeId: 1, isActive: 1 });
bookSchema.index({ collegeId: 1, isbn: 1 });
bookSchema.index({ collegeId: 1, category: 1 });

const libraryRecordSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  issuedDate: { type: Date, required: true, default: Date.now },
  dueDate: { type: Date, required: true },
  returnDate: { type: Date },
  renewalCount: { type: Number, default: 0 },
  status: { type: String, enum: ['issued', 'returned', 'overdue', 'lost', 'reserved'], default: 'issued' },
  fine: { type: Number, default: 0 },
  finePaid: { type: Boolean, default: false },
  remarks: { type: String },
}, { timestamps: true });

libraryRecordSchema.index({ collegeId: 1, userId: 1, status: 1 });
libraryRecordSchema.index({ collegeId: 1, bookId: 1, status: 1 });
libraryRecordSchema.index({ collegeId: 1, dueDate: 1 });

const Book = mongoose.model('Book', bookSchema);
const LibraryRecord = mongoose.model('LibraryRecord', libraryRecordSchema);

module.exports = { Book, LibraryRecord };
