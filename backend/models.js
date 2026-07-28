const mongoose = require('mongoose');

const ProfileSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true, maxlength: 24 },
  avatar: { type: String, default: '1' },
  kids: { type: Boolean, default: false },
  lang: { type: String, default: 'en' }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 32 },
  email: { type: String, trim: true, lowercase: true, default: '', index: true },
  passHash: { type: String, required: true },
  profiles: { type: [ProfileSchema], default: undefined },
  activeProfileId: { type: String, default: '' },
  resetToken: { type: String, default: '' },
  resetExpires: { type: Date, default: null },
  adFree: { type: Boolean, default: false },
  adFreeAt: { type: Date, default: null },
  /** Promo / grandfathered one-time unlock — never expires */
  lifetimeUnlock: { type: Boolean, default: false },
  /** 24h free premium access from signup (or first check for legacy free accounts) */
  trialEndsAt: { type: Date, default: null },
  stripeSessionId: { type: String, default: '' },
  stripeCustomerId: { type: String, default: '', index: true },
  stripeSubscriptionId: { type: String, default: '', index: true },
  /** active | trialing | past_due | canceled | unpaid | incomplete | … */
  subscriptionStatus: { type: String, default: '' },
  /** Set when user claims a launch promo (e.g. 'first10') */
  promoClaim: { type: String, default: '', index: true },
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
  tmdbId: { type: Number, required: true, index: true },
  mediaType: { type: String, enum: ['movie', 'tv'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  text: { type: String, required: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
});

const RatingSchema = new mongoose.Schema({
  tmdbId: { type: Number, required: true },
  mediaType: { type: String, enum: ['movie', 'tv'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  score: { type: Number, min: 1, max: 10, required: true },
  createdAt: { type: Date, default: Date.now }
});
RatingSchema.index({ tmdbId: 1, mediaType: 1, userId: 1 }, { unique: true });

const ProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  profileId: { type: String, default: '' },
  tmdbId: { type: Number, required: true },
  mediaType: { type: String, enum: ['movie', 'tv'], required: true },
  title: { type: String, default: '' },
  poster: { type: String, default: '' },
  backdrop: { type: String, default: '' },
  season: { type: Number, default: 0 },
  episode: { type: Number, default: 0 },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});
ProgressSchema.index({ userId: 1, profileId: 1, tmdbId: 1, mediaType: 1, season: 1, episode: 1 }, { unique: true });

const TitleRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  username: { type: String, default: 'guest' },
  title: { type: String, required: true, maxlength: 200 },
  mediaType: { type: String, enum: ['movie', 'tv', 'either'], default: 'either' },
  note: { type: String, default: '', maxlength: 500 },
  tmdbId: { type: Number, default: null },
  status: { type: String, enum: ['open', 'done', 'rejected'], default: 'open', index: true },
  adminNote: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const PlayEventSchema = new mongoose.Schema({
  tmdbId: { type: Number, required: true, index: true },
  mediaType: { type: String, enum: ['movie', 'tv'], required: true },
  title: { type: String, default: '' },
  season: { type: Number, default: 0 },
  episode: { type: Number, default: 0 },
  source: { type: String, enum: ['rd', 'embed', 'other'], default: 'other' },
  success: { type: Boolean, default: true },
  userId: { type: String, default: '' },
  at: { type: Date, default: Date.now, index: true }
});

const ContactMessageSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 80 },
  email: { type: String, required: true, maxlength: 120 },
  subject: { type: String, required: true, maxlength: 120 },
  message: { type: String, required: true, maxlength: 4000 },
  status: { type: String, enum: ['open', 'done'], default: 'open', index: true },
  createdAt: { type: Date, default: Date.now, index: true }
});

/** Launch / marketing promo counters (e.g. first 10 Ad-Free free) */
const PromoSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  limit: { type: Number, default: 10 },
  claimed: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true },
  claims: [{
    userId: { type: String, default: '' },
    username: { type: String, default: '' },
    at: { type: Date, default: Date.now }
  }],
  updatedAt: { type: Date, default: Date.now }
});

module.exports = {
  User: mongoose.models.User || mongoose.model('User', UserSchema),
  Comment: mongoose.models.Comment || mongoose.model('Comment', CommentSchema),
  Rating: mongoose.models.Rating || mongoose.model('Rating', RatingSchema),
  Progress: mongoose.models.Progress || mongoose.model('Progress', ProgressSchema),
  TitleRequest: mongoose.models.TitleRequest || mongoose.model('TitleRequest', TitleRequestSchema),
  PlayEvent: mongoose.models.PlayEvent || mongoose.model('PlayEvent', PlayEventSchema),
  ContactMessage: mongoose.models.ContactMessage || mongoose.model('ContactMessage', ContactMessageSchema),
  Promo: mongoose.models.Promo || mongoose.model('Promo', PromoSchema)
};
