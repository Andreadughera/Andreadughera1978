/**
 * CryptoCompare public market data API — global, no geo-restrictions, no API key needed.
 * Used as tertiary fallback when both Binance and CDC public APIs are unavailable.
 *
 * Includes a 5-minute in-memory cache to avoid hammering the free-tier rate limit
 * when 20 symbols are computed in parallel (each requesting 1h + 4h candles).
 */
import axios from "axios";
import { logger } from "./logger";
import type { KlineData, Ticker24h } from "./binance";

const CC_BASE = "https://min-api.cryptocompare.com/data";

const ccClient = axios.create({ baseURL: CC_BASE, timeout: 12000 });

// ─── kline cache ────────────────────────────────────────────────────────────
interface CacheEntry {
  data: KlineData[];
  expiresAt: number;
}
const klinesCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(symbol: string, interval: string): string {
  return `${symbol}:${interval}`;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function symbolToBase(symbol: string): string {
  if (symbol.endsWith("USDT")) return symbol.slice(0, -4);
  if (symbol.endsWith("USD"))  return symbol.slice(0, -3);
  if (symbol.endsWith("BTC"))  return symbol.slice(0, -3);
  return symbol;
}

function ccIntervalToEndpoint(interval: string): { endpoint: string; aggregate: number } {
  const map: Record<string, { endpoint: string; aggregate: number }> = {
    "1m":  { endpoint: "/v2/histominute", aggregate: 1  },
    "5m":  { endpoint: "/v2/histominute", aggregate: 5  },
    "15m": { endpoint: "/v2/histominute", aggregate: 15 },
    "1h":  { endpoint: "/v2/histohour",   aggregate: 1  },
    "4h":  { endpoint: "/v2/histohour",   aggregate: 4  },
    "1d":  { endpoint: "/v2/histoday",    aggregate: 1  },
  };
  return map[interval] ?? { endpoint: "/v2/histohour", aggregate: 1 };
}

interface CcHistoResponse {
  Response: string;
  Message?: string;
  Data: {
    Data: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volumefrom: number;
    }>;
  };
}

interface CcPriceResponse {
  [fsym: string]: {
    USD: {
      PRICE: number;
      CHANGE24HOUR: number;
      CHANGEPCT24HOUR: number;
      HIGH24HOUR: number;
      LOW24HOUR: number;
      VOLUME24HOUR: number;
    };
  };
}

// ─── in-flight deduplication ─────────────────────────────────────────────────
// Prevents 2 concurrent calls for the same symbol+interval from both hitting the API.
const inFlight = new Map<string, Promise<KlineData[] | null>>();

export async function getCcKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<KlineData[] | null> {
  const key = cacheKey(symbol, interval);

  // Return cached data if still fresh
  const cached = klinesCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // Deduplicate concurrent requests for the same key
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = _fetchCcKlines(symbol, interval, limit);
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

async function _fetchCcKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<KlineData[] | null> {
  const base = symbolToBase(symbol);
  const { endpoint, aggregate } = ccIntervalToEndpoint(interval);
  try {
    const res = await ccClient.get<CcHistoResponse>(endpoint, {
      params: { fsym: base, tsym: "USD", limit, aggregate },
    });
    if (res.data.Response !== "Success") {
      logger.warn(
        { symbol, response: res.data.Response, message: res.data.Message ?? "" },
        "CryptoCompare klines non-success response",
      );
      return null;
    }
    const candles = res.data.Data.Data;
    if (!candles || candles.length < 10) {
      logger.warn({ symbol, count: candles?.length ?? 0 }, "CryptoCompare klines: too few candles");
      return null;
    }
    const intervalMs: Record<string, number> = {
      "1m": 60_000, "5m": 300_000, "15m": 900_000,
      "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
    };
    const ms = intervalMs[interval] ?? 3_600_000;
    const result = candles.map((c) => ({
      openTime:  c.time * 1000,
      open:      c.open.toFixed(8),
      high:      c.high.toFixed(8),
      low:       c.low.toFixed(8),
      close:     c.close.toFixed(8),
      volume:    c.volumefrom.toFixed(2),
      closeTime: c.time * 1000 + ms - 1,
    }));
    // Store in cache
    klinesCache.set(cacheKey(symbol, interval), {
      data: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return result;
  } catch (err) {
    logger.warn({ symbol, err: (err as Error).message }, "CryptoCompare klines request failed");
    return null;
  }
}

export async function getCcTickers(symbols: string[]): Promise<Map<string, Ticker24h>> {
  const bases = [...new Set(symbols.map(symbolToBase))];
  const result = new Map<string, Ticker24h>();
  try {
    const res = await ccClient.get<CcPriceResponse>("/pricemultifull", {
      params: { fsyms: bases.join(","), tsyms: "USD" },
    });
    const raw = res.data as Record<string, unknown>;
    const display = raw["RAW"] as CcPriceResponse | undefined;
    if (!display) return result;
    for (const sym of symbols) {
      const base = symbolToBase(sym);
      const data = display[base]?.USD;
      if (!data) continue;
      result.set(sym, {
        symbol:             sym,
        lastPrice:          data.PRICE.toFixed(8),
        priceChange:        data.CHANGE24HOUR.toFixed(8),
        priceChangePercent: data.CHANGEPCT24HOUR.toFixed(4),
        volume:             data.VOLUME24HOUR.toFixed(2),
        highPrice:          data.HIGH24HOUR.toFixed(8),
        lowPrice:           data.LOW24HOUR.toFixed(8),
      });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "CryptoCompare tickers failed");
  }
  return result;
}
