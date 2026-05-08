import { db, tradesTable } from "@workspace/db";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { logger } from "./logger";

export interface TunedParams {
  optimalMinConfidence: number;
  optimalRsiThreshold: number;
  winRateByConfidence: Array<{ bucket: string; winRate: number; trades: number; avgPnl: number }>;
  insights: string[];
  lastAnalyzed: string;
  totalTradesAnalyzed: number;
}

let tunedParams: TunedParams | null = null;
let lastTuneAt = 0;
const TUNE_INTERVAL_MS = 60 * 60 * 1000; // Retune every hour

export function getTunedParams(): TunedParams | null {
  return tunedParams;
}

/**
 * Analyze own trade history and compute optimal parameters.
 * The bot studies its own mistakes and adjusts accordingly.
 */
export async function runSelfTuning(): Promise<void> {
  const now = Date.now();
  if (now - lastTuneAt < TUNE_INTERVAL_MS && tunedParams) return;
  lastTuneAt = now;

  try {
    const closedTrades = await db
      .select()
      .from(tradesTable)
      .where(
        and(
          eq(tradesTable.status, "CLOSED"),
          eq(tradesTable.side, "BUY"),
          isNotNull(tradesTable.pnlUsd),
        ),
      )
      .orderBy(desc(tradesTable.createdAt))
      .limit(200);

    if (closedTrades.length < 5) {
      logger.info("Self-tuner: not enough trade history (< 5 trades)");
      return;
    }

    // ── Win rate by confidence bucket ─────────────────────────────────────────
    const buckets: Record<string, { wins: number; losses: number; totalPnl: number }> = {
      "50-59": { wins: 0, losses: 0, totalPnl: 0 },
      "60-69": { wins: 0, losses: 0, totalPnl: 0 },
      "70-79": { wins: 0, losses: 0, totalPnl: 0 },
      "80-89": { wins: 0, losses: 0, totalPnl: 0 },
      "90+":   { wins: 0, losses: 0, totalPnl: 0 },
    };

    for (const t of closedTrades) {
      const pnl = t.pnlUsd ?? 0;
      const conf = t.confidence;
      const bucket =
        conf >= 90 ? "90+" :
        conf >= 80 ? "80-89" :
        conf >= 70 ? "70-79" :
        conf >= 60 ? "60-69" :
        "50-59";

      if (pnl > 0) buckets[bucket].wins++;
      else buckets[bucket].losses++;
      buckets[bucket].totalPnl += pnl;
    }

    const winRateByConfidence = Object.entries(buckets)
      .map(([bucket, stats]) => {
        const trades = stats.wins + stats.losses;
        return {
          bucket,
          winRate: trades > 0 ? Math.round((stats.wins / trades) * 100) : 0,
          trades,
          avgPnl: trades > 0 ? Math.round((stats.totalPnl / trades) * 1000) / 1000 : 0,
        };
      })
      .filter((b) => b.trades > 0);

    // ── Find optimal minimum confidence ────────────────────────────────────────
    // The lowest confidence bucket that still has positive expectancy (winRate * avgWin > lossRate * avgLoss)
    let optimalMinConfidence = 70; // default
    const bucketOrder = ["50-59", "60-69", "70-79", "80-89", "90+"];
    for (const bc of bucketOrder) {
      const stats = buckets[bc];
      const trades = stats.wins + stats.losses;
      if (trades < 3) continue;
      const wr = stats.wins / trades;
      const avgPnl = stats.totalPnl / trades;
      if (avgPnl > 0 && wr >= 0.5) {
        // This bucket has positive expectancy
        const thresholds: Record<string, number> = { "50-59": 55, "60-69": 60, "70-79": 70, "80-89": 80, "90+": 90 };
        optimalMinConfidence = thresholds[bc] ?? 70;
        break;
      }
    }
    // Never go below 60 — safety floor
    optimalMinConfidence = Math.max(60, optimalMinConfidence);

    // ── Per-symbol loss analysis ───────────────────────────────────────────────
    const symbolLossMap = new Map<string, number>();
    for (const t of closedTrades) {
      if ((t.pnlUsd ?? 0) < 0) {
        symbolLossMap.set(t.symbol, (symbolLossMap.get(t.symbol) ?? 0) + 1);
      }
    }

    // ── Generate insights ─────────────────────────────────────────────────────
    const insights: string[] = [];

    // Find best performing confidence bucket
    const sortedByPnl = winRateByConfidence.filter((b) => b.trades >= 3).sort((a, b) => b.avgPnl - a.avgPnl);
    if (sortedByPnl.length > 0) {
      const best = sortedByPnl[0];
      insights.push(`Best returns at ${best.bucket}% confidence (avg $${best.avgPnl.toFixed(2)}, ${best.winRate}% win rate)`);
    }

    // Find worst bucket
    const worst = winRateByConfidence.filter((b) => b.trades >= 3).sort((a, b) => a.avgPnl - b.avgPnl)[0];
    if (worst && worst.avgPnl < 0) {
      insights.push(`Confidence ${worst.bucket}% has negative expectancy — raising minimum confidence`);
    }

    // Check if high confidence is consistently better
    const high90 = buckets["90+"];
    const high90trades = high90.wins + high90.losses;
    if (high90trades >= 3 && high90.wins / high90trades > 0.7) {
      insights.push(`90%+ confidence trades win ${Math.round((high90.wins / high90trades) * 100)}% of the time — excellent signal quality`);
    }

    // Identify symbols with 3+ losses
    const badSymbols = Array.from(symbolLossMap.entries())
      .filter(([, losses]) => losses >= 3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([sym]) => sym.replace("USDT", ""));
    if (badSymbols.length > 0) {
      insights.push(`High loss frequency on: ${badSymbols.join(", ")} — signals may need recalibration`);
    }

    // Overall quality assessment
    const totalWins = closedTrades.filter((t) => (t.pnlUsd ?? 0) > 0).length;
    const overallWinRate = (totalWins / closedTrades.length) * 100;
    if (overallWinRate >= 60) {
      insights.push(`System performing well — ${overallWinRate.toFixed(1)}% overall win rate on ${closedTrades.length} trades`);
    } else if (overallWinRate < 45) {
      insights.push(`Win rate below 45% — consider increasing minimum confidence threshold to ${optimalMinConfidence}%`);
    }

    tunedParams = {
      optimalMinConfidence,
      optimalRsiThreshold: 40, // Fixed for now — could tune from signal data in future
      winRateByConfidence,
      insights: insights.slice(0, 5),
      lastAnalyzed: new Date().toISOString(),
      totalTradesAnalyzed: closedTrades.length,
    };

    logger.info(
      { optimalMinConfidence, totalTrades: closedTrades.length, insights: insights.length },
      "Self-tuner analysis complete",
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Self-tuner failed");
  }
}
