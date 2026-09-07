const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true },
  parentCommentId: { type: mongoose.Schema.Types.ObjectId },
  upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isEdited: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

const noteSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  semester: { type: Number, required: true },
  department: { type: String },
  attachments: [{ type: String }],
  downloads: { type: Number, default: 0 },
  tags: [{ type: String, trim: true }],
  upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  downvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  voteScore: { type: Number, default: 0 },
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  bookmarkCount: { type: Number, default: 0 },
  comments: [commentSchema],
  commentCount: { type: Number, default: 0 },
  avgRating: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
  ratings: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    score: { type: Number, min: 1, max: 5 },
  }],
  viewCount: { type: Number, default: 0 },
  isFeatured: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

noteSchema.index({ collegeId: 1, createdAt: -1 });
noteSchema.index({ collegeId: 1, subjectId: 1 });
noteSchema.index({ collegeId: 1, courseId: 1, semester: 1 });
noteSchema.index({ collegeId: 1, voteScore: -1 });
noteSchema.index({ collegeId: 1, title: 'text', description: 'text', tags: 'text' });

noteSchema.pre('save', function(next) {
  this.voteScore = (this.upvotes || []).length - (this.downvotes || []).length;
  this.bookmarkCount = (this.bookmarks || []).length;
  this.commentCount = (this.comments || []).filter(c => !c.isDeleted).length;
  if (this.ratings && this.ratings.length > 0) {
    this.avgRating = Math.round((this.ratings.reduce((s, r) => s + r.score, 0) / this.ratings.length) * 10) / 10;
    this.ratingCount = this.ratings.length;
  }
  next();
});

module.exports = mongoose.model('Note', noteSchema);
