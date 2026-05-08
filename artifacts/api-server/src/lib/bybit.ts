/**
 * Bybit public market data API — global, no geo-restrictions, no API key needed.
 * Used as fallback when Binance and CDC public APIs are unavailable.
 *
 * Naming convention matches our TRACKED_SYMBOLS (e.g. BTCUSDT) directly.
 * Rate limit: ~20 requests/second — handles our 20-symbol parallel load.
 * Candle endpoint: GET /v5/market/kline?category=spot&symbol=BTCUSDT&interval=60&limit=150
 *
 * Includes 5-minute in-memory cache + in-flight deduplication to further reduce
 * API load when 20 symbols fire 1h + 4h klines simultaneously.
 */
import axios from "axios";
import { logger } from "./logger";
import type { KlineData, Ticker24h } from "./binance";

const BYBIT_BASE = "https://api.bybit.com/v5/market";

const client = axios.create({ baseURL: BYBIT_BASE, timeout: 10000 });

// ─── interval mapping ────────────────────────────────────────────────────────
// Bybit uses numeric minutes for spot: 1, 3, 5, 15, 30, 60, 120, 240, 360, 720, D, W, M
function toBybitInterval(interval: string): string {
  const map: Record<string, string> = {
    "1m":  "1",   "3m":  "3",   "5m":  "5",
    "15m": "15",  "30m": "30",  "1h":  "60",
    "2h":  "120", "4h":  "240", "6h":  "360",
    "12h": "720", "1d":  "D",   "1w":  "W",
  };
  return map[interval] ?? "60";
}

// ─── Bybit response types ─────────────────────────────────────────────────────
interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result: {
    symbol: string;
    category: string;
    list: string[][]; // [startTime, open, high, low, close, volume, turnover]
  };
}

interface BybitTickerResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: Array<{
      symbol: string;
      lastPrice: string;
      price24hPcnt: string;
      highPrice24h: string;
      lowPrice24h: string;
      volume24h: string;
      prevPrice24h: string;
    }>;
  };
}

// ─── Cache ───────────────────────────────────────────────────────────────────
interface CacheEntry {
  data: KlineData[];
  expiresAt: number;
}
const klinesCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-flight deduplication: concurrent requests for same key share one HTTP call
const inFlight = new Map<string, Promise<KlineData[] | null>>();

function cacheKey(symbol: string, interval: string): string {
  return `bybit:${symbol}:${interval}`;
}

// ─── klines ───────────────────────────────────────────────────────────────────
export async function getBybitKlines(
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
  const bybitInterval = toBybitInterval(interval);
  const intervalMs: Record<string, number> = {
    "1m":  60_000,     "3m":   180_000,  "5m":   300_000,
    "15m": 900_000,    "30m":  1_800_000,"1h":  3_600_000,
    "2h":  7_200_000,  "4h": 14_400_000, "6h": 21_600_000,
    "12h": 43_200_000, "1d": 86_400_000, "1w": 604_800_000,
  };
  const ms = intervalMs[interval] ?? 3_600_000;

  try {
    const res = await client.get<BybitKlineResponse>("/kline", {
      params: { category: "spot", symbol, interval: bybitInterval, limit },
    });
    if (res.data.retCode !== 0) {
      logger.warn(
        { symbol, retCode: res.data.retCode, retMsg: res.data.retMsg },
        "Bybit klines non-zero retCode",
      );
      return null;
    }
    const list = res.data.result?.list;
    if (!list || list.length < 10) {
      logger.warn({ symbol, count: list?.length ?? 0 }, "Bybit klines: too few candles");
      return null;
    }
    // Bybit returns newest-first → reverse to oldest-first
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
    logger.warn({ symbol, err: (err as Error).message }, "Bybit klines request failed");
    return null;
  }
}

// ─── tickers ─────────────────────────────────────────────────────────────────
export async function getBybitTickers(symbols: string[]): Promise<Map<string, Ticker24h>> {
  const result = new Map<string, Ticker24h>();
  // Bybit returns ALL spot tickers in one call — very efficient
  try {
    const res = await client.get<BybitTickerResponse>("/tickers", {
      params: { category: "spot" },
    });
    if (res.data.retCode !== 0) return result;
    const list = res.data.result?.list ?? [];
    const symbolSet = new Set(symbols);
    for (const t of list) {
      if (!symbolSet.has(t.symbol)) continue;
      const change = (parseFloat(t.lastPrice) - parseFloat(t.prevPrice24h)).toFixed(8);
      result.set(t.symbol, {
        symbol:             t.symbol,
        lastPrice:          t.lastPrice,
        priceChange:        change,
        priceChangePercent: (parseFloat(t.price24hPcnt) * 100).toFixed(4),
        volume:             t.volume24h,
        highPrice:          t.highPrice24h,
        lowPrice:           t.lowPrice24h,
      });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Bybit tickers request failed");
  }
  return result;
}
