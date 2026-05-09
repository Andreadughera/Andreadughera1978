import { db, tradesTable } from "@workspace/db";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

const DAILY_DRAWDOWN_LIMIT = 0.05; // 5% of invested capital
const DEFAULT_MAX_OPEN_POSITIONS = 2;
const DEFAULT_MAX_TOTAL_EXPOSURE_USD = 20;

function readPositiveNumber(key: string, fallback: number): number {
  const raw = Number(process.env[key] ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function getMaxOpenPositions(): number {
  return Math.floor(readPositiveNumber("MAX_OPEN_POSITIONS", DEFAULT_MAX_OPEN_POSITIONS));
}

export function getMaxTotalExposureUsd(): number {
  return readPositiveNumber("MAX_TOTAL_EXPOSURE_USD", DEFAULT_MAX_TOTAL_EXPOSURE_USD);
}

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
  maxPositions = getMaxOpenPositions(),
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

export async function checkTotalExposure(
  nextNotionalUsd = 0,
): Promise<{ allowed: boolean; reason?: string; totalInvested: number; maxExposure: number }> {
  const { totalInvested } = await getOpenExposure();
  const maxExposure = getMaxTotalExposureUsd();
  const projectedExposure = totalInvested + Math.max(0, nextNotionalUsd);

  if (projectedExposure > maxExposure) {
    return {
      allowed: false,
      reason: `Maximum total exposure reached ($${projectedExposure.toFixed(2)} projected / $${maxExposure.toFixed(2)} max)`,
      totalInvested,
      maxExposure,
    };
  }

  return { allowed: true, totalInvested, maxExposure };
}

/**
 * Master risk gate — combines all checks.
 * Returns {allowed, reason} for whether a new BUY should proceed.
 */
export async function canOpenNewPosition(
  symbol: string,
  nextNotionalUsd = 0,
): Promise<{ allowed: boolean; reason?: string }> {
  const [drawdown, concentration, exposure] = await Promise.all([
    isDailyDrawdownBreached(),
    checkPositionConcentration(symbol),
    checkTotalExposure(nextNotionalUsd),
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

  if (!exposure.allowed) {
    return { allowed: false, reason: exposure.reason };
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
    maxPositions: getMaxOpenPositions(),
    investedCapital: Math.round(investedCapital * 100) / 100,
    riskStatus,
  };
}
