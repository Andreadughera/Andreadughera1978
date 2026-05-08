/**
 * Crypto.com Exchange public market data API.
 * No authentication required — works globally without geo-restrictions.
 * Used as real-data fallback when Binance US is unavailable.
 */
import axios from "axios";
import { logger } from "./logger";
import type { KlineData, Ticker24h } from "./binance";

const CDC_PUBLIC_BASE = "https://api.crypto.com/exchange/v1/public";

const cdcPublicClient = axios.create({
  baseURL: CDC_PUBLIC_BASE,
  timeout: 5000,
});

interface CdcCandle {
  o: string; // open
  h: string; // high
  l: string; // low
  c: string; // close
  v: string; // volume
  t: number; // timestamp ms
}

interface CdcCandleResponse {
  code: number;
  result: {
    interval: string;
    data: CdcCandle[];
    instrument_name: string;
  };
}

/** Maps Binance-style symbol to CDC instrument name using USD pairs.
 *  BTCUSDT → BTC_USD, ETHUSDT → ETH_USD, etc. */
export function binanceToCdcMarket(symbol: string): string {
  if (symbol.endsWith("USDT")) return `${symbol.slice(0, -4)}_USD`;
  if (symbol.endsWith("BTC")) return `${symbol.slice(0, -3)}_BTC`;
  return symbol;
}

/** Maps CDC timeframe string from Binance interval string. */
function tocdcTimeframe(interval: string): string {
  const map: Record<string, string> = {
    "1m": "1m", "5m": "5m", "15m": "15m",
    "1h": "1h", "4h": "4h", "1d": "1D",
  };
  return map[interval] ?? "1h";
}

/** Fetch real OHLCV candles from CDC public API.
 *  Returns KlineData[] in the same format as Binance. */
export async function getCdcKlines(
  symbol: string,
  interval: string,
  count: number,
): Promise<KlineData[] | null> {
  const instrument = binanceToCdcMarket(symbol);
  const timeframe = tocdcTimeframe(interval);

  try {
    const res = await cdcPublicClient.get<CdcCandleResponse>("/get-candlestick", {
      params: { instrument_name: instrument, timeframe, count },
    });

    if (res.data.code !== 0) return null;

    const candles = res.data.result?.data ?? [];
    if (candles.length === 0) return null;

    const klines: KlineData[] = candles.map((c) => ({
      openTime: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: c.v,
      closeTime: c.t + 3_600_000,
    }));

    logger.debug({ symbol, instrument, count: klines.length }, "CDC real market data loaded");
    return klines;
  } catch (err) {
    logger.warn({ symbol, instrument, err: (err as Error).message }, "CDC public candlestick fetch failed");
    return null;
  }
}

/** Derive a Ticker24h from CDC candlestick data (last 25 hourly candles). */
export async function getCdcTicker24h(symbol: string): Promise<Ticker24h | null> {
  const klines = await getCdcKlines(symbol, "1h", 25);
  if (!klines || klines.length < 2) return null;

  const last = klines[klines.length - 1];
  const prev24h = klines[0]; // 24 candles ago ≈ 24h ago

  const lastPrice = parseFloat(last.close);
  const price24hAgo = parseFloat(prev24h.open);
  const priceChange = lastPrice - price24hAgo;
  const priceChangePercent = ((priceChange / price24hAgo) * 100);

  const highPrice = Math.max(...klines.map((k) => parseFloat(k.high)));
  const lowPrice = Math.min(...klines.map((k) => parseFloat(k.low)));
  const volume = klines.reduce((acc, k) => acc + parseFloat(k.volume), 0);

  return {
    symbol,
    lastPrice: lastPrice.toFixed(8),
    priceChange: priceChange.toFixed(8),
    priceChangePercent: priceChangePercent.toFixed(4),
    volume: volume.toFixed(3),
    highPrice: highPrice.toFixed(8),
    lowPrice: lowPrice.toFixed(8),
  };
}

/** Fetch real tickers for multiple symbols using CDC public API. */
export async function getCdcTickers(symbols: string[]): Promise<Ticker24h[]> {
  const results: Ticker24h[] = [];
  await Promise.allSettled(
    symbols.map(async (symbol) => {
      const ticker = await getCdcTicker24h(symbol);
      if (ticker) results.push(ticker);
    }),
  );
  return results;
}
