import axios from "axios";
import { logger } from "./logger";
import { getCdcKlines, getCdcTicker24h } from "./cdcMarket";
import { getOkxKlines, getOkxTickers } from "./okx";
import { getMexcKlines, getMexcTickers } from "./mexc";
import { getGateKlines, getGateTickers } from "./gateio";
import { getFearGreedIndex, getFgConfidenceBonus, recordVolumeSpike } from "./sentiment";
import { getSmartMoney } from "./smartMoney";

const BINANCE_GLOBAL_BASE = "https://api.binance.com/api/v3";

const client = axios.create({
  baseURL: BINANCE_GLOBAL_BASE,
  timeout: 8000,
});

export const TRACKED_SYMBOLS = [
  // Large/liquid spot pairs that are tradable on Crypto.com Exchange.
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT",
  "XRPUSDT", "DOTUSDT", "LINKUSDT", "AVAXUSDT",
  "UNIUSDT", "ATOMUSDT", "LTCUSDT", "NEARUSDT",
  "APTUSDT", "ALGOUSDT", "DOGEUSDT", "FILUSDT",
  "POLUSDT", "BCHUSDT", "XLMUSDT", "CROUSDT",
];

const MOCK_BASE_PRICES: Record<string, number> = {
  BTCUSDT:   62430,
  ETHUSDT:   3015,
  SOLUSDT:   147,
  ADAUSDT:   0.452,
  XRPUSDT:   0.512,
  DOTUSDT:   7.21,
  LINKUSDT:  14.82,
  AVAXUSDT:  35.0,
  UNIUSDT:   7.0,
  ATOMUSDT:  6.0,
  LTCUSDT:   90.0,
  NEARUSDT:  3.0,
  APTUSDT:   7.0,
  ALGOUSDT:  0.18,
  DOGEUSDT:  0.15,
  FILUSDT:   4.5,
  POLUSDT:   0.38,
  BCHUSDT:   450,
  XLMUSDT:   0.12,
  CROUSDT:   0.11,
};

export interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  volume: string;
  highPrice: string;
  lowPrice: string;
}

export interface KlineData {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return ((s >>> 0) / 0xffffffff);
  };
}

function generateMockKlines(symbol: string, interval: string, limit: number): KlineData[] {
  const basePrice = MOCK_BASE_PRICES[symbol] ?? 100;
  const intervalMs: Record<string, number> = {
    "1m": 60_000, "5m": 300_000, "15m": 900_000,
    "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
  };
  const ms = intervalMs[interval] ?? 3_600_000;

  const now = Date.now();
  const rand = seededRandom(Date.now() >> 16);
  const klines: KlineData[] = [];

  let price = basePrice * (0.9 + rand() * 0.2);
  for (let i = limit; i >= 0; i--) {
    const openTime = now - i * ms;
    const closeTime = openTime + ms - 1;
    const change = (rand() - 0.49) * 0.025 * price;
    const open = price;
    price = Math.max(price + change, price * 0.001);
    const high = Math.max(open, price) * (1 + rand() * 0.01);
    const low = Math.min(open, price) * (1 - rand() * 0.01);
    const volume = basePrice > 1000
      ? (rand() * 500 + 50).toFixed(3)
      : (rand() * 500_000 + 50_000).toFixed(2);

    klines.push({
      openTime,
      open: open.toFixed(8),
      high: high.toFixed(8),
      low: low.toFixed(8),
      close: price.toFixed(8),
      volume,
      closeTime,
    });
  }
  return klines;
}

function generateMockTicker(symbol: string): Ticker24h {
  const base = MOCK_BASE_PRICES[symbol] ?? 100;
  const rand = seededRandom(Date.now() >> 15);
  const changePct = (rand() - 0.45) * 8;
  const lastPrice = base * (1 + changePct / 100);
  const priceChange = lastPrice - base;
  const high = lastPrice * (1 + rand() * 0.03);
  const low = lastPrice * (1 - rand() * 0.03);
  const volume = base > 1000
    ? (rand() * 8000 + 2000).toFixed(3)
    : (rand() * 80_000_000 + 10_000_000).toFixed(2);

  return {
    symbol,
    lastPrice: lastPrice.toFixed(8),
    priceChange: priceChange.toFixed(8),
    priceChangePercent: changePct.toFixed(4),
    volume,
    highPrice: high.toFixed(8),
    lowPrice: low.toFixed(8),
  };
}

function allowMockMarketData(): boolean {
  return process.env.ALLOW_MOCK_MARKET_DATA === "true" || process.env.NODE_ENV !== "production";
}

function getMockTicker(symbol: string): Ticker24h {
  if (!allowMockMarketData()) {
    throw new Error(`Real market data unavailable for ${symbol}; mock ticker disabled in production`);
  }
  return generateMockTicker(symbol);
}

function getMockKlines(symbol: string, interval: string, limit: number): KlineData[] {
  if (!allowMockMarketData()) {
    throw new Error(`Real market data unavailable for ${symbol}; mock klines disabled in production`);
  }
  return generateMockKlines(symbol, interval, limit);
}

let apiAvailable: boolean | null = null;
let apiCheckedAt = 0;
const API_CHECK_TTL_MS = 10 * 60_000; // re-check every 10 minutes

async function checkApiAvailability(): Promise<boolean> {
  const now = Date.now();
  if (apiAvailable !== null && now - apiCheckedAt < API_CHECK_TTL_MS) return apiAvailable;
  try {
    await client.get("/ping", { timeout: 5000 });
    apiAvailable = true;
    apiCheckedAt = now;
    logger.info("Binance global API is accessible — using Binance data");
  } catch {
    apiAvailable = false;
    apiCheckedAt = now;
    logger.info("Binance global not accessible — using CDC/OKX market data fallback");
  }
  return apiAvailable;
}

export async function get24hTickers(symbols: string[]): Promise<Ticker24h[]> {
  const available = await checkApiAvailability();

  if (!available) {
    // 1. Gate.io — cloud-friendly, covers 18/20 symbols
    const gateTickers = await getGateTickers(symbols);
    const afterGate = symbols.filter((s) => !gateTickers.has(s));

    if (afterGate.length === 0) return symbols.map((s) => gateTickers.get(s)!);

    // 2. MEXC for anything Gate.io missed
    const mexcTickers = await getMexcTickers(afterGate);
    const afterMexc = afterGate.filter((s) => !mexcTickers.has(s));

    const results: Ticker24h[] = [
      ...symbols.map((s) => gateTickers.get(s)).filter(Boolean) as Ticker24h[],
      ...afterGate.map((s) => mexcTickers.get(s)).filter(Boolean) as Ticker24h[],
    ];

    if (afterMexc.length === 0) return results;

    // 3. OKX + CDC last resort
    const okxTickers = await getOkxTickers(afterMexc);
    await Promise.allSettled(
      afterMexc.map(async (symbol) => {
        if (okxTickers.has(symbol)) { results.push(okxTickers.get(symbol)!); return; }
        const cdcTicker = await getCdcTicker24h(symbol);
        if (cdcTicker) { results.push(cdcTicker); return; }
        logger.warn({ symbol }, "All ticker sources unavailable");
        results.push(getMockTicker(symbol));
      }),
    );
    return results;
  }

  const results: Ticker24h[] = [];
  for (const symbol of symbols) {
    try {
      const res = await client.get<Ticker24h>("/ticker/24hr", { params: { symbol } });
      results.push(res.data);
    } catch (err) {
      logger.warn({ symbol, err: (err as Error).message }, "Binance ticker failed, trying CDC");
      const cdcTicker = await getCdcTicker24h(symbol);
      if (cdcTicker) {
        results.push(cdcTicker);
      } else {
        const okxMap = await getOkxTickers([symbol]);
        results.push(okxMap.get(symbol) ?? getMockTicker(symbol));
      }
    }
  }
  return results;
}

export async function getKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<KlineData[]> {
  const available = await checkApiAvailability();

  if (!available) {
    // 1. Gate.io — cloud-friendly, confirmed working from Replit production
    const gateKlines = await getGateKlines(symbol, interval, limit);
    if (gateKlines && gateKlines.length >= 20) return gateKlines;

    // 2. MEXC fallback
    const mexcKlines = await getMexcKlines(symbol, interval, limit);
    if (mexcKlines && mexcKlines.length >= 20) return mexcKlines;

    // 3. CDC + OKX last resort
    const [cdcResult, okxResult] = await Promise.allSettled([
      getCdcKlines(symbol, interval, limit),
      getOkxKlines(symbol, interval, limit),
    ]);
    const cdcKlines = cdcResult.status === "fulfilled" ? cdcResult.value : null;
    const okxKlines = okxResult.status === "fulfilled" ? okxResult.value : null;
    if (cdcKlines && cdcKlines.length >= 20) return cdcKlines;
    if (okxKlines && okxKlines.length >= 20) return okxKlines;
    logger.warn({ symbol }, "All kline sources unavailable");
    return getMockKlines(symbol, interval, limit);
  }

  try {
    const res = await client.get<unknown[][]>("/klines", {
      params: { symbol, interval, limit },
    });
    return res.data.map((k) => ({
      openTime: k[0] as number,
      open: k[1] as string,
      high: k[2] as string,
      low: k[3] as string,
      close: k[4] as string,
      volume: k[5] as string,
      closeTime: k[6] as number,
    }));
  } catch (err) {
    logger.warn({ symbol, err: (err as Error).message }, "Binance klines failed, trying MEXC/CDC/OKX");
    const mexcKlines = await getMexcKlines(symbol, interval, limit);
    if (mexcKlines && mexcKlines.length >= 20) return mexcKlines;
    const [cdcResult, okxResult] = await Promise.allSettled([
      getCdcKlines(symbol, interval, limit),
      getOkxKlines(symbol, interval, limit),
    ]);
    const cdcKlines = cdcResult.status === "fulfilled" ? cdcResult.value : null;
    const okxKlines = okxResult.status === "fulfilled" ? okxResult.value : null;
    if (cdcKlines && cdcKlines.length >= 20) return cdcKlines;
    return okxKlines ?? getMockKlines(symbol, interval, limit);
  }
}

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential Moving Average — weights recent prices more heavily than SMA. */
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

/** Bollinger Bands (20-period, 2 std dev).
 *  price < lower → oversold BUY zone.  price > upper → overbought SELL zone. */
export function calculateBollingerBands(
  closes: number[],
  period = 20,
): { upper: number; middle: number; lower: number; pctB: number } {
  if (closes.length < period) {
    const last = closes[closes.length - 1] ?? 0;
    return { upper: last, middle: last, lower: last, pctB: 0.5 };
  }
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, v) => a + Math.pow(v - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + 2 * stdDev;
  const lower = middle - 2 * stdDev;
  const price = closes[closes.length - 1];
  const pctB = stdDev > 0 ? (price - lower) / (upper - lower) : 0.5;
  return { upper, middle, lower, pctB };
}

/** Stochastic RSI — applies stochastic formula over RSI values.
 *  < 0.2 = oversold (BUY), > 0.8 = overbought (SELL).
 *  More sensitive than plain RSI for catching reversals early.
 *
 *  IMPORTANT: uses a true SLIDING WINDOW for RSI so that each point in the
 *  RSI series reflects only the last `rsiPeriod` price changes (not cumulative
 *  data from bar 0). Without this, all RSI values converge and StochRSI → 0.5. */
export function calculateStochRSI(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
): number {
  // Need enough candles for rsiPeriod + stochPeriod sliding windows
  if (closes.length < rsiPeriod + stochPeriod) return 0.5;

  // Build RSI series using a true sliding window (rsiPeriod+1 closes per point)
  const rsiSeries: number[] = [];
  for (let i = rsiPeriod; i < closes.length; i++) {
    rsiSeries.push(calculateRSI(closes.slice(i - rsiPeriod, i + 1)));
  }

  if (rsiSeries.length < stochPeriod) return 0.5;
  const recent = rsiSeries.slice(-stochPeriod);
  const minRsi = Math.min(...recent);
  const maxRsi = Math.max(...recent);
  if (Math.abs(maxRsi - minRsi) < 0.001) return 0.5;
  return (rsiSeries[rsiSeries.length - 1] - minRsi) / (maxRsi - minRsi);
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  prevHistogram: number;
}

/** MACD (12/26/9) — measures momentum via difference of two EMAs.
 *  Histogram crossing zero = trend shift. Positive = bullish momentum. */
export function calculateMACD(closes: number[]): MACDResult {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0, prevHistogram: 0 };
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calculateEMA(macdLine.slice(25), 9);
  const len = macdLine.length;
  const slen = signalLine.length;
  const macdVal = macdLine[len - 1];
  const signalVal = signalLine[slen - 1];
  const prevMacd = macdLine[len - 2];
  const prevSignal = signalLine[slen - 2];
  return {
    macd: macdVal,
    signal: signalVal,
    histogram: macdVal - signalVal,
    prevHistogram: prevMacd - prevSignal,
  };
}

/** Average True Range — measures market volatility.
 *  Higher ATR = more volatile asset. Used for dynamic stop-loss sizing. */
export function calculateATR(klines: KlineData[], period = 14): number {
  if (klines.length < period + 1) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i].high);
    const low = parseFloat(klines[i].low);
    const prevClose = parseFloat(klines[i - 1].close);
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }
  return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export interface TradingSignal {
  symbol: string;
  type: "BUY" | "SELL" | "HOLD";
  price: number;
  rsi: number;
  maShort: number;
  maLong: number;
  confidence: number;
  reason: string;
  atr: number;
  stochRsi: number;  // 0-1 StochRSI for display
  bbPctB: number;    // 0-1 Bollinger %B for display
}

/**
 * Advanced signal computation using 7 independent indicators + 4h trend filter.
 *
 * Indicators:
 *  1. RSI (14)          — < 40 bullish, > 60 bearish
 *  2. MA crossover 1h   — MA10 vs MA50
 *  3. MACD histogram    — positive bullish, negative bearish
 *  4. StochRSI          — < 0.2 oversold BUY, > 0.8 overbought SELL
 *  5. Bollinger %B      — < 0.1 below lower band BUY, > 0.9 above upper SELL
 *  6. Funding Rate      — negative = shorts paying = bullish; positive extreme = overextended longs
 *  7. Whale Activity    — net buyer/seller volume from large trades ($20k+)
 *
 * Thresholds (based on 4h trend):
 *  - BULL  4h: 4/7 votes enough (trend confirmation = lower bar for entry)
 *  - NEUTRAL: 5/7 votes (stricter, higher quality)
 *  - Counter-trend (4h disagrees): all 7 must agree
 *
 * Bonus: volume, Fear & Greed, alignment count
 */
export async function computeSignal(symbol: string): Promise<TradingSignal | null> {
  const [klines1h, klines4h, tickers, fearGreed, smartMoney] = await Promise.all([
    getKlines(symbol, "1h", 150),
    getKlines(symbol, "4h", 60),
    get24hTickers([symbol]),
    getFearGreedIndex(),
    getSmartMoney(symbol),
  ]);

  if (klines1h.length < 60) return null;

  const closes1h = klines1h.map((k) => parseFloat(k.close));
  const price = closes1h[closes1h.length - 1];

  const rsi      = calculateRSI(closes1h);
  const maShort  = calculateSMA(closes1h, 10);
  const maLong   = calculateSMA(closes1h, 50);
  const macd     = calculateMACD(closes1h);
  const atr      = calculateATR(klines1h);
  const bb       = calculateBollingerBands(closes1h);
  const stochRsi = calculateStochRSI(closes1h);

  // ── 4h trend direction ────────────────────────────────────────────────────
  let trend4h: "BULL" | "BEAR" | "NEUTRAL" = "NEUTRAL";
  if (klines4h.length >= 50) {
    const closes4h = klines4h.map((k) => parseFloat(k.close));
    const ma20_4h = calculateSMA(closes4h, 20);
    const ma50_4h = calculateSMA(closes4h, 50);
    trend4h = ma20_4h > ma50_4h ? "BULL" : "BEAR";
  }

  // ── Volume confirmation + whale spike detection ────────────────────────────
  const volumes = klines1h.map((k) => parseFloat(k.volume));
  const avgVol = calculateSMA(volumes, 20);
  const lastVol = volumes[volumes.length - 1];
  const highVolume = avgVol > 0 && lastVol > avgVol * 1.5;
  const volMultiplier = avgVol > 0 ? lastVol / avgVol : 1;

  // ── Indicator votes ────────────────────────────────────────────────────────
  // RSI thresholds: < 35 oversold BUY, > 65 overbought SELL
  const rsiVote      = rsi < 35        ? "BUY" : rsi > 65        ? "SELL" : "HOLD";
  const maVote       = maShort > maLong ? "BUY" : maShort < maLong ? "SELL" : "HOLD";
  const macdVote     = macd.histogram > 0 ? "BUY" : macd.histogram < 0 ? "SELL" : "HOLD";
  const stochVote    = stochRsi < 0.2  ? "BUY" : stochRsi > 0.8  ? "SELL" : "HOLD";
  const bbVote       = bb.pctB < 0.15  ? "BUY" : bb.pctB > 0.85  ? "SELL" : "HOLD";
  const fundingVote  = smartMoney.fundingVote;
  const whaleVote    = smartMoney.whaleVote;

  const votes     = [rsiVote, maVote, macdVote, stochVote, bbVote, fundingVote, whaleVote];
  const buyVotes  = votes.filter((v) => v === "BUY").length;
  const sellVotes = votes.filter((v) => v === "SELL").length;

  const whaleSuffix = smartMoney.whaleVote !== "HOLD"
    ? ` Whale${smartMoney.whaleVote === "BUY" ? "↑" : "↓"}($${(Math.max(smartMoney.whaleBuyUsd, smartMoney.whaleSellUsd) / 1000).toFixed(0)}k)`
    : "";
  const fundingSuffix = smartMoney.fundingRate !== 0
    ? ` FR${(smartMoney.fundingRate * 100).toFixed(3)}%`
    : "";

  let type: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 50;
  let reason = `HOLD — RSI ${rsi.toFixed(1)}, MA ${maShort > maLong ? "bullish" : "bearish"}, 4h ${trend4h}`;

  // ── Primary signal: RSI-driven ─────────────────────────────────────────────
  // RSI < 35 → BUY regardless of other votes (oversold condition)
  // RSI > 65 → SELL regardless of other votes (overbought condition)
  // Otherwise fall back to vote majority (threshold = 3/7)
  const rsiBuySignal  = rsi < 35;
  const rsiSellSignal = rsi > 65;
  const votesBuySignal  = buyVotes  >= 3 && buyVotes  > sellVotes;
  const votesSellSignal = sellVotes >= 3 && sellVotes > buyVotes;

  if (rsiBuySignal || votesBuySignal) {
    type = "BUY";
    // RSI score: deeper oversold = higher base confidence (60–75 from RSI alone)
    const rsiDepth   = rsiBuySignal ? Math.min(15, Math.round((35 - rsi) * 1.5)) : 0;
    // MA crossover: +10% if short MA > long MA (bullish structure)
    const maBonus    = maShort > maLong ? 10 : 0;
    const macdBonus  = macdVote  === "BUY" ? Math.min(6, Math.round(Math.abs(macd.histogram / price) * 4000)) : 0;
    const stochBonus = stochVote === "BUY" ? Math.min(5, Math.round((0.2 - stochRsi) * 25)) : 0;
    const bbBonus    = bbVote    === "BUY" ? Math.min(4, Math.round((0.15 - bb.pctB) * 27)) : 0;
    const fundingBonus = fundingVote === "BUY" ? 4 : 0;
    const whaleBonus   = whaleVote   === "BUY" ? Math.min(6, Math.round(Math.log10(Math.max(smartMoney.whaleBuyUsd / 1000, 1)) * 3)) : 0;
    const trendBonus   = trend4h === "BULL" ? 5 : 0;
    const volBonus     = highVolume ? 3 : 0;
    const fgBonus      = getFgConfidenceBonus(fearGreed.value, "BUY");
    confidence = Math.min(85, Math.max(60, 60 + rsiDepth + maBonus + macdBonus + stochBonus + bbBonus + fundingBonus + whaleBonus + trendBonus + volBonus + fgBonus));
    reason = `BUY — RSI ${rsi.toFixed(1)}${rsiBuySignal ? " (oversold)" : ""}, MA ${maShort > maLong ? "bullish↑" : "neutral"}, ${buyVotes}/7 votes, 4h ${trend4h}${highVolume ? " HiVol" : ""}${whaleSuffix}${fundingSuffix}`;
    if (volMultiplier >= 2.5) recordVolumeSpike(symbol, volMultiplier, lastVol, avgVol, "BUY", price);

  } else if (rsiSellSignal || votesSellSignal) {
    type = "SELL";
    const rsiDepth   = rsiSellSignal ? Math.min(15, Math.round((rsi - 65) * 1.5)) : 0;
    const maBonus    = maShort < maLong ? 10 : 0;
    const macdBonus  = macdVote  === "SELL" ? Math.min(6, Math.round(Math.abs(macd.histogram / price) * 4000)) : 0;
    const stochBonus = stochVote === "SELL" ? Math.min(5, Math.round((stochRsi - 0.8) * 25)) : 0;
    const bbBonus    = bbVote    === "SELL" ? Math.min(4, Math.round((bb.pctB - 0.85) * 27)) : 0;
    const fundingBonus = fundingVote === "SELL" ? 4 : 0;
    const whaleBonus   = whaleVote   === "SELL" ? Math.min(6, Math.round(Math.log10(Math.max(smartMoney.whaleSellUsd / 1000, 1)) * 3)) : 0;
    const trendBonus   = trend4h === "BEAR" ? 5 : 0;
    const volBonus     = highVolume ? 3 : 0;
    const fgBonus      = getFgConfidenceBonus(fearGreed.value, "SELL");
    confidence = Math.min(85, Math.max(60, 60 + rsiDepth + maBonus + macdBonus + stochBonus + bbBonus + fundingBonus + whaleBonus + trendBonus + volBonus + fgBonus));
    reason = `SELL — RSI ${rsi.toFixed(1)}${rsiSellSignal ? " (overbought)" : ""}, MA ${maShort < maLong ? "bearish↓" : "neutral"}, ${sellVotes}/7 votes, 4h ${trend4h}${highVolume ? " HiVol" : ""}${whaleSuffix}${fundingSuffix}`;
    if (volMultiplier >= 2.5) recordVolumeSpike(symbol, volMultiplier, lastVol, avgVol, "SELL", price);
  }

  return { symbol, type, price, rsi, maShort, maLong, confidence, reason, atr, stochRsi, bbPctB: bb.pctB };
}
