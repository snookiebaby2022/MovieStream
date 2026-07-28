/**
 * Premium entitlement: lifetime unlock, active Stripe subscription, or 24h trial.
 */
const TRIAL_MS = 24 * 60 * 60 * 1000;

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
  return {
    entitled,
    /** Back-compat: clients treat adFree as “can use premium streams” */
    adFree: entitled,
    lifetimeUnlock: lifetime,
    trialActive: trial && !lifetime && !sub,
    trialEndsAt: user?.trialEndsAt || null,
    subscriptionStatus: user?.subscriptionStatus || '',
    needsPay: !entitled
  };
}

/**
 * Existing free accounts with no trial clock: grant one 24h window on first check after deploy.
 * Existing Ad-Free buyers without a subscription are grandfathered as lifetime.
 */
async function ensureTrialClock(user) {
  if (!user) return user;
  let dirty = false;
  if (user.adFree && !user.stripeSubscriptionId && !user.lifetimeUnlock) {
    user.lifetimeUnlock = true;
    dirty = true;
  }
  if (isLifetime(user) || subscriptionActive(user)) {
    if (dirty) {
      try { await user.save(); } catch (e) { console.warn('ensureTrialClock:', e.message); }
    }
    return user;
  }
  if (!user.trialEndsAt) {
    user.trialEndsAt = trialEndsFrom(new Date());
    dirty = true;
  }
  if (dirty) {
    try {
      await user.save();
    } catch (e) {
      console.warn('ensureTrialClock:', e.message);
    }
  }
  return user;
}

module.exports = {
  TRIAL_MS,
  trialEndsFrom,
  isLifetime,
  subscriptionActive,
  trialActive,
  isEntitled,
  entitlementPayload,
  ensureTrialClock
};
