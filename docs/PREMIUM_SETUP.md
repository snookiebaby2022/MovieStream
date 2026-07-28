# FlixNova Premium setup guide

You already have **Real-Debrid**. The site works with RD alone. Add the services below when you want more cached links and coverage.

After editing `/var/www/moviestream/backend/.env` on the VPS:

```bash
cd /var/www/moviestream && pm2 restart moviestream --update-env
```

---

## 1. AllDebrid

1. Create an account at [https://alldebrid.com](https://alldebrid.com) and buy a plan.
2. Open **API / PIN** (or Account → API key) and copy your API key.
3. On the VPS `.env` set:

```env
ALLDEBRID_API_TOKEN=your_alldebrid_api_key
```

FlixNova will query Torrentio + Comet with `alldebrid=` automatically.

---

## 2. Premiumize

1. Sign up at [https://www.premiumize.me](https://www.premiumize.me) and subscribe.
2. Go to **Account → API** and copy the API key / customer ID token Premiumize shows for apps.
3. Set:

```env
PREMIUMIZE_API_TOKEN=your_premiumize_api_key
```

---

## 3. TorBox

1. Sign up at [https://torbox.app](https://torbox.app) and pick a plan.
2. Open **Settings → Integrations / API Keys** and create/copy an API key.
3. Set:

```env
TORBOX_API_TOKEN=your_torbox_api_key
```

---

## 4. MediaFusion (ElfHosted)

MediaFusion is a Stremio addon. You configure your debrid keys once in their UI, then paste the encrypted config into FlixNova.

1. Open [https://mediafusion.elfhosted.com](https://mediafusion.elfhosted.com) (or `/app/configure` if prompted).
2. Add the debrid services you own (Real-Debrid, AllDebrid, Premiumize, TorBox) and paste each API key.
3. Save, then use **Share Manifest URL** / install link.
4. The URL looks like:

`https://mediafusion.elfhosted.com/<LONG_ENCRYPTED_CONFIG>/manifest.json`

5. Copy **only** the `<LONG_ENCRYPTED_CONFIG>` path segment (not the host, not `/manifest.json`).
6. Set:

```env
MEDIAFUSION_URL=https://mediafusion.elfhosted.com
MEDIAFUSION_CONFIG=paste_the_encrypted_segment_here
```

---

## 5. AIOStreams (ElfHosted)

AIOStreams aggregates many addons and applies your debrid keys once.

1. Open [https://aiostreams.elfhosted.com](https://aiostreams.elfhosted.com) (configure / public instance).
2. **Services** tab: enable Real-Debrid / AllDebrid / Premiumize / TorBox and paste the same API keys.
3. **Marketplace** tab: enable the addons you want (Comet, MediaFusion, TorBox Search, etc.).
4. Save → copy the **manifest URL**. It looks like:

`https://aiostreams.elfhosted.com/stremio/<your-id>/manifest.json`

5. Set `AIOSTREAMS_BASE_URL` to that URL **without** `/manifest.json`:

```env
AIOSTREAMS_BASE_URL=https://aiostreams.elfhosted.com/stremio/<your-id>
```

Public ElfHosted instances are rate-limited. For heavy traffic, consider a paid private ElfHosted AIOStreams instance later.

---

## 6. Stripe — £1 / month subscription

1. Log in to [https://dashboard.stripe.com](https://dashboard.stripe.com) (use **live** mode for production).
2. **Product catalog → Add product**
   - Name: `FlixNova Premium`
   - Pricing: **Recurring**, **£1.00 GBP**, billing period **Monthly**
3. Copy the Price ID (`price_...`).
4. **Developers → API keys** → copy the **Secret key** (`sk_live_...`).
5. **Developers → Webhooks → Add endpoint**
   - URL: `https://snookiebaby.xyz/api/pay/webhook` (or your SITE_URL + `/api/pay/webhook`)
   - Events:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
   - Copy the signing secret (`whsec_...`).
6. Optional but recommended: enable **Customer portal** under Billing → Customer portal (so users can cancel).
7. On the VPS `.env`:

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
ADFREE_PRICE_PENCE=100
ADFREE_CURRENCY=gbp
SITE_URL=https://snookiebaby.xyz
```

If `STRIPE_PRICE_ID` is empty, Checkout still creates a £1/month price inline — using a Dashboard Price ID is cleaner for reporting.

---

## 7. What each env key does

| Key | Required? | Effect |
|-----|-----------|--------|
| `REALDEBRID_API_TOKEN` | Yes (you have it) | Main debrid via Torrentio/Comet + ApiBay fallback |
| `ALLDEBRID_API_TOKEN` | Optional | Extra Torrentio/Comet results |
| `PREMIUMIZE_API_TOKEN` | Optional | Extra Torrentio/Comet results |
| `TORBOX_API_TOKEN` | Optional | Extra Torrentio/Comet results |
| `MEDIAFUSION_CONFIG` | Optional | MediaFusion encrypted config |
| `AIOSTREAMS_BASE_URL` | Optional | AIOStreams aggregated streams |
| `STRIPE_SECRET_KEY` | For payments | Checkout + webhooks |
| `STRIPE_PRICE_ID` | Recommended | £1/month Price from Dashboard |
| `STRIPE_WEBHOOK_SECRET` | Recommended | Keeps subscription status in sync |

Empty optional keys are simply skipped — no errors.

---

## 8. Product rules (after this deploy)

- **Embeds are off** — playback is premium debrid only.
- **Browse free** after signup/login (catalog only).
- **48-hour watch trial** starts on the **first Play** (not at signup).
- After the trial: **£1/month** via Stripe to keep watching.
- **First-10 promo** still grants **lifetime** Premium (admin can disable).
- Existing one-time Ad-Free buyers are **grandfathered** as lifetime.
- Admin → **Debrid Keys** can paste RD / AllDebrid / Premiumize / TorBox / MediaFusion / AIOStreams.

---

## 9. Cost note

Debrid subscriptions are separate from FlixNova’s £1/month. You pay AllDebrid / Premiumize / TorBox / RD yourself; users only pay FlixNova Premium. Start with RD only and add others when you want more hit-rate.
