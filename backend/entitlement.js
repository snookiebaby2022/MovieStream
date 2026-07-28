/**
 * Premium entitlement: lifetime unlock, active Stripe subscription, or 48h watch trial.
 * Trial starts on first watch attempt — browsing after signup does not burn the trial.
 */
const TRIAL_MS = 48 * 60 * 60 * 1000;

function trialEndsFrom(date = new Date()) {
  return new Date(new Date(date).getTime() + TRIAL_MS);
}

/** Lifetime = Ad-Free without a Stripe subscription (promo / grandfathered one-time). */
function isLifetime(user) {
  if (!user) return false;
  if (user.lifetimeUnlock) return true;
  return !!(user.adFree && !user.stripeSubscriptionId);
}

function subscriptionActive(user) {
  const s = String(user?.subscriptionStatus || '').toLowerCase();
  return s === 'active' || s === 'trialing';
}

function trialActive(user) {
  if (!user?.trialEndsAt) return false;
  return new Date(user.trialEndsAt).getTime() > Date.now();
}

/** Trial was started at some point and has now ended */
function trialExpired(user) {
  if (!user?.trialEndsAt) return false;
  return new Date(user.trialEndsAt).getTime() <= Date.now();
}

function isEntitled(user) {
  if (!user) return false;
  if (isLifetime(user)) return true;
  if (subscriptionActive(user)) return true;
  if (trialActive(user)) return true;
  return false;
}

function entitlementPayload(user) {
  const entitled = isEntitled(user);
  const trial = trialActive(user);
  const lifetime = isLifetime(user);
  const sub = subscriptionActive(user);
  const expired = trialExpired(user) && !lifetime && !sub;
  return {
    entitled,
    /** Back-compat: clients treat adFree as “can use premium streams” */
    adFree: entitled,
    lifetimeUnlock: lifetime,
    trialActive: trial && !lifetime && !sub,
    trialEndsAt: user?.trialEndsAt || null,
    trialStarted: !!user?.trialEndsAt,
    trialExpired: expired,
    trialHours: Math.round(TRIAL_MS / 3600000),
    subscriptionStatus: user?.subscriptionStatus || '',
    needsPay: !entitled,
    canStartTrial: !entitled && !user?.trialEndsAt && !lifetime && !sub
  };
}

/**
 * Grandfather one-time Ad-Free buyers. Does NOT start the watch trial (browse stays free).
 */
async function ensureTrialClock(user) {
  if (!user) return user;
  if (user.adFree && !user.stripeSubscriptionId && !user.lifetimeUnlock) {
    user.lifetimeUnlock = true;
    try {
      await user.save();
    } catch (e) {
      console.warn('ensureTrialClock:', e.message);
    }
  }
  return user;
}

/**
 * Start the 48h watch trial on first play. No-op if already entitled / already started / expired.
 * Returns { user, started: boolean }
 */
async function startWatchTrial(user) {
  if (!user) return { user, started: false };
  user = await ensureTrialClock(user);
  if (isEntitled(user)) return { user, started: false };
  if (user.trialEndsAt) return { user, started: false }; // already used (active or expired)
  user.trialEndsAt = trialEndsFrom(new Date());
  try {
    await user.save();
    console.log('Watch trial started for', user.username || user._id, 'until', user.trialEndsAt.toISOString());
    return { user, started: true };
  } catch (e) {
    console.warn('startWatchTrial:', e.message);
    return { user, started: false };
  }
}

module.exports = {
  TRIAL_MS,
  trialEndsFrom,
  isLifetime,
  subscriptionActive,
  trialActive,
  trialExpired,
  isEntitled,
  entitlementPayload,
  ensureTrialClock,
  startWatchTrial
};
