# Indian Stock Portfolio Tracker

A browser-based portfolio tracker for NSE/BSE stocks — dashboard, watchlist,
price alerts, fundamental analysis, and a market overview. Works in any
modern browser (Chrome, Safari, Firefox, Edge) since it's plain HTML/CSS/JS
with no build step.

## Project structure

```
index.html            Page structure/markup only
styles.css            All styling
app.js                All application logic
firebase-config.js    Your Firebase keys (optional, for cross-device sync)
```

Splitting it this way (instead of one giant HTML file) makes it easier to
maintain, review changes, and hand off to other developers later.

## Running it locally

Just open `index.html` in a browser. No server or build step required.

## Deploying (GitHub Pages)

1. Create a new **public** GitHub repository.
2. Upload all four files (`index.html`, `styles.css`, `app.js`,
   `firebase-config.js`) to the repo root.
3. Go to **Settings → Pages**, set Source to "Deploy from a branch",
   branch `main`, folder `/ (root)`, then Save.
4. After a minute, your live URL appears at the top of that page
   (`https://yourusername.github.io/your-repo-name/`).

## Data storage — two modes

**Local only (default):** Data saves to the browser's `localStorage`.
Works immediately, no setup, but data does not follow you to a different
browser or device.

**Cross-device sync (optional):** Fill in `firebase-config.js` with a free
Firebase project's keys (instructions are in that file), then:

1. On your main device, open the app, type any code you like into the
   "sync code" box in the header (e.g. `raj-portfolio-2026` — this is
   just a shared ID, not a password), and click **Link device** →
   choose **Push** (Cancel on the confirm dialog) to upload your current
   data.
2. On any other device/browser, open the same URL, type the *same* code,
   click **Link device** → choose **Pull** (OK on the confirm dialog) to
   download that data.
3. From then on, every save on either device also updates the cloud copy.

### Security note

This sync method is intentionally simple (no login) for personal use —
anyone who knows your exact sync code could read/write that data if your
Firestore rules are left wide open. For a personal tracker this is usually
an acceptable trade-off, but:
- Pick a non-guessable sync code (not just "test" or "portfolio").
- In the Firebase console, under Firestore → Rules, restrict access,
  for example to require the client to know a matching document ID rather
  than allowing open read/write to the whole collection.
- Do not put sensitive personal or financial account credentials in this
  app — it only stores the portfolio entries you type in (ticker, buy
  price, quantity, notes, alerts), not brokerage logins.

## Live price data (free, no signup, no cost)

Stock and index prices now come from Yahoo Finance's free public quote
endpoint — no API key, no account, no payment. Indian market data through
it is typically delayed by roughly 15 minutes, which the app is designed
around.

How it works under the hood:
- `app.js` requests `https://query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>.NS`
  (falling back to `.BO` for BSE-only tickers).
- Since browsers can't call Yahoo directly (no CORS headers on their end),
  each request is routed through a free public CORS proxy. Three different
  proxies are tried in order, so if one is temporarily down the app just
  moves to the next.
- If every proxy/request fails (e.g. you're offline, or all three proxies
  are down at once), the app automatically falls back to generated mock
  data so the UI never breaks — the status badge in the header will say
  "Offline (Using Mock Data)" when that happens.

**Things to know about this approach:**
- Free public CORS proxies are convenient but not enterprise-grade — they
  can rate-limit or go down without notice. This is fine for a personal
  tracker; if you eventually want guaranteed uptime, the fix is running
  your own tiny proxy (e.g. a free Cloudflare Worker) instead of the public
  ones — happy to set that up if you hit reliability issues.
- Yahoo's endpoint is public but unofficial; it isn't guaranteed to stay
  stable forever. If it ever stops working, mock data keeps the app usable
  while a replacement is wired in.
- No API key or payment is involved anywhere in this flow.

## Known limitation

Company fundamentals, sector data, and some analysis figures still use
placeholder logic — only price/volume data is live. A separate step would
be needed to source live fundamentals for free.
