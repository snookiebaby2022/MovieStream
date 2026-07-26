const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 32 },
  email:    { type: String, trim: true, lowercase: true, default: '' },
  passHash: { type: String, required: true },
  watchlist: [{
    tmdbId: Number, type: { type: String, enum: ['movie', 'tv'] },
    title: String, poster: String, year: String, rating: Number, addedAt: { type: Date, default: Date.now }
  }],
  history: [{
    tmdbId: Number, type: { type: String, enum: ['movie', 'tv'] },
    title: String, poster: String, year: String,
    season: Number, episode: Number,
    at: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const CommentSchema = new mongoose.Schema({
  tmdbId:   { type: Number, required: true, index: true },
  mediaType:{ type: String, enum: ['movie', 'tv'], required: true },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  text:     { type: String, required: true, maxlength: 1000 },
  createdAt:{ type: Date, default: Date.now }
});

const RatingSchema = new mongoose.Schema({
  tmdbId:   { type: Number, required: true },
  mediaType:{ type: String, enum: ['movie', 'tv'], required: true },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  score:    { type: Number, min: 1, max: 10, required: true },
  createdAt:{ type: Date, default: Date.now }
});
RatingSchema.index({ tmdbId: 1, mediaType: 1, userId: 1 }, { unique: true });

module.exports = {
  User: mongoose.models.User || mongoose.model('User', UserSchema),
  Comment: mongoose.models.Comment || mongoose.model('Comment', CommentSchema),
  Rating: mongoose.models.Rating || mongoose.model('Rating', RatingSchema)
};
