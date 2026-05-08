/**
 * MEXC public market data API — cloud-friendly, no API key needed.
 * Binance-compatible format, same symbol names (BTCUSDT, ETHUSDT, etc.)
 * Used as primary fallback when Binance is unavailable (works from Replit production).
 *
 * Rate limits: 20 req/s for public endpoints — suitable for 20-symbol load.
 */
import axios from "axios";
import { logger } from "./logger";
import type { KlineData, Ticker24h } from "./binance";

const MEXC_BASE = "https://api.mexc.com/api/v3";

const client = axios.create({
  baseURL: MEXC_BASE,
  timeout: 8000,
});

interface MexcKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
}

const INTERVAL_MAP: Record<string, string> = {
  "1m":  "1m",
  "5m":  "5m",
  "15m": "15m",
  "30m": "30m",
  "1h":  "60m",
  "2h":  "2h",
  "4h":  "4h",
  "6h":  "6h",
  "12h": "12h",
  "1d":  "1d",
  "1w":  "1W",
};

const klinesCache = new Map<string, { data: KlineData[]; expiresAt: number }>();
const CACHE_TTL_MS = 4 * 60 * 1000;

export async function getMexcKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<KlineData[] | null> {
  const key = `mexc:${symbol}:${interval}`;
  const cached = klinesCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const mexcInterval = INTERVAL_MAP[interval] ?? "60m";
  try {
    const res = await client.get<unknown[][]>("/klines", {
      params: { symbol, interval: mexcInterval, limit },
    });
    if (!Array.isArray(res.data) || res.data.length === 0) return null;

    const klines: KlineData[] = res.data.map((k) => ({
      openTime:  k[0] as number,
      open:      String(k[1]),
      high:      String(k[2]),
      low:       String(k[3]),
      close:     String(k[4]),
      volume:    String(k[5]),
      closeTime: k[6] as number,
    }));

    klinesCache.set(key, { data: klines, expiresAt: Date.now() + CACHE_TTL_MS });
    return klines;
  } catch (err) {
    logger.warn({ symbol, interval, err: (err as Error).message }, "MEXC klines request failed");
    return null;
  }
}

const tickersCache = new Map<string, { data: Ticker24h; expiresAt: number }>();

export async function getMexcTickers(symbols: string[]): Promise<Map<string, Ticker24h>> {
  const result = new Map<string, Ticker24h>();
  const toFetch = symbols.filter((s) => {
    const c = tickersCache.get(s);
    if (c && Date.now() < c.expiresAt) { result.set(s, c.data); return false; }
    return true;
  });

  if (toFetch.length === 0) return result;

  try {
    const res = await client.get<Array<{
      symbol: string; lastPrice: string; priceChange: string;
      priceChangePercent: string; volume: string; highPrice: string; lowPrice: string;
    }>>("/ticker/24hr");

    if (Array.isArray(res.data)) {
      const bySymbol = new Map(res.data.map((t) => [t.symbol, t]));
      for (const sym of toFetch) {
        const t = bySymbol.get(sym);
        if (t) {
          const ticker: Ticker24h = {
            symbol:             t.symbol,
            lastPrice:          t.lastPrice,
            priceChange:        t.priceChange,
            priceChangePercent: t.priceChangePercent,
            volume:             t.volume,
            highPrice:          t.highPrice,
            lowPrice:           t.lowPrice,
          };
          tickersCache.set(sym, { data: ticker, expiresAt: Date.now() + CACHE_TTL_MS });
          result.set(sym, ticker);
        }
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "MEXC tickers batch request failed");
  }

  return result;
}
