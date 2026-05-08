/**
 * OKX public market data API — global, no geo-restrictions, no API key needed.
 * Used as fallback when Binance and CDC public APIs are unavailable.
 *
 * Symbol mapping: BTCUSDT → BTC-USDT (dash-separated, USDT quote)
 * Rate limit: 20 requests/second — handles our 20-symbol parallel load.
 * Kline endpoint: GET /api/v5/market/candles?instId=BTC-USDT&bar=1H&limit=150
 *
 * Includes 5-minute in-memory cache + in-flight deduplication to avoid
 * duplicate requests when 20 symbols compute 1h + 4h klines simultaneously.
 */
import axios from "axios";
import { logger } from "./logger";
import type { KlineData, Ticker24h } from "./binance";

const OKX_BASE = "https://www.okx.com/api/v5/market";

const client = axios.create({ baseURL: OKX_BASE, timeout: 10000 });

// ─── symbol conversion ────────────────────────────────────────────────────────
// BTCUSDT → BTC-USDT, MATICUSDT → POL-USDT (Polygon rebranded to POL)
// Rebranded tokens on OKX
const SYMBOL_OVERRIDES: Record<string, string> = {
  MATICUSDT: "POL-USDT", // Polygon rebranded to POL
  FTMUSDT:   "S-USDT",   // Fantom rebranded to Sonic (S)
};

function toOkxInstId(symbol: string): string {
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];
  if (symbol.endsWith("USDT")) return `${symbol.slice(0, -4)}-USDT`;
  if (symbol.endsWith("BTC"))  return `${symbol.slice(0, -3)}-BTC`;
  if (symbol.endsWith("ETH"))  return `${symbol.slice(0, -3)}-ETH`;
  return symbol;
}

// ─── interval mapping ─────────────────────────────────────────────────────────
// OKX bar values: 1m 3m 5m 15m 30m 1H 2H 4H 6H 12H 1D 2D 3D 1W 1M
function toOkxBar(interval: string): string {
  const map: Record<string, string> = {
    "1m":  "1m",  "3m":  "3m",  "5m":  "5m",
    "15m": "15m", "30m": "30m", "1h":  "1H",
    "2h":  "2H",  "4h":  "4H",  "6h":  "6H",
    "12h": "12H", "1d":  "1D",  "1w":  "1W",
  };
  return map[interval] ?? "1H";
}

// ─── OKX response types ───────────────────────────────────────────────────────
interface OkxKlineResponse {
  code: string;
  msg: string;
  // Each item: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
  data: string[][];
}

interface OkxTickerResponse {
  code: string;
  msg: string;
  data: Array<{
    instId: string;
    last: string;
    open24h: string;
    high24h: string;
    low24h: string;
    vol24h: string;
    sodUtc8: string;
    chgUtc8: string;
  }>;
}

// ─── cache + in-flight dedup ──────────────────────────────────────────────────
interface CacheEntry {
  data: KlineData[];
  expiresAt: number;
}
const klinesCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const inFlight = new Map<string, Promise<KlineData[] | null>>();

function cacheKey(symbol: string, interval: string): string {
  return `okx:${symbol}:${interval}`;
}

// ─── klines ───────────────────────────────────────────────────────────────────
export async function getOkxKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<KlineData[] | null> {
  const key = cacheKey(symbol, interval);

  const cached = klinesCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = _fetchKlines(symbol, interval, limit);
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

async function _fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<KlineData[] | null> {
  const instId = toOkxInstId(symbol);
  const bar    = toOkxBar(interval);
  const intervalMs: Record<string, number> = {
    "1m":  60_000,     "3m":   180_000,   "5m":   300_000,
    "15m": 900_000,    "30m":  1_800_000, "1h":  3_600_000,
    "2h":  7_200_000,  "4h": 14_400_000,  "6h": 21_600_000,
    "12h": 43_200_000, "1d": 86_400_000,  "1w": 604_800_000,
  };
  const ms = intervalMs[interval] ?? 3_600_000;

  try {
    const res = await client.get<OkxKlineResponse>("/candles", {
      params: { instId, bar, limit },
    });
    if (res.data.code !== "0") {
      logger.warn(
        { symbol, code: res.data.code, msg: res.data.msg },
        "OKX klines non-zero code",
      );
      return null;
    }
    const list = res.data.data;
    if (!list || list.length < 10) {
      logger.warn({ symbol, count: list?.length ?? 0 }, "OKX klines: too few candles");
      return null;
    }
    // OKX returns newest-first → reverse to oldest-first
    const sorted = [...list].reverse();
    const result: KlineData[] = sorted.map((k) => {
      const openTime = parseInt(k[0], 10);
      return {
        openTime,
        open:      k[1],
        high:      k[2],
        low:       k[3],
        close:     k[4],
        volume:    k[5],
        closeTime: openTime + ms - 1,
      };
    });
    klinesCache.set(cacheKey(symbol, interval), {
      data: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return result;
  } catch (err) {
    logger.warn({ symbol, err: (err as Error).message }, "OKX klines request failed");
    return null;
  }
}

// ─── tickers ─────────────────────────────────────────────────────────────────
// OKX returns a single ticker per request — batch with Promise.allSettled
export async function getOkxTickers(symbols: string[]): Promise<Map<string, Ticker24h>> {
  const result = new Map<string, Ticker24h>();
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const instId = toOkxInstId(symbol);
      const res = await client.get<OkxTickerResponse>("/ticker", {
        params: { instId },
      });
      if (res.data.code !== "0" || !res.data.data?.[0]) return null;
      const t = res.data.data[0];
      const last   = parseFloat(t.last);
      const open24 = parseFloat(t.open24h);
      const change = (last - open24).toFixed(8);
      const changePct = open24 > 0 ? (((last - open24) / open24) * 100).toFixed(4) : "0";
      return { symbol, ticker: {
        symbol,
        lastPrice:          t.last,
        priceChange:        change,
        priceChangePercent: changePct,
        volume:             t.vol24h,
        highPrice:          t.high24h,
        lowPrice:           t.low24h,
      } as Ticker24h };
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      result.set(r.value.symbol, r.value.ticker);
    }
  }
  return result;
}
