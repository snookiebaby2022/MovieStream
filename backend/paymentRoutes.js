/**
 * FlixNova Premium — £1/month Stripe subscription + launch promo (lifetime unlock).
 * 48h watch trial starts on first play (browse after signup is free).
 */
const express = require('express');
const { User, Promo } = require('./models');
const { authRequired, authOptional } = require('./authRoutes');
const {
  isEntitled,
  entitlementPayload,
  ensureTrialClock,
  isLifetime,
  startWatchTrial
} = require('./entitlement');

const router = express.Router();
const PRICE_PENCE = Math.max(100, parseInt(process.env.ADFREE_PRICE_PENCE || '100', 10) || 100);
const CURRENCY = (process.env.ADFREE_CURRENCY || 'gbp').toLowerCase();
const STRIPE_PRICE_ID = (process.env.STRIPE_PRICE_ID || '').trim();
const FIRST10_KEY = 'first10';
const FIRST10_LIMIT = Math.max(1, parseInt(process.env.FIRST10_PROMO_LIMIT || '10', 10) || 10);
const FIRST10_ENABLED = String(process.env.FIRST10_PROMO_ENABLED || '1') !== '0';

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) return null;
  const Stripe = require('stripe');
  return new Stripe(key);
}

function siteUrl() {
  return (process.env.SITE_URL || 'https://snookiebaby.xyz').replace(/\/$/, '');
}

function dbReady(res) {
  if (require('mongoose').connection.readyState !== 1) {
    res.status(503).json({ success: false, error: 'Database unavailable' });
    return false;
  }
  return true;
}

async function getFirst10Promo(userId) {
  const envOn = FIRST10_ENABLED;
  if (!envOn || require('mongoose').connection.readyState !== 1) {
    return {
      key: FIRST10_KEY,
      enabled: false,
      active: false,
      limit: FIRST10_LIMIT,
      claimed: 0,
      remaining: 0,
      alreadyClaimed: false
    };
  }
  await Promo.updateOne(
    { key: FIRST10_KEY },
    { $setOnInsert: { key: FIRST10_KEY, limit: FIRST10_LIMIT, claimed: 0, claims: [], enabled: true } },
    { upsert: true }
  );
  const promo = await Promo.findOne({ key: FIRST10_KEY }).lean();
  const dbEnabled = promo?.enabled !== false;
  const limit = Math.max(1, promo?.limit || FIRST10_LIMIT);
  const claimed = Math.min(limit, Math.max(0, promo?.claimed || 0));
  const remaining = Math.max(0, limit - claimed);
  let alreadyClaimed = false;
  if (userId) {
    const u = await User.findById(userId).select('promoClaim lifetimeUnlock adFree').lean();
    alreadyClaimed = u?.promoClaim === FIRST10_KEY;
  }
  return {
    key: FIRST10_KEY,
    enabled: dbEnabled,
    active: dbEnabled && remaining > 0,
    limit,
    claimed,
    remaining,
    alreadyClaimed,
    claims: (promo?.claims || []).slice(-20).reverse()
  };
}

async function applySubscriptionToUser(userId, fields) {
  if (!userId) return null;
  const update = { ...fields };
  const status = String(fields.subscriptionStatus || '').toLowerCase();
  if (status === 'active' || status === 'trialing') {
    update.adFree = true;
    update.adFreeAt = fields.adFreeAt || new Date();
  } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(status)) {
    const u = await User.findById(userId).select('lifetimeUnlock promoClaim adFree stripeSubscriptionId');
    if (u && !isLifetime(u)) {
      update.adFree = false;
    }
  }
  return User.findByIdAndUpdate(userId, update, { new: true });
}

router.get('/status', authOptional, async (req, res) => {
  const configured = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_'));
  let ent = {
    entitled: false,
    adFree: false,
    trialActive: false,
    trialEndsAt: null,
    needsPay: true,
    subscriptionStatus: '',
    lifetimeUnlock: false
  };
  if (req.user) {
    try {
      if (require('mongoose').connection.readyState === 1) {
        let u = await User.findById(req.user.id);
        if (u) {
          u = await ensureTrialClock(u);
          ent = entitlementPayload(u);
        }
      }
    } catch {}
  }
  const promo = await getFirst10Promo(req.user?.id).catch(() => null);
  res.json({
    success: true,
    configured,
    mode: 'subscription',
    adFree: ent.adFree,
    entitled: ent.entitled,
    trialActive: ent.trialActive,
    trialEndsAt: ent.trialEndsAt,
    trialStarted: ent.trialStarted,
    trialExpired: ent.trialExpired,
    canStartTrial: ent.canStartTrial,
    trialHours: ent.trialHours,
    needsPay: ent.needsPay,
    subscriptionStatus: ent.subscriptionStatus,
    lifetimeUnlock: ent.lifetimeUnlock,
    price: PRICE_PENCE,
    currency: CURRENCY,
    label: `£${(PRICE_PENCE / 100).toFixed(2)}/mo`,
    interval: 'month',
    priceIdConfigured: !!STRIPE_PRICE_ID,
    promo: promo || undefined
  });
});

/** Start 48h watch trial on first play. Browse-only accounts use this when they hit Play. */
router.post('/start-trial', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    let user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: 'Login required' });
    const before = entitlementPayload(user);
    if (before.entitled) {
      return res.json({ success: true, started: false, already: true, ...before });
    }
    if (before.trialExpired || before.trialStarted) {
      return res.status(403).json({
        success: false,
        error: 'Your free trial has ended. Subscribe for £1/month to keep watching.',
        code: 'TRIAL_ENDED',
        ...before
      });
    }
    const result = await startWatchTrial(user);
    const ent = entitlementPayload(result.user);
    res.json({
      success: true,
      started: !!result.started,
      message: result.started
        ? 'Your 48-hour free trial has started — enjoy premium streams!'
        : 'Trial status updated',
      ...ent
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/promo', authOptional, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const promo = await getFirst10Promo(req.user?.id);
    res.json({ success: true, data: promo });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Claim launch offer: first N customers get lifetime Premium free. */
router.post('/promo/claim', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    if (!FIRST10_ENABLED) {
      return res.status(410).json({ success: false, error: 'This offer is no longer available', code: 'PROMO_OFF' });
    }

    await Promo.updateOne(
      { key: FIRST10_KEY },
      { $setOnInsert: { key: FIRST10_KEY, limit: FIRST10_LIMIT, claimed: 0, claims: [], enabled: true } },
      { upsert: true }
    );
    const promoState = await Promo.findOne({ key: FIRST10_KEY }).lean();
    if (promoState?.enabled === false) {
      return res.status(410).json({ success: false, error: 'This offer is no longer available', code: 'PROMO_OFF' });
    }
    const limit = Math.max(1, promoState?.limit || FIRST10_LIMIT);

    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: 'Login required' });
    if (isLifetime(user) || isEntitled(user)) {
      const ent = entitlementPayload(user);
      return res.json({
        success: true,
        adFree: true,
        entitled: true,
        already: true,
        message: ent.lifetimeUnlock
          ? 'You already have lifetime Premium on this account'
          : 'You already have Premium access on this account'
      });
    }
    if (user.promoClaim === FIRST10_KEY) {
      return res.json({
        success: true,
        adFree: true,
        entitled: true,
        already: true,
        message: 'You already claimed this offer'
      });
    }

    const promo = await Promo.findOneAndUpdate(
      { key: FIRST10_KEY, claimed: { $lt: limit }, enabled: { $ne: false } },
      {
        $inc: { claimed: 1 },
        $push: {
          claims: {
            userId: String(user._id),
            username: user.username,
            at: new Date()
          }
        },
        $set: { updatedAt: new Date(), limit }
      },
      { new: true }
    );

    if (!promo) {
      const cur = await getFirst10Promo(user._id);
      return res.status(410).json({
        success: false,
        error: 'Sorry — all free Premium spots are taken. You can still subscribe for £1/month.',
        code: 'PROMO_SOLD_OUT',
        promo: cur
      });
    }

    user.adFree = true;
    user.adFreeAt = new Date();
    user.lifetimeUnlock = true;
    user.promoClaim = FIRST10_KEY;
    await user.save();

    console.log('First10 promo claimed by', user.username, `(${promo.claimed}/${limit})`);
    res.json({
      success: true,
      adFree: true,
      entitled: true,
      lifetimeUnlock: true,
      promoClaim: FIRST10_KEY,
      remaining: Math.max(0, limit - promo.claimed),
      claimed: promo.claimed,
      limit,
      message: `You're in! Free lifetime Premium unlocked (${promo.claimed} of ${limit} claimed).`
    });
  } catch (e) {
    console.error('Promo claim:', e.message);
    res.status(500).json({ success: false, error: e.message || 'Claim failed' });
  }
});

router.post('/checkout', authOptional, async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) {
      return res.status(503).json({
        success: false,
        error: 'Payments not configured. Set STRIPE_SECRET_KEY on the server.'
      });
    }
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: 'Sign in before checkout so Premium is linked to your account.',
        code: 'LOGIN_REQUIRED'
      });
    }
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const meta = {
      product: 'premium',
      userId: req.user.id,
      username: req.user.username || ''
    };

    const lineItems = STRIPE_PRICE_ID
      ? [{ price: STRIPE_PRICE_ID, quantity: 1 }]
      : [{
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: PRICE_PENCE,
            recurring: { interval: 'month' },
            product_data: {
              name: 'FlixNova Premium',
              description: 'Monthly access — premium debrid streams and no FlixNova ads.'
            }
          }
        }];

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: `${siteUrl()}/?adfree=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/?adfree=cancel`,
      customer_email: email || undefined,
      client_reference_id: req.user.id,
      metadata: meta,
      subscription_data: {
        metadata: meta
      }
    });
    res.json({ success: true, url: session.url, sessionId: session.id });
  } catch (e) {
    console.error('Stripe checkout:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Confirm Checkout session after redirect */
router.get('/confirm', authOptional, async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) return res.status(503).json({ success: false, error: 'Stripe not configured' });
    const sessionId = String(req.query.session_id || '').trim();
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id required' });
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription']
    });
    if (session.status !== 'complete' && session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return res.status(402).json({ success: false, error: 'Checkout not completed' });
    }
    const product = session.metadata?.product || '';
    if (session.mode !== 'subscription' && product !== 'premium' && product !== 'adfree') {
      return res.status(400).json({ success: false, error: 'Invalid session' });
    }
    const userId = session.client_reference_id || session.metadata?.userId || '';
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'This payment is not linked to an account. Sign in before checkout next time.'
      });
    }
    if (req.user?.id && String(req.user.id) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'Payment belongs to a different account' });
    }
    if (!dbReady(res)) return;

    const sub = session.subscription;
    const subId = typeof sub === 'string' ? sub : sub?.id;
    const subStatus = (typeof sub === 'object' && sub?.status) || 'active';
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

    await applySubscriptionToUser(userId, {
      adFree: true,
      adFreeAt: new Date(),
      stripeSessionId: sessionId,
      stripeCustomerId: customerId || '',
      stripeSubscriptionId: subId || '',
      subscriptionStatus: subStatus
    });

    res.json({
      success: true,
      adFree: true,
      entitled: true,
      linkedAccount: true,
      message: 'Premium subscribed — thanks!'
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Stripe Customer Portal — cancel / update payment method */
router.post('/portal', authRequired, async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) return res.status(503).json({ success: false, error: 'Stripe not configured' });
    if (!dbReady(res)) return;
    const user = await User.findById(req.user.id).select('stripeCustomerId');
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ success: false, error: 'No Stripe customer on this account' });
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: siteUrl() + '/'
    });
    res.json({ success: true, url: portal.url });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

async function syncSubscriptionObject(sub) {
  if (!sub?.id) return;
  const userId = sub.metadata?.userId || '';
  let user = null;
  if (userId) {
    user = await User.findById(userId);
  }
  if (!user && sub.customer) {
    user = await User.findOne({ stripeCustomerId: String(sub.customer) });
  }
  if (!user) {
    console.warn('Stripe sub sync: no user for', sub.id);
    return;
  }
  const status = String(sub.status || '').toLowerCase();
  const entitled = status === 'active' || status === 'trialing';
  user.stripeSubscriptionId = sub.id;
  if (sub.customer) user.stripeCustomerId = String(sub.customer);
  user.subscriptionStatus = status;
  if (entitled) {
    user.adFree = true;
    user.adFreeAt = user.adFreeAt || new Date();
  } else if (!isLifetime(user)) {
    user.adFree = false;
  }
  await user.save();
  console.log('Subscription synced', user.username || user._id, status);
}

async function handleWebhook(req, res) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!stripe) return res.status(503).send('Stripe not configured');
  if (!secret) {
    console.error('Stripe webhook rejected: STRIPE_WEBHOOK_SECRET not set');
    return res.status(503).send('Webhook secret not configured');
  }
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Stripe webhook signature:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'subscription' || session.metadata?.product === 'premium' || session.metadata?.product === 'adfree') {
        const userId = session.client_reference_id || session.metadata?.userId;
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (userId) {
          let status = 'active';
          if (subId) {
            try {
              const sub = await stripe.subscriptions.retrieve(subId);
              status = sub.status || status;
              await syncSubscriptionObject({ ...sub, metadata: { ...sub.metadata, userId } });
            } catch {
              await applySubscriptionToUser(userId, {
                adFree: true,
                adFreeAt: new Date(),
                stripeSessionId: session.id,
                stripeCustomerId: customerId || '',
                stripeSubscriptionId: subId || '',
                subscriptionStatus: status
              });
            }
          } else {
            await applySubscriptionToUser(userId, {
              adFree: true,
              adFreeAt: new Date(),
              stripeSessionId: session.id,
              stripeCustomerId: customerId || '',
              subscriptionStatus: status
            });
          }
          console.log('Premium checkout completed for user', userId);
        }
      }
    } else if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted' ||
      event.type === 'customer.subscription.created'
    ) {
      await syncSubscriptionObject(event.data.object);
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const inv = event.data.object;
      const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncSubscriptionObject(sub);
        } catch (e) {
          console.warn('Invoice sync:', e.message);
        }
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Webhook handler:', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { router, handleWebhook, PRICE_PENCE, CURRENCY };
