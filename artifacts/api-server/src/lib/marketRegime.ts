import { getKlines, calculateSMA, calculateEMA, type KlineData } from "./binance";
import { logger } from "./logger";

export type RegimeType = "TRENDING_BULL" | "TRENDING_BEAR" | "RANGING" | "VOLATILE" | "CONSOLIDATING";

export interface MarketRegime {
  regime: RegimeType;
  regimeLabel: string;
  description: string;
  adx: number;
  bbWidth: number;
  btcTrend: "BULL" | "BEAR" | "NEUTRAL";
  tradingAdvice: string;
  updatedAt: string;
}

let regimeCache: { data: MarketRegime; expiresAt: number } | null = null;

/** Compute ADX (Average Directional Index) — trend strength.
 *  ADX > 25 = strong trend. ADX < 20 = ranging/choppy. */
function calculateADX(klines: KlineData[], period = 14): number {
  if (klines.length < period * 2) return 20;

  const trueRanges: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i].high);
    const low = parseFloat(klines[i].low);
    const prevHigh = parseFloat(klines[i - 1].high);
    const prevLow = parseFloat(klines[i - 1].low);
    const prevClose = parseFloat(klines[i - 1].close);

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);

    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Smoothed with Wilder's smoothing (similar to EMA with alpha = 1/period)
  const smooth = (arr: number[], p: number): number[] => {
    const res: number[] = [];
    let sum = arr.slice(0, p).reduce((a, b) => a + b, 0);
    res.push(sum);
    for (let i = p; i < arr.length; i++) {
      sum = sum - sum / p + arr[i];
      res.push(sum);
    }
    return res;
  };

  const smoothedTR = smooth(trueRanges, period);
  const smoothedPDM = smooth(plusDM, period);
  const smoothedMDM = smooth(minusDM, period);

  const dx: number[] = [];
  for (let i = 0; i < smoothedTR.length; i++) {
    const tr = smoothedTR[i];
    if (tr === 0) { dx.push(0); continue; }
    const pDI = (smoothedPDM[i] / tr) * 100;
    const mDI = (smoothedMDM[i] / tr) * 100;
    const diff = Math.abs(pDI - mDI);
    const sum = pDI + mDI;
    dx.push(sum > 0 ? (diff / sum) * 100 : 0);
  }

  if (dx.length < period) return 20;
  const adx = dx.slice(-period).reduce((a, b) => a + b, 0) / period;
  return Math.round(adx * 10) / 10;
}

/** Bollinger Band width as % of middle band — measures volatility. */
function calculateBBWidth(closes: number[], period = 20, multiplier = 2): number {
  if (closes.length < period) return 5;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = mean + multiplier * stdDev;
  const lower = mean - multiplier * stdDev;
  const width = ((upper - lower) / mean) * 100;
  return Math.round(width * 100) / 100;
}

export async function detectMarketRegime(): Promise<MarketRegime> {
  const now = Date.now();
  if (regimeCache && now < regimeCache.expiresAt) return regimeCache.data;

  try {
    // Use BTC 4h klines as the market proxy (BTC leads the market)
    const klines = await getKlines("BTCUSDT", "4h", 80);
    const closes = klines.map((k) => parseFloat(k.close));

    const adx = calculateADX(klines);
    const bbWidth = calculateBBWidth(closes);

    // 4h trend direction
    const ma20 = calculateSMA(closes, 20);
    const ma50 = calculateSMA(closes, 50);
    const btcTrend: "BULL" | "BEAR" | "NEUTRAL" = ma20 > ma50 * 1.005
      ? "BULL"
      : ma20 < ma50 * 0.995
      ? "BEAR"
      : "NEUTRAL";

    let regime: RegimeType;
    let regimeLabel: string;
    let description: string;
    let tradingAdvice: string;

    if (adx >= 25 && btcTrend === "BULL") {
      regime = "TRENDING_BULL";
      regimeLabel = "Trending Bull";
      description = `Strong uptrend detected (ADX ${adx}, BTC MA20 > MA50). Momentum is dominant.`;
      tradingAdvice = "Follow the trend — buy pullbacks, extend TP targets, trail stop losses aggressively";
    } else if (adx >= 25 && btcTrend === "BEAR") {
      regime = "TRENDING_BEAR";
      regimeLabel = "Trending Bear";
      description = `Strong downtrend detected (ADX ${adx}, BTC MA20 < MA50). Bearish pressure dominant.`;
      tradingAdvice = "Reduce new BUY entries — wait for trend reversal signals, tighten stop losses";
    } else if (bbWidth > 12) {
      regime = "VOLATILE";
      regimeLabel = "Volatile";
      description = `High volatility — BB width at ${bbWidth}%. Expect large price swings.`;
      tradingAdvice = "Use tighter position sizing, wider stop losses, shorter hold times";
    } else if (bbWidth < 4) {
      regime = "CONSOLIDATING";
      regimeLabel = "Consolidating";
      description = `Price compressed — BB width at ${bbWidth}%. Breakout likely coming.`;
      tradingAdvice = "Wait for breakout confirmation before entering — watch for volume surge";
    } else {
      regime = "RANGING";
      regimeLabel = "Ranging";
      description = `No strong trend (ADX ${adx}) — market moving sideways between support/resistance.`;
      tradingAdvice = "RSI mean-reversion strategy works best — buy oversold, sell overbought";
    }

    const data: MarketRegime = {
      regime,
      regimeLabel,
      description,
      adx,
      bbWidth,
      btcTrend,
      tradingAdvice,
      updatedAt: new Date().toISOString(),
    };

    regimeCache = { data, expiresAt: now + 15 * 60 * 1000 };
    logger.info({ regime, adx, bbWidth, btcTrend }, "Market regime detected");
    return data;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Market regime detection failed");
    const fallback: MarketRegime = {
      regime: "RANGING",
      regimeLabel: "Ranging",
      description: "Market regime data temporarily unavailable.",
      adx: 20,
      bbWidth: 5,
      btcTrend: "NEUTRAL",
      tradingAdvice: "Follow technical signals normally",
      updatedAt: new Date().toISOString(),
    };
    return regimeCache?.data ?? fallback;
  }
}

/** Return cached regime synchronously without re-fetching. Returns null if no data yet. */
export function getLastRegime(): MarketRegime | null {
  if (regimeCache && Date.now() < regimeCache.expiresAt) return regimeCache.data;
  return null;
}

/** Invalidate the cache so next call recomputes. */
export function invalidateRegimeCache(): void {
  regimeCache = null;
}
