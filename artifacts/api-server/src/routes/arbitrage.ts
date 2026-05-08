import { Router } from "express";
import axios from "axios";
import { get24hTickers, TRACKED_SYMBOLS } from "../lib/binance";
import { logger } from "../lib/logger";

const router = Router();

export interface ArbitrageEntry {
  symbol: string;
  displaySymbol: string;
  binancePrice: number | null;
  cdcPrice: number | null;
  spreadPct: number | null;
  opportunity: "BUY_CDC" | "BUY_BINANCE" | "NEUTRAL" | "UNAVAILABLE";
  binanceAvailable: boolean;
  cdcAvailable: boolean;
  updatedAt: string;
}

const CDC_PUBLIC = "https://api.crypto.com/exchange/v1/public";

/** Fetch CDC exchange price (public endpoint — no auth). */
async function getCdcPrices(symbols: string[]): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  try {
    const res = await axios.get<{
      result: { data: Array<{ i: string; a: string; b: string; k: string }> };
    }>(`${CDC_PUBLIC}/get-tickers`, { timeout: 6000 });

    const tickers = res.data?.result?.data ?? [];
    for (const t of tickers) {
      // CDC instruments are like BTC_USDT or BTC_USD
      // We want to match our BTCUSDT → BTC_USDT
      for (const sym of symbols) {
        const base = sym.replace("USDT", "");
        const instrument = `${base}_USDT`;
        if (t.i === instrument) {
          const price = parseFloat(t.a); // ask price
          if (!isNaN(price) && price > 0) priceMap.set(sym, price);
        }
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "CDC public ticker fetch failed");
  }
  return priceMap;
}

// Cache arbitrage data for 30 seconds
let arbCache: { data: ArbitrageEntry[]; expiresAt: number } | null = null;

router.get("/arbitrage", async (_req, res) => {
  const now = Date.now();
  if (arbCache && now < arbCache.expiresAt) {
    res.json(arbCache.data);
    return;
  }

  try {
    const [binanceTickers, cdcPrices] = await Promise.all([
      get24hTickers(TRACKED_SYMBOLS).catch(() => []),
      getCdcPrices(TRACKED_SYMBOLS),
    ]);

    const binancePriceMap = new Map(
      binanceTickers.map((t) => [t.symbol, parseFloat(t.lastPrice)]),
    );

    const MIN_OPPORTUNITY_PCT = 0.15; // Flag as opportunity if spread > 0.15%

    const entries: ArbitrageEntry[] = TRACKED_SYMBOLS.map((symbol) => {
      const binancePrice = binancePriceMap.get(symbol) ?? null;
      const cdcPrice = cdcPrices.get(symbol) ?? null;

      let spreadPct: number | null = null;
      let opportunity: ArbitrageEntry["opportunity"] = "UNAVAILABLE";

      if (binancePrice && cdcPrice && binancePrice > 0 && cdcPrice > 0) {
        spreadPct = ((cdcPrice - binancePrice) / binancePrice) * 100;
        if (Math.abs(spreadPct) < MIN_OPPORTUNITY_PCT) {
          opportunity = "NEUTRAL";
        } else if (spreadPct > 0) {
          // CDC is more expensive than Binance → buy on Binance, sell on CDC
          opportunity = "BUY_BINANCE";
        } else {
          // CDC is cheaper than Binance → buy on CDC, sell on Binance
          opportunity = "BUY_CDC";
        }
      } else if (binancePrice) {
        opportunity = "UNAVAILABLE";
      }

      return {
        symbol,
        displaySymbol: symbol.replace("USDT", ""),
        binancePrice,
        cdcPrice,
        spreadPct: spreadPct !== null ? Math.round(spreadPct * 10000) / 10000 : null,
        opportunity,
        binanceAvailable: binancePrice !== null,
        cdcAvailable: cdcPrice !== null,
        updatedAt: new Date().toISOString(),
      };
    });

    // Sort by absolute spread descending (biggest opportunities first)
    entries.sort((a, b) => Math.abs(b.spreadPct ?? 0) - Math.abs(a.spreadPct ?? 0));

    arbCache = { data: entries, expiresAt: now + 30_000 };
    res.json(entries);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Arbitrage endpoint failed");
    res.status(500).json({ error: "Failed to fetch arbitrage data" });
  }
});

export default router;
