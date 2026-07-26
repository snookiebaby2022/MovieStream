/**
 * One-time £1 "Remove ads" via Stripe Checkout.
 * Plus launch promo: first N sign-ups can claim Ad-Free free.
 */
const express = require('express');
const { User, Promo } = require('./models');
const { authRequired, authOptional, verifyToken } = require('./authRoutes');

const router = express.Router();
const PRICE_PENCE = Math.max(100, parseInt(process.env.ADFREE_PRICE_PENCE || '100', 10) || 100); // £1.00 default
const CURRENCY = (process.env.ADFREE_CURRENCY || 'gbp').toLowerCase();
const FIRST10_KEY = 'first10';
const FIRST10_LIMIT = Math.max(1, parseInt(process.env.FIRST10_PROMO_LIMIT || '10', 10) || 10);
const FIRST10_ENABLED = String(process.env.FIRST10_PROMO_ENABLED || '1') !== '0';

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) return null;
  // Lazy require
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
  const enabled = FIRST10_ENABLED;
  if (!enabled || require('mongoose').connection.readyState !== 1) {
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
    { $setOnInsert: { key: FIRST10_KEY, limit: FIRST10_LIMIT, claimed: 0, claims: [] } },
    { upsert: true }
  );
  const promo = await Promo.findOne({ key: FIRST10_KEY }).lean();
  const claimed = Math.min(FIRST10_LIMIT, Math.max(0, promo?.claimed || 0));
  const remaining = Math.max(0, FIRST10_LIMIT - claimed);
  let alreadyClaimed = false;
  if (userId) {
    const u = await User.findById(userId).select('promoClaim adFree').lean();
    alreadyClaimed = u?.promoClaim === FIRST10_KEY;
  }
  return {
    key: FIRST10_KEY,
    enabled: true,
    active: remaining > 0,
    limit: FIRST10_LIMIT,
    claimed,
    remaining,
    alreadyClaimed
  };
}

router.get('/status', authOptional, async (req, res) => {
  const configured = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_'));
  let adFree = false;
  if (req.user) {
    try {
      if (require('mongoose').connection.readyState === 1) {
        const u = await User.findById(req.user.id).select('adFree');
        adFree = !!u?.adFree;
      }
    } catch {}
  }
  const promo = await getFirst10Promo(req.user?.id).catch(() => null);
  res.json({
    success: true,
    configured,
    adFree,
    price: PRICE_PENCE,
    currency: CURRENCY,
    label: `£${(PRICE_PENCE / 100).toFixed(2)}`,
    promo: promo || undefined
  });
});

/** Public promo status (remaining slots) */
router.get('/promo', authOptional, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const promo = await getFirst10Promo(req.user?.id);
    res.json({ success: true, data: promo });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Claim launch offer: first N customers get Ad-Free free.
 * Requires login. One claim per account. Atomically capped.
 */
router.post('/promo/claim', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    if (!FIRST10_ENABLED) {
      return res.status(410).json({ success: false, error: 'This offer is no longer available', code: 'PROMO_OFF' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: 'Login required' });
    if (user.adFree) {
      return res.json({
        success: true,
        adFree: true,
        already: true,
        message: 'You already have Ad-Free on this account'
      });
    }
    if (user.promoClaim === FIRST10_KEY) {
      return res.json({
        success: true,
        adFree: true,
        already: true,
        message: 'You already claimed this offer'
      });
    }

    await Promo.updateOne(
      { key: FIRST10_KEY },
      { $setOnInsert: { key: FIRST10_KEY, limit: FIRST10_LIMIT, claimed: 0, claims: [] } },
      { upsert: true }
    );

    const promo = await Promo.findOneAndUpdate(
      { key: FIRST10_KEY, claimed: { $lt: FIRST10_LIMIT } },
      {
        $inc: { claimed: 1 },
        $push: {
          claims: {
            userId: String(user._id),
            username: user.username,
            at: new Date()
          }
        },
        $set: { updatedAt: new Date(), limit: FIRST10_LIMIT }
      },
      { new: true }
    );

    if (!promo) {
      const cur = await getFirst10Promo(user._id);
      return res.status(410).json({
        success: false,
        error: 'Sorry — all 10 free Ad-Free spots are taken. You can still unlock for £1.',
        code: 'PROMO_SOLD_OUT',
        promo: cur
      });
    }

    user.adFree = true;
    user.adFreeAt = new Date();
    user.promoClaim = FIRST10_KEY;
    await user.save();

    console.log('First10 promo claimed by', user.username, `(${promo.claimed}/${FIRST10_LIMIT})`);
    res.json({
      success: true,
      adFree: true,
      promoClaim: FIRST10_KEY,
      remaining: Math.max(0, FIRST10_LIMIT - promo.claimed),
      claimed: promo.claimed,
      limit: FIRST10_LIMIT,
      message: `You're in! Free Ad-Free unlocked (${promo.claimed} of ${FIRST10_LIMIT} claimed).`
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
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const meta = {
      product: 'adfree',
      userId: req.user?.id || '',
      username: req.user?.username || ''
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: PRICE_PENCE,
          product_data: {
            name: 'FlixNova Ad-Free + XXX (lifetime)',
            description: 'One-time unlock — Real-Debrid streams, no FlixNova ads, and Adult/XXX catalog on this account.'
          }
        }
      }],
      success_url: `${siteUrl()}/?adfree=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/?adfree=cancel`,
      customer_email: email || undefined,
      client_reference_id: req.user?.id || undefined,
      metadata: meta
    });
    res.json({ success: true, url: session.url, sessionId: session.id });
  } catch (e) {
    console.error('Stripe checkout:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Confirm a Checkout session after redirect (works without webhook) */
router.get('/confirm', authOptional, async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) return res.status(503).json({ success: false, error: 'Stripe not configured' });
    const sessionId = String(req.query.session_id || '').trim();
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id required' });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return res.status(402).json({ success: false, error: 'Payment not completed' });
    }
    if (session.metadata?.product !== 'adfree' && session.mode !== 'payment') {
      return res.status(400).json({ success: false, error: 'Invalid session' });
    }
    // Only unlock the account that started checkout — never attach a guest session to a later login
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
    await User.findByIdAndUpdate(userId, {
      adFree: true,
      adFreeAt: new Date(),
      stripeSessionId: sessionId
    });
    res.json({
      success: true,
      adFree: true,
      linkedAccount: true,
      message: 'Ad-free unlocked on your account'
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

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
      if (session.payment_status === 'paid' || session.status === 'complete') {
        const userId = session.client_reference_id || session.metadata?.userId;
        if (userId) {
          await User.findByIdAndUpdate(userId, {
            adFree: true,
            adFreeAt: new Date(),
            stripeSessionId: session.id
          });
          console.log('Ad-free unlocked for user', userId);
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
