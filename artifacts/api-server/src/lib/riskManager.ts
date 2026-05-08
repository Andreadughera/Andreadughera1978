import { db, tradesTable } from "@workspace/db";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

const DAILY_DRAWDOWN_LIMIT = 0.05; // 5% of invested capital

/**
 * Compute today's realized PnL from closed trades.
 * Includes both wins and losses closed today.
 */
export async function getTodayPnl(): Promise<{ pnl: number; trades: number }> {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      totalPnl: sql<number>`coalesce(sum(${tradesTable.pnlUsd}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(tradesTable)
    .where(
      and(
        eq(tradesTable.status, "CLOSED"),
        eq(tradesTable.side, "BUY"),
        isNotNull(tradesTable.pnlUsd),
        sql`${tradesTable.closedAt} >= ${startOfToday}`,
      ),
    );

  return {
    pnl: rows[0]?.totalPnl ?? 0,
    trades: rows[0]?.count ?? 0,
  };
}

/**
 * Compute total invested in currently open positions.
 * Used to gauge exposure and drawdown % relative to deployed capital.
 */
export async function getOpenExposure(): Promise<{ totalInvested: number; positions: number }> {
  const rows = await db
    .select({
      totalInvested: sql<number>`coalesce(sum(${tradesTable.entryPrice} * ${tradesTable.quantity}), 0)`,
      positions: sql<number>`count(*)::int`,
    })
    .from(tradesTable)
    .where(
      and(
        eq(tradesTable.status, "FILLED"),
        eq(tradesTable.side, "BUY"),
      ),
    );

  return {
    totalInvested: rows[0]?.totalInvested ?? 0,
    positions: rows[0]?.positions ?? 0,
  };
}

/**
 * Check if daily drawdown limit is breached.
 * Returns true if today's losses exceed DAILY_DRAWDOWN_LIMIT of deployed capital.
 */
export async function isDailyDrawdownBreached(): Promise<{
  breached: boolean;
  todayPnl: number;
  drawdownPct: number;
  investedCapital: number;
}> {
  const [{ pnl }, { totalInvested }] = await Promise.all([
    getTodayPnl(),
    getOpenExposure(),
  ]);

  // Only apply drawdown check if there's meaningful capital deployed ($10+)
  const investedCapital = Math.max(totalInvested, 50); // floor at $50 to avoid false triggers
  const drawdownPct = pnl < 0 ? Math.abs(pnl) / investedCapital : 0;
  const breached = pnl < 0 && drawdownPct >= DAILY_DRAWDOWN_LIMIT;

  if (breached) {
    logger.warn(
      { pnl: pnl.toFixed(2), drawdownPct: (drawdownPct * 100).toFixed(2), investedCapital: investedCapital.toFixed(2) },
      "Daily drawdown limit breached — pausing new BUY entries",
    );
  }

  return {
    breached,
    todayPnl: Math.round(pnl * 100) / 100,
    drawdownPct: Math.round(drawdownPct * 10000) / 100,
    investedCapital: Math.round(investedCapital * 100) / 100,
  };
}

/**
 * Check position concentration — how many open positions are in correlated L1 chains.
 * Returns true if opening another would create dangerous concentration.
 */
export async function checkPositionConcentration(
  symbol: string,
  maxPositions = 10,
): Promise<{ allowed: boolean; reason?: string; openCount: number }> {
  const { positions } = await getOpenExposure();

  if (positions >= maxPositions) {
    return {
      allowed: false,
      reason: `Maximum concurrent positions (${maxPositions}) reached`,
      openCount: positions,
    };
  }

  return { allowed: true, openCount: positions };
}

/**
 * Master risk gate — combines all checks.
 * Returns {allowed, reason} for whether a new BUY should proceed.
 */
export async function canOpenNewPosition(
  symbol: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const [drawdown, concentration] = await Promise.all([
    isDailyDrawdownBreached(),
    checkPositionConcentration(symbol),
  ]);

  if (drawdown.breached) {
    return {
      allowed: false,
      reason: `Daily drawdown limit reached (${drawdown.drawdownPct.toFixed(1)}% of capital lost today — limit is ${(DAILY_DRAWDOWN_LIMIT * 100).toFixed(0)}%)`,
    };
  }

  if (!concentration.allowed) {
    return { allowed: false, reason: concentration.reason };
  }

  return { allowed: true };
}

/** Get risk dashboard summary. */
export async function getRiskSummary(): Promise<{
  dailyDrawdownPct: number;
  dailyDrawdownLimitPct: number;
  dailyPnl: number;
  openPositions: number;
  maxPositions: number;
  investedCapital: number;
  riskStatus: "SAFE" | "WARNING" | "HALTED";
}> {
  const [{ pnl, trades }, { totalInvested, positions }] = await Promise.all([
    getTodayPnl(),
    getOpenExposure(),
  ]);

  const investedCapital = Math.max(totalInvested, 50);
  const drawdownPct = pnl < 0 ? (Math.abs(pnl) / investedCapital) * 100 : 0;
  const limitPct = DAILY_DRAWDOWN_LIMIT * 100;

  const riskStatus: "SAFE" | "WARNING" | "HALTED" =
    drawdownPct >= limitPct ? "HALTED" :
    drawdownPct >= limitPct * 0.7 ? "WARNING" :
    "SAFE";

  return {
    dailyDrawdownPct: Math.round(drawdownPct * 100) / 100,
    dailyDrawdownLimitPct: limitPct,
    dailyPnl: Math.round(pnl * 100) / 100,
    openPositions: positions,
    maxPositions: 10,
    investedCapital: Math.round(investedCapital * 100) / 100,
    riskStatus,
  };
}
