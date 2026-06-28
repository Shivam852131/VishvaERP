const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  title: { type: String, required: true },
  author: { type: String, required: true },
  isbn: { type: String },
  publisher: { type: String },
  edition: { type: String },
  category: { type: String },
  subject: { type: String },
  totalCopies: { type: Number, default: 1 },
  availableCopies: { type: Number, default: 1 },
  location: { type: String }, // shelf/rack
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const libraryRecordSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  issuedDate: { type: Date, required: true, default: Date.now },
  dueDate: { type: Date, required: true },
  returnDate: { type: Date },
  status: { type: String, enum: ['issued', 'returned', 'overdue', 'lost'], default: 'issued' },
  fine: { type: Number, default: 0 },
}, { timestamps: true });

const Book = mongoose.model('Book', bookSchema);
const LibraryRecord = mongoose.model('LibraryRecord', libraryRecordSchema);

module.exports = { Book, LibraryRecord };
