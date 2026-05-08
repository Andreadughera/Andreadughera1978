# CryptoSentinel Workspace

## Overview

pnpm workspace monorepo using TypeScript. **CryptoSentinel** — a fully autonomous crypto trading system with a React/Vite frontend, Express backend connected to Crypto.com Exchange API, advanced signal computation, and automated trade execution on USD pairs.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod, `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (single bundle)
- **HTTP client**: axios (for Crypto.com Exchange API)
- **Charts**: Recharts

## Artifacts

- **crypto-signals** (`/`) — React + Vite frontend with 9 pages: Dashboard, Signals, Signal Detail, Trades, Portfolio, Arbitrage, Market, Listings, Reports, Settings
- **api-server** (`/api`) — Express backend with protected dashboard/API auth, Crypto.com Exchange API, signal computation, and guarded live trade execution

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Production Safety Requirements

Live trading must not be exposed without these environment variables:

- `DASHBOARD_PASSWORD` and `SESSION_SECRET` — protect the dashboard and all non-health API routes.
- `SETTINGS_ENCRYPTION_KEY` — encrypts newly saved Crypto.com API keys in the settings table.
- `LIVE_TRADING_ENABLED=true` — required in production before auto-trade can place real orders.
- `CORS_ORIGINS=https://your-dashboard-domain` — optional allow-list for cross-origin dashboard deployments.

Keep `ENABLE_LISTING_AUTO_TRADE=false` unless the high-risk listing strategy has been reviewed. Keep `ALLOW_MOCK_MARKET_DATA=false` for live trading.

## Architecture

### Signal Generation (20 symbols)
BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, ADAUSDT, XRPUSDT, DOTUSDT, LINKUSDT, AVAXUSDT, MATICUSDT, UNIUSDT, ATOMUSDT, LTCUSDT, NEARUSDT, APTUSDT, TRXUSDT, FTMUSDT, ALGOUSDT, DOGEUSDT, FILUSDT

- Fetches 1h + 4h OHLCV candles: Binance global → CDC public (parallel) → OKX public fallback
- OKX renames: MATICUSDT→POL-USDT, FTMUSDT→S-USDT. No API key required on any source.
- Computes RSI(14), dual SMA(10/50), MACD(12/26/9), StochRSI(14/14), Bollinger %B(20), ATR(14)
- 7-vote system: RSI, MA crossover, MACD, StochRSI, Bollinger %B, funding rate, whale activity
- Generates BUY/SELL/HOLD signals with confidence 55-97; refreshes every 1 minute; stores in PostgreSQL

### Auto-Trade Execution (Crypto.com Exchange)
- BUY signals with confidence > threshold trigger market orders on CDC exchange
- Server-side TP/SL monitor every 2 minutes (closes positions automatically while the server is running)
- Trailing stop loss on profitable positions
- Anti-duplicate protection (one open position per symbol)
- Correlation block: blocks new BUY if highly correlated asset already open (r > 0.85)
- Risk gate: halts all trading if daily drawdown exceeds 5%

### Intelligence Modules
- **Market Regime** (`marketRegime.ts`): ADX + BB Width → TRENDING_BULL / TRENDING_BEAR / RANGING / VOLATILE / CONSOLIDATING (cached 15 min)
- **Self-Tuner** (`selfTuner.ts`): Analyzes own trade history, computes optimal confidence per symbol/hour bucket, generates insights
- **Correlation Engine** (`correlation.ts`): Pearson correlation matrix across open positions, blocks correlated entries
- **Risk Manager** (`riskManager.ts`): Daily drawdown guard (5% limit), position concentration check, capital exposure
- **Portfolio Analytics** (`portfolioAnalytics.ts`): Equity curve, win rate, Sharpe ratio, drawdown, live PnL per position
- **AI Market Briefing**: Rule-based briefing from Fear & Greed + CoinGecko data (with optional OpenAI enhancement)
- **New Listing Detector**: Polls Binance US for new symbols every 5 min; quick-flip trades are disabled unless `ENABLE_LISTING_AUTO_TRADE=true`
- **Arbitrage Monitor**: Compares Binance US vs CDC prices across all 20 pairs, flags spreads > 0.15%

### Database Schema
- `signals`: id, symbol, type, price, rsi, ma_short, ma_long, confidence, reason, created_at
- `trades`: id, symbol, signal_id, side, quantity, entry_price, tp_price, sl_price, trailing_stop_pct, status, cdc_order_id, confidence, error_message, created_at, closed_at, close_price
- `settings`: key (PK), value, updated_at — stores trade config and API keys; newly saved keys are encrypted when `SETTINGS_ENCRYPTION_KEY` is configured

### API Endpoints
- `GET /api/signals` — list signals (filter by symbol, type)
- `GET /api/signals/summary` — aggregated stats
- `GET /api/signals/:symbol` — signals for a specific symbol
- `GET /api/trades` — list trades (limit param)
- `GET /api/trades/stats` — trade statistics
- `GET /api/prices` — live prices for all tracked symbols
- `GET /api/market/overview` — Fear & Greed, whale alerts, sentiment, briefing, trending
- `GET /api/sentiment` — sentiment data (F&G, whale alerts, bias)
- `GET /api/listings` — new listing detector status
- `GET /api/reports/daily` — daily performance report
- `GET /api/portfolio/stats` — equity stats (win rate, Sharpe, drawdown, PF)
- `GET /api/portfolio/equity-curve` — 30-day equity curve data
- `GET /api/portfolio/positions` — open positions with live unrealized PnL
- `GET /api/portfolio/symbols` — per-symbol performance breakdown
- `GET /api/portfolio/regime` — current market regime (ADX, BB Width, BTC trend)
- `GET /api/portfolio/correlation` — correlation matrix across tracked symbols
- `GET /api/portfolio/tuner` — self-tuner insights and optimal confidence
- `GET /api/portfolio/risk` — risk summary (drawdown, positions, capital, status)
- `GET /api/arbitrage` — Binance US vs CDC price spreads for all 20 pairs
- `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout` — dashboard session
- `GET /api/settings/exchange` / `POST /api/settings/exchange` — exchange keys and trade configuration
- `GET /api/healthz` — health check

### Frontend Pages
- **Pulse** (`/`) — Dashboard: Market Regime badge, Fear & Greed gauge, AI Market Briefing, signal stats, whale alerts, trending coins, price ticker
- **Signals** (`/signals`) — Signal list with BUY/SELL/HOLD filter and per-symbol detail
- **Trades** (`/trades`) — All auto-executed trades + **live unrealized PnL strip** for open positions
- **Portfolio** (`/portfolio`) — Equity curve chart, performance metrics (win rate, Sharpe, PF), market regime card, self-tuner insights, risk dashboard
- **Arbitrage** (`/arbitrage`) — Real-time Binance US vs CDC spread monitor with opportunity flags
- **Market** (`/market`) — Live prices, 24h changes
- **Listings** (`/listings`) — New listing quick-flip detector
- **Reports** (`/reports`) — Daily trading reports
- **Settings** (`/settings`) — API keys, auto-trade config, thresholds
