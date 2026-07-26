/**
 * One-time £1 "Remove ads" via Stripe Checkout.
 */
const express = require('express');
const { User } = require('./models');
const { authRequired, authOptional, verifyToken } = require('./authRoutes');

const router = express.Router();
const PRICE_PENCE = Math.max(100, parseInt(process.env.ADFREE_PRICE_PENCE || '100', 10) || 100); // £1.00 default
const CURRENCY = (process.env.ADFREE_CURRENCY || 'gbp').toLowerCase();

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) return null;
  // Lazy require
  const Stripe = require('stripe');
  return new Stripe(key);
}

function siteUrl() {
  // Prefer full public URL including port if the site is not on 443
  return (process.env.SITE_URL || 'https://snookiebaby.xyz:8443').replace(/\/$/, '');
}

function dbReady(res) {
  if (require('mongoose').connection.readyState !== 1) {
    res.status(503).json({ success: false, error: 'Database unavailable' });
    return false;
  }
  return true;
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
  res.json({
    success: true,
    configured,
    adFree,
    price: PRICE_PENCE,
    currency: CURRENCY,
    label: `£${(PRICE_PENCE / 100).toFixed(2)}`
  });
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
    let userId = session.client_reference_id || session.metadata?.userId || req.user?.id || '';
    if (userId) {
      if (!dbReady(res)) return;
      await User.findByIdAndUpdate(userId, {
        adFree: true,
        adFreeAt: new Date(),
        stripeSessionId: sessionId
      });
    }
    res.json({
      success: true,
      adFree: true,
      linkedAccount: !!userId,
      message: userId
        ? 'Ad-free unlocked on your account'
        : 'Ad-free unlocked on this browser. Sign in before paying next time to sync across devices.'
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

async function handleWebhook(req, res) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!stripe) return res.status(503).send('Stripe not configured');
  let event = req.body;
  try {
    if (secret) {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } else if (Buffer.isBuffer(req.body)) {
      event = JSON.parse(req.body.toString('utf8'));
    }
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
