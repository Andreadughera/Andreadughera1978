import axios from "axios";
import { logger } from "./logger";

const FUTURES_BASE = "https://fapi.binance.com/fapi/v1";
const SPOT_BASE    = "https://api.binance.us/api/v3";

const futuresClient = axios.create({ baseURL: FUTURES_BASE, timeout: 8000 });
const spotClient    = axios.create({ baseURL: SPOT_BASE,    timeout: 8000 });

export interface SmartMoneyData {
  symbol:       string;
  fundingRate:  number;              // e.g. 0.0001 = 0.01%
  fundingVote:  "BUY" | "SELL" | "HOLD";
  openInterest: number;              // current OI in coin units
  oiChangeDir:  "UP" | "DOWN" | "FLAT";
  whaleBuyUsd:  number;              // $-value of whale buy trades in last 500 fills
  whaleSellUsd: number;
  whaleVote:    "BUY" | "SELL" | "HOLD";
  fetchedAt:    number;
}

const cache       = new Map<string, SmartMoneyData>();
const oiPrev      = new Map<string, number>();
const CACHE_TTL   = 5 * 60 * 1000;   // 5 minutes
const WHALE_MIN   = 20_000;           // $20k+ = whale trade

let fundingMap:       Map<string, number> | null = null;
let fundingFetchedAt  = 0;
let futuresAvailable: boolean | null = null;

async function checkFuturesAvailable(): Promise<boolean> {
  if (futuresAvailable !== null) return futuresAvailable;
  try {
    await futuresClient.get("/ping", { timeout: 4000 });
    futuresAvailable = true;
  } catch {
    futuresAvailable = false;
    logger.warn("Binance Futures API not reachable — smart money funding/OI disabled");
  }
  return futuresAvailable;
}

async function getAllFundingRates(): Promise<Map<string, number>> {
  const now = Date.now();
  if (fundingMap && now - fundingFetchedAt < CACHE_TTL) return fundingMap;
  try {
    const res = await futuresClient.get<Array<{ symbol: string; lastFundingRate: string }>>("/premiumIndex");
    const map = new Map<string, number>();
    for (const item of res.data) map.set(item.symbol, parseFloat(item.lastFundingRate));
    fundingMap      = map;
    fundingFetchedAt = now;
    return map;
  } catch {
    return fundingMap ?? new Map();
  }
}

async function getOpenInterest(symbol: string): Promise<number> {
  try {
    const res = await futuresClient.get<{ openInterest: string }>("/openInterest", { params: { symbol } });
    return parseFloat(res.data.openInterest);
  } catch {
    return 0;
  }
}

async function getWhaleActivity(symbol: string): Promise<{ buyUsd: number; sellUsd: number }> {
  try {
    const res = await spotClient.get<Array<{ p: string; q: string; m: boolean }>>("/aggTrades", {
      params: { symbol, limit: 500 },
    });
    let buyUsd = 0;
    let sellUsd = 0;
    for (const t of res.data) {
      const val = parseFloat(t.p) * parseFloat(t.q);
      if (val >= WHALE_MIN) {
        // m = isBuyerMaker: true → seller hit the bid (SELL pressure)
        //                   false → buyer hit the ask (BUY pressure)
        if (t.m) sellUsd += val; else buyUsd += val;
      }
    }
    return { buyUsd, sellUsd };
  } catch {
    return { buyUsd: 0, sellUsd: 0 };
  }
}

export async function getSmartMoney(symbol: string): Promise<SmartMoneyData> {
  const now    = Date.now();
  const cached = cache.get(symbol);
  if (cached && now - cached.fetchedAt < CACHE_TTL) return cached;

  const ok = await checkFuturesAvailable();

  const [rates, oi, whale] = await Promise.all([
    ok ? getAllFundingRates()  : Promise.resolve(new Map<string, number>()),
    ok ? getOpenInterest(symbol) : Promise.resolve(0),
    getWhaleActivity(symbol),          // spot endpoint — always try
  ]);

  const fundingRate = rates.get(symbol) ?? 0;

  // Funding interpretation:
  //  < -0.01%  → shorts paying longs → market leaning short → squeeze UP likely  → BUY signal
  //  > +0.05%  → longs paying too much → crowd overleveraged long → reversal risk → SELL signal
  const fundingVote: SmartMoneyData["fundingVote"] =
    fundingRate < -0.0001 ? "BUY"  :
    fundingRate >  0.0005 ? "SELL" : "HOLD";

  const prevOi = oiPrev.get(symbol) ?? oi;
  if (oi > 0) oiPrev.set(symbol, oi);
  const oiChangeDir: SmartMoneyData["oiChangeDir"] =
    oi > prevOi * 1.005 ? "UP"   :
    oi < prevOi * 0.995 ? "DOWN" : "FLAT";

  // Whale vote: one side must dominate by 50%+ to count
  const whaleVote: SmartMoneyData["whaleVote"] =
    whale.buyUsd  > whale.sellUsd * 1.5 ? "BUY"  :
    whale.sellUsd > whale.buyUsd  * 1.5 ? "SELL" : "HOLD";

  const data: SmartMoneyData = {
    symbol, fundingRate, fundingVote,
    openInterest: oi, oiChangeDir,
    whaleBuyUsd: whale.buyUsd, whaleSellUsd: whale.sellUsd, whaleVote,
    fetchedAt: now,
  };

  cache.set(symbol, data);
  return data;
}

export async function getAllSmartMoney(symbols: string[]): Promise<SmartMoneyData[]> {
  const results = await Promise.allSettled(symbols.map((s) => getSmartMoney(s)));
  return results
    .filter((r): r is PromiseFulfilledResult<SmartMoneyData> => r.status === "fulfilled")
    .map((r) => r.value);
}
