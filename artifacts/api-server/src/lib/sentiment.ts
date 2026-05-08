import axios from "axios";
import { logger } from "./logger";

export interface FearGreedData {
  value: number;
  classification: string;
  updatedAt: string;
}

export interface WhaleAlert {
  symbol: string;
  volumeMultiplier: number;
  currentVolume: number;
  avgVolume: number;
  direction: "BUY" | "SELL" | "NEUTRAL";
  price: number;
  detectedAt: string;
}

export interface SentimentData {
  fearGreed: FearGreedData;
  whaleAlerts: WhaleAlert[];
  marketMood: "EXTREME_FEAR" | "FEAR" | "NEUTRAL" | "GREED" | "EXTREME_GREED";
  tradingBias: string;
  lastUpdated: string;
  globalMarket?: import("./coingecko").GlobalMarketData | null;
  trending?: import("./coingecko").TrendingCoin[];
  aiBriefing?: import("./aiBriefing").MarketBriefing;
}

// ─── Fear & Greed cache (updates once per day, we cache 1h) ──────────────────
let fgCache: { data: FearGreedData; expiresAt: number } | null = null;

export async function getFearGreedIndex(): Promise<FearGreedData> {
  const now = Date.now();
  if (fgCache && now < fgCache.expiresAt) {
    return fgCache.data;
  }
  try {
    const res = await axios.get<{
      data: Array<{ value: string; value_classification: string; timestamp: string }>;
    }>("https://api.alternative.me/fng/?limit=1", { timeout: 5000 });
    const raw = res.data.data[0];
    const data: FearGreedData = {
      value: parseInt(raw.value, 10),
      classification: raw.value_classification,
      updatedAt: new Date(parseInt(raw.timestamp, 10) * 1000).toISOString(),
    };
    fgCache = { data, expiresAt: now + 60 * 60 * 1000 };
    logger.info({ value: data.value, classification: data.classification }, "Fear & Greed Index updated");
    return data;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Fear & Greed API failed, using cached/default");
    return fgCache?.data ?? { value: 50, classification: "Neutral", updatedAt: new Date().toISOString() };
  }
}

export function classifyMarketMood(fgValue: number): SentimentData["marketMood"] {
  if (fgValue <= 24) return "EXTREME_FEAR";
  if (fgValue <= 44) return "FEAR";
  if (fgValue <= 55) return "NEUTRAL";
  if (fgValue <= 74) return "GREED";
  return "EXTREME_GREED";
}

/**
 * Fear & Greed confidence modifier — contrarian logic:
 * "Be fearful when others are greedy, greedy when others are fearful" — Buffett
 */
export function getFgConfidenceBonus(fgValue: number, signalType: "BUY" | "SELL"): number {
  const mood = classifyMarketMood(fgValue);
  if (signalType === "BUY") {
    if (mood === "EXTREME_FEAR") return 10;  // Strong buy opportunity when market is panicking
    if (mood === "FEAR") return 5;
    if (mood === "NEUTRAL") return 0;
    if (mood === "GREED") return -3;          // Caution — everyone already bought
    if (mood === "EXTREME_GREED") return -6;  // Danger — market may be overextended
  } else {
    if (mood === "EXTREME_GREED") return 10; // Strong sell when market is euphoric
    if (mood === "GREED") return 5;
    if (mood === "NEUTRAL") return 0;
    if (mood === "FEAR") return -3;
    if (mood === "EXTREME_FEAR") return -6;
  }
  return 0;
}

// ─── Whale / volume spike detection ──────────────────────────────────────────
const whaleAlertCache: WhaleAlert[] = [];
const WHALE_CACHE_MS = 30 * 60 * 1000; // keep alerts for 30 minutes

export function recordVolumeSpike(
  symbol: string,
  volumeMultiplier: number,
  currentVolume: number,
  avgVolume: number,
  direction: "BUY" | "SELL" | "NEUTRAL",
  price: number,
): void {
  if (volumeMultiplier < 2.5) return; // only log significant spikes
  const alert: WhaleAlert = {
    symbol,
    volumeMultiplier: Math.round(volumeMultiplier * 10) / 10,
    currentVolume,
    avgVolume,
    direction,
    price,
    detectedAt: new Date().toISOString(),
  };
  whaleAlertCache.push(alert);
  // Keep only recent alerts
  const cutoff = Date.now() - WHALE_CACHE_MS;
  while (whaleAlertCache.length > 0) {
    const oldest = new Date(whaleAlertCache[0].detectedAt).getTime();
    if (oldest < cutoff) whaleAlertCache.shift();
    else break;
  }
  logger.info(
    { symbol, multiplier: alert.volumeMultiplier, direction },
    "Volume spike / whale activity detected",
  );
}

export function getRecentWhaleAlerts(): WhaleAlert[] {
  const cutoff = Date.now() - WHALE_CACHE_MS;
  return whaleAlertCache.filter(
    (a) => new Date(a.detectedAt).getTime() > cutoff,
  );
}

export async function getSentimentData(): Promise<SentimentData> {
  const { getGlobalMarketData, getTrendingCoins } = await import("./coingecko");
  const { generateMarketBriefing } = await import("./aiBriefing");

  const [fearGreed, globalMarket, trending, aiBriefing] = await Promise.all([
    getFearGreedIndex(),
    getGlobalMarketData(),
    getTrendingCoins(),
    generateMarketBriefing(),
  ]);

  const marketMood = classifyMarketMood(fearGreed.value);
  const whaleAlerts = getRecentWhaleAlerts();

  const moodMessages: Record<SentimentData["marketMood"], string> = {
    EXTREME_FEAR: "Market in panic — contrarian BUY opportunity, tighten stop losses",
    FEAR: "Market fearful — favor BUY signals, maintain discipline",
    NEUTRAL: "Market balanced — follow technical signals",
    GREED: "Market greedy — be cautious on new BUY entries",
    EXTREME_GREED: "Market euphoric — consider taking profits, risk is elevated",
  };

  return {
    fearGreed,
    whaleAlerts,
    marketMood,
    tradingBias: moodMessages[marketMood],
    lastUpdated: new Date().toISOString(),
    globalMarket,
    trending,
    aiBriefing,
  };
}
