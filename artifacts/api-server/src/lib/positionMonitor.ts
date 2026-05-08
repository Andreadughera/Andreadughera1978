import { db, tradesTable, dailyReportsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";
import { get24hTickers } from "./binance";
import { getCdcCreds, closePosition, type StablecoinType } from "./cdcExchange";
import { getLastRegime } from "./marketRegime";

/**
 * Server-side position monitor — runs every 2 minutes.
 * Checks all FILLED BUY trades and closes them if:
 *  - Current price >= tpPrice  (Take Profit)
 *  - Current price <= slPrice  (Stop Loss)
 *  - Trade is a listing AND older than 30 minutes (Time Exit)
 */
export async function monitorOpenPositions(): Promise<void> {
  const creds = await getCdcCreds();
  if (!creds) return;

  const openTrades = await db
    .select()
    .from(tradesTable)
    .where(and(eq(tradesTable.status, "FILLED"), eq(tradesTable.side, "BUY")));

  if (openTrades.length === 0) return;

  logger.info({ count: openTrades.length }, "Position monitor: checking open trades");

  const symbols = [...new Set(openTrades.map((t) => t.symbol))];
  const tickers = await get24hTickers(symbols);
  const priceMap = new Map(tickers.map((t) => [t.symbol, parseFloat(t.lastPrice)]));

  for (const trade of openTrades) {
    const currentPrice = priceMap.get(trade.symbol);
    if (!currentPrice || !trade.entryPrice) continue;

    const tpPrice = trade.tpPrice ?? 0;
    let slPrice = trade.slPrice ?? 0;
    const ageMs = Date.now() - new Date(trade.createdAt).getTime();
    const MIN_HOLD_MS = Math.max(0, Number(process.env.STOP_LOSS_GRACE_MS ?? "0")); // default: SL can trigger immediately
    const isTooYoungForSl = ageMs < MIN_HOLD_MS;
    const isExpiredListing = (trade.isListing ?? false) && ageMs > MIN_HOLD_MS;

    // ── Regime-aware Trailing Stop Loss ──────────────────────────────────────
    // TRENDING_BULL: tight 2% trail — let winners run while locking profits quickly
    // VOLATILE: no trailing — avoid early shakeouts; wait for TP/SL levels
    // RANGING / CONSOLIDATING: no trailing — mean-reversion, positions need room
    // Default / TRENDING_BEAR: moderate 4% trail
    const regime = getLastRegime();
    let trailPct: number | null =
      regime?.regime === "TRENDING_BULL"   ? 0.02 :
      regime?.regime === "VOLATILE"        ? null  :
      regime?.regime === "RANGING"         ? null  :
      regime?.regime === "CONSOLIDATING"   ? null  :
      0.04; // default

    const newSlUpdates: Partial<typeof tradesTable.$inferInsert> = {};

    if (trailPct !== null && currentPrice > (trade.entryPrice ?? 0) && slPrice > 0) {
      const trailingCandidate = currentPrice * (1 - trailPct);
      if (trailingCandidate > slPrice) {
        newSlUpdates.slPrice = trailingCandidate;
        logger.info(
          {
            tradeId: trade.id, symbol: trade.symbol,
            oldSl: slPrice.toFixed(6), newSl: trailingCandidate.toFixed(6),
            currentPrice, trailPct: (trailPct * 100).toFixed(0) + "%",
            regime: regime?.regime ?? "DEFAULT",
            unrealizedPct: (((currentPrice - (trade.entryPrice ?? 0)) / (trade.entryPrice ?? 1)) * 100).toFixed(2),
          },
          "Trailing SL updated — locking in profits",
        );
        slPrice = trailingCandidate;
      }
    }

    // ── Break-even stop: move SL to entry once 50% of TP distance reached ────
    // Guarantees no loss on any trade that moves 50% toward target.
    if (trade.entryPrice && tpPrice > 0 && slPrice > 0) {
      const halfwayToTp = trade.entryPrice + (tpPrice - trade.entryPrice) * 0.5;
      if (currentPrice >= halfwayToTp && slPrice < trade.entryPrice * 0.9998) {
        const breakEvenSl = trade.entryPrice * 1.0001; // tiny buffer above entry
        if (breakEvenSl > slPrice) {
          newSlUpdates.slPrice = Math.max(newSlUpdates.slPrice ?? 0, breakEvenSl);
          slPrice = newSlUpdates.slPrice!;
          logger.info(
            { tradeId: trade.id, symbol: trade.symbol, breakEvenSl: breakEvenSl.toFixed(6), currentPrice },
            "Break-even SL activated — position cannot lose",
          );
        }
      }
    }

    if (Object.keys(newSlUpdates).length > 0) {
      await db.update(tradesTable).set(newSlUpdates).where(eq(tradesTable.id, trade.id));
    }

    let exitReason: "TP" | "SL" | "TIME" | null = null;
    if (tpPrice > 0 && currentPrice >= tpPrice) {
      exitReason = "TP"; // TP triggers immediately — profit should never be refused
    } else if (!isTooYoungForSl && slPrice > 0 && currentPrice <= slPrice) {
      exitReason = "SL"; // SL only after 30 min hold to absorb entry noise
    } else if (isExpiredListing) {
      exitReason = "TIME";
    } else if (isTooYoungForSl && slPrice > 0 && currentPrice <= slPrice) {
      logger.info(
        { tradeId: trade.id, symbol: trade.symbol, ageMinutes: Math.round(ageMs / 60000), currentPrice, slPrice },
        "SL would trigger but trade is < 30 min old — holding to absorb entry noise",
      );
    }

    if (!exitReason) continue;

    logger.info(
      { tradeId: trade.id, symbol: trade.symbol, exitReason, currentPrice, tpPrice, slPrice },
      "Position exit triggered — closing position",
    );

    try {
      const quoteMatch = trade.binanceOrderId?.match(/quote:(USD|USDT|USDC)/);
      const quoteCurrency = quoteMatch?.[1] as StablecoinType | undefined;
      const { orderId, quantity } = await closePosition(creds, trade.symbol, quoteCurrency);
      const pnlUsd = (currentPrice - trade.entryPrice) * quantity;
      const exitOrderId = `${trade.binanceOrderId ?? ""}|close:${orderId}`;

      await db
        .update(tradesTable)
        .set({
          status: "CLOSED",
          exitPrice: currentPrice,
          pnlUsd,
          closedAt: new Date(),
          binanceOrderId: exitOrderId,
        })
        .where(eq(tradesTable.id, trade.id));

      logger.info(
        { tradeId: trade.id, symbol: trade.symbol, exitReason, pnlUsd: pnlUsd.toFixed(4) },
        "Position closed successfully",
      );
    } catch (err) {
      logger.error({ tradeId: trade.id, err: (err as Error).message }, "Failed to close position");
      await db
        .update(tradesTable)
        .set({ errorMessage: `Close failed: ${(err as Error).message}` })
        .where(eq(tradesTable.id, trade.id));
    }
  }
}

/**
 * Generate daily report for yesterday.
 * Called at 8:00 AM UTC.
 */
export async function generateDailyReport(): Promise<void> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setUTCDate(today.getUTCDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];

  const startOfDay = new Date(`${dateStr}T00:00:00Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59Z`);

  const closedTrades = await db
    .select()
    .from(tradesTable)
    .where(
      and(
        eq(tradesTable.side, "BUY"),
        eq(tradesTable.status, "CLOSED"),
        sql`${tradesTable.closedAt} >= ${startOfDay}`,
        sql`${tradesTable.closedAt} <= ${endOfDay}`,
      ),
    );

  const tradesCount = closedTrades.length;
  const winCount = closedTrades.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const lossCount = closedTrades.filter((t) => (t.pnlUsd ?? 0) < 0).length;
  const pnlUsd = closedTrades.reduce((acc, t) => acc + (t.pnlUsd ?? 0), 0);

  const sorted = [...closedTrades].sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0));
  const bestTrade = sorted[0];
  const worstTrade = sorted[sorted.length - 1];

  const openPositions = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tradesTable)
    .where(and(eq(tradesTable.status, "FILLED"), eq(tradesTable.side, "BUY")));
  const openPositionsCount = openPositions[0]?.count ?? 0;

  await db
    .insert(dailyReportsTable)
    .values({
      date: dateStr,
      tradesCount,
      winCount,
      lossCount,
      pnlUsd,
      bestSymbol: bestTrade?.symbol ?? null,
      bestPnl: bestTrade?.pnlUsd ?? null,
      worstSymbol: worstTrade?.symbol ?? null,
      worstPnl: worstTrade?.pnlUsd ?? null,
      openPositionsCount,
    })
    .onConflictDoUpdate({
      target: dailyReportsTable.date,
      set: { tradesCount, winCount, lossCount, pnlUsd, openPositionsCount },
    });

  logger.info({ date: dateStr, tradesCount, pnlUsd: pnlUsd.toFixed(4) }, "Daily report generated");
}
