/**
 * Gate.io public market data — cloud-friendly, no API key, no geo-block.
 * Works reliably from Replit production servers.
 * Covers 18/20 tracked symbols (MATIC and FTM delisted on Gate.io).
 *
 * Candle format: [timestamp_s, quote_vol, close, high, low, open, base_vol, is_closed]
 * Ticker format: { currency_pair, last, change_percentage, base_volume, high_24h, low_24h }
 */
import axios from "axios";
import { logger } from "./logger";
import type { KlineData, Ticker24h } from "./binance";

const BASE = "https://api.gateio.ws/api/v4/spot";

const client = axios.create({ baseURL: BASE, timeout: 8000 });

// Convert Binance-style symbol to Gate.io pair: BTCUSDT → BTC_USDT
function toGatePair(symbol: string): string | null {
  if (!symbol.endsWith("USDT")) return null;
  const base = symbol.slice(0, -4);
  return `${base}_USDT`;
}

const INTERVAL_MAP: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "2h": "2h", "4h": "4h", "6h": "6h",
  "8h": "8h", "12h": "12h", "1d": "1d", "1w": "7d",
};

const INTERVAL_MS: Record<string, number> = {
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

const klinesCache = new Map<string, { data: KlineData[]; expiresAt: number }>();
const KLINE_TTL = 4 * 60 * 1000;

export async function getGateKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<KlineData[] | null> {
  const pair = toGatePair(symbol);
  if (!pair) return null;

  const key = `gate:${symbol}:${interval}`;
  const cached = klinesCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const gInterval = INTERVAL_MAP[interval] ?? "1h";
  const iMs = INTERVAL_MS[interval] ?? 3_600_000;

  try {
    const res = await client.get<string[][]>("/candlesticks", {
      params: { currency_pair: pair, interval: gInterval, limit },
    });
    if (!Array.isArray(res.data) || res.data.length === 0) return null;

    // Gate.io format: [timestamp_s, quote_vol, close, high, low, open, base_vol, is_closed]
    const klines: KlineData[] = res.data.map((k) => {
      const openTime = parseFloat(k[0]) * 1000;
      return {
        openTime,
        open:      k[5],
        high:      k[3],
        low:       k[4],
        close:     k[2],
        volume:    k[6],
        closeTime: openTime + iMs - 1,
      };
    });

    klinesCache.set(key, { data: klines, expiresAt: Date.now() + KLINE_TTL });
    return klines;
  } catch (err) {
    logger.warn({ symbol, interval, err: (err as Error).message }, "Gate.io klines request failed");
    return null;
  }
}

const tickerCache = new Map<string, { data: Ticker24h; expiresAt: number }>();
const TICKER_TTL = 60 * 1000;

async function fetchOneTicker(symbol: string): Promise<Ticker24h | null> {
  const cached = tickerCache.get(symbol);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const pair = toGatePair(symbol);
  if (!pair) return null;

  try {
    const res = await client.get<Array<{
      currency_pair: string;
      last: string;
      change_percentage: string;
      base_volume: string;
      high_24h: string;
      low_24h: string;
    }>>("/tickers", { params: { currency_pair: pair }, timeout: 5000 });

    const t = res.data?.[0];
    if (!t) return null;

    const changePct = parseFloat(t.change_percentage) / 100;
    const last = parseFloat(t.last);
    const ticker: Ticker24h = {
      symbol,
      lastPrice:          t.last,
      priceChange:        (last * changePct).toFixed(8),
      priceChangePercent: changePct.toFixed(4),
      volume:             t.base_volume,
      highPrice:          t.high_24h,
      lowPrice:           t.low_24h,
    };
    tickerCache.set(symbol, { data: ticker, expiresAt: Date.now() + TICKER_TTL });
    return ticker;
  } catch {
    return null;
  }
}

export async function getGateTickers(symbols: string[]): Promise<Map<string, Ticker24h>> {
  const result = new Map<string, Ticker24h>();

  // Fetch each symbol individually — avoids the huge all-tickers response that times out in cloud
  const settled = await Promise.allSettled(symbols.map((s) => fetchOneTicker(s)));
  for (let i = 0; i < symbols.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled" && r.value) result.set(symbols[i], r.value);
  }

  return result;
}
