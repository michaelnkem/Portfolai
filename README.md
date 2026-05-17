# Portfolai — UK Property Investment Intelligence Platform

A professional-grade property investment platform built with Next.js 14. Powered by real UK property data from Homedata (Land Registry, EPC Register, environmental risks) and AI analytics from Anthropic Claude.

---

## 🚀 Quick Start (5 minutes)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure API keys
```bash
cp .env.local.example .env.local
```
Then edit `.env.local`:

```env
HOMEDATA_API_KEY=your_key_here        # Free at homedata.co.uk/register
ANTHROPIC_API_KEY=your_key_here       # console.anthropic.com
```

### 3. Get your API keys

**Homedata** (free, no credit card):
1. Go to https://homedata.co.uk/register
2. Sign up — key issued instantly
3. 100 free API calls/month (7 calls per property lookup)

**Anthropic** (AI analytics):
1. Go to https://console.anthropic.com
2. Create an account and generate an API key
3. Add payment method (pay-per-use, ~$0.003 per analysis)

### 4. Run locally
```bash
npm run dev
```
Open http://localhost:3000

---

## 📦 Deploy to Vercel (free, 3 minutes)

### Option A: Vercel CLI
```bash
npm install -g vercel
vercel
# Follow prompts — add env vars when asked
```

### Option B: GitHub + Vercel dashboard
1. Push this folder to a GitHub repo
2. Go to https://vercel.com/new
3. Import your repo
4. Add environment variables in Vercel dashboard:
   - `HOMEDATA_API_KEY`
   - `ANTHROPIC_API_KEY`
5. Deploy — done. You get a live HTTPS URL.

---

## 🏗 Architecture

```
portfolai/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main app shell
│   │   ├── layout.tsx            # Root layout + fonts
│   │   ├── globals.css           # Tailwind + custom styles
│   │   └── api/
│   │       ├── property/route.ts # Homedata property lookup
│   │       ├── ai/route.ts       # Anthropic streaming AI
│   │       └── market/route.ts   # Market data endpoint
│   ├── components/
│   │   ├── layout/               # Navbar, HeroStats
│   │   ├── property/             # Search, Detail, Portfolio, Calculator, MarketIntel
│   │   ├── ai/                   # AIAdvisor streaming chat
│   │   └── ui/                   # Stat, ScoreRing, LineChart, etc.
│   ├── lib/
│   │   ├── homedata.ts           # Homedata API client (server-side)
│   │   └── market-data.ts        # Real 2026 UK market data + calculators
│   └── types/index.ts            # TypeScript types
```

**Key design decisions:**
- API keys are **server-side only** — never exposed to the browser
- Homedata calls go through Next.js API routes, not directly from the client
- AI responses **stream** using edge runtime for low latency
- Market data (HPI, yields) is baked in from real ONS/Land Registry sources

---

## 🔌 What the Homedata API provides

Each property search uses ~7 API calls (free tier gives 100/month):

| Call | Cost | Data |
|------|------|------|
| Address search | 2 calls | Suggestions + UPRN |
| Property record | 1 call | Type, beds, floor area, tenure, EPC, council tax, last sold |
| EPC data | 1 call | Energy efficiency score, certificate date |
| Transaction history | 1 call | Full Land Registry sale history |
| Environmental risks | 1 call | Flood, radon, noise, landfill, coal mining |
| **Total per lookup** | **6 calls** | |

**Free tier:** 100 calls/month → ~16 full property lookups/month
**Paid tiers:** Start from £19/month for 2,000 calls

---

## 📊 Market Data Sources

All market data is real, sourced from:

| Data | Source |
|------|--------|
| UK HPI | ONS / HM Land Registry (Feb 2026) |
| City price growth | Zoopla HPI April 2026 |
| Rental yields | REalyse April 2026 |
| Rental growth | ONS PIPR (Price Index of Private Rents) |
| Macro (BoE rate, CPI) | Bank of England / ONS |
| SDLT rates | HMRC (Oct 2024 surcharge) |

---

## 🛠 Upgrading to production

### More property data
For higher volumes or live listings:
- **PropertyData.co.uk** (£28/mo): Live Rightmove/Zoopla listings + area analytics
- **Apify scrapers**: Live Rightmove/Zoopla listings (ToS risk)

### Add a database (user accounts, saved searches)
```bash
npm install @prisma/client prisma
# or use Supabase / PlanetScale
```

### Add authentication
```bash
npm install next-auth
```

### Upgrade Homedata plan
1. Log in to homedata.co.uk
2. Go to Pricing → select plan
3. No code changes needed — just more API credits

---

## 🔧 Customisation

### Adding more cities
Edit `src/lib/market-data.ts` → `MARKET_DATA.cities` — add any city with its ONS data.

### Adjusting investment defaults
`PropertyDetail.tsx` and `ROICalculator.tsx` — all defaults are clearly labelled sliders.

### Styling
`tailwind.config.js` defines the colour palette. Main colours:
- `accent`: `#00d4aa` (teal-green)
- `gold`: `#f0c040`
- `danger`: `#ff4d6d`
- `panel`: `#0a1628`
- `bg`: `#060c16`

---

## 📋 Roadmap suggestions

- [ ] User authentication (NextAuth + Prisma)
- [ ] Saved searches with email alerts
- [ ] Rightmove/Zoopla live listing integration (PropertyData API)
- [ ] PDF investment report export
- [ ] Deal sourcing: filter by below-market-value signals
- [ ] HMO licence checker (council databases)
- [ ] Mortgage broker API integration (Habito, Trussle)
- [ ] Companies House landlord company setup guide
- [ ] Section 24 tax calculator
- [ ] Portfolio stress testing (rate scenarios)

---

## 📄 Licence

MIT — use freely for personal or commercial projects.
