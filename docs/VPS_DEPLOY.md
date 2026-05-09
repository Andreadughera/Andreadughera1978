# CryptoSentinel VPS deployment

This setup runs CryptoSentinel outside Replit as one web app:

- Express API and trading engine on port `8080`
- React dashboard served by the same backend
- PostgreSQL in Docker
- One stable VPS public IPv4 for Crypto.com Exchange whitelist

## 1. Choose the server

Use a small Ubuntu VPS with a public static IPv4 address. Minimum practical size:

- 1 vCPU
- 1-2 GB RAM
- 20 GB disk

Do not enable live trading until the dashboard password, Crypto.com API permissions, and IP whitelist are verified.

## 2. Install Docker on the VPS

On Ubuntu:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in after adding your user to the `docker` group.

## 3. Configure environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Generate strong secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

Edit `.env`:

```env
POSTGRES_PASSWORD=<random database password>
DASHBOARD_PASSWORD=<password you will use in the browser>
SESSION_SECRET=<random secret>
SETTINGS_ENCRYPTION_KEY=<random secret>
CORS_ORIGINS=

LIVE_TRADING_ENABLED=false
MAX_TRADE_NOTIONAL_USD=10
MAX_NEW_TRADES_PER_SESSION=1
STOP_AFTER_FIRST_FILL=true
MAX_OPEN_POSITIONS=2
MAX_TOTAL_EXPOSURE_USD=20
ENABLE_LISTING_AUTO_TRADE=false
ALLOW_MOCK_MARKET_DATA=false
```

Leave `LIVE_TRADING_ENABLED=false` while testing. You can enter Crypto.com keys from the protected Settings page, or set `CDC_API_KEY` / `CDC_SECRET_KEY` in `.env`.

## 4. Start the system

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Open:

```text
http://YOUR_VPS_IP:8080
```

Log in with `DASHBOARD_PASSWORD`.

## 5. Crypto.com Exchange API checklist

Create the API key at:

```text
crypto.com/exchange -> API Management
```

Required:

- Exchange API key, not the mobile app API
- Trading permission enabled
- Withdrawal permission disabled
- IP whitelist enabled with the VPS public IPv4

Check the VPS IPv4:

```bash
curl -4 https://api4.ipify.org
```

The dashboard also shows `/api/server-info`, but the terminal command above is the source to use for whitelist.

## 6. Test before live trading

With `LIVE_TRADING_ENABLED=false`:

1. Open Settings.
2. Save API keys.
3. Click Test Connection.
4. Confirm balances are shown.
5. Confirm the bot generates signals and no real orders are placed.
6. Keep listing auto-trade disabled.

For controlled live tests, keep these capital-preservation brakes enabled:

- `MAX_TRADE_NOTIONAL_USD=10` caps each order.
- `MAX_NEW_TRADES_PER_SESSION=1` allows only one new filled BUY per app session.
- `STOP_AFTER_FIRST_FILL=true` stops queued BUY attempts after the first filled BUY.
- `MAX_OPEN_POSITIONS=2` blocks new BUYs once two positions are open.
- `MAX_TOTAL_EXPOSURE_USD=20` blocks new BUYs above total open exposure.

Only after this, edit `.env`:

```env
LIVE_TRADING_ENABLED=true
```

Then restart:

```bash
docker compose up -d
```

## 7. Emergency stop

Use the Settings page button:

```text
Emergency Stop Auto-Trade
```

Or stop the service:

```bash
docker compose stop app
```

If you suspect bad behavior, also disable or delete the API key in Crypto.com Exchange.

## 8. Updating the app

```bash
git pull
docker compose up -d --build
docker compose logs -f app
```

## Important limits

- This does not guarantee profits.
- Stop-loss is server-side monitoring, not an exchange-native stop order.
- If the VPS is offline, server-side exits cannot run.
- Use small trade sizes until the system has proven stable.
