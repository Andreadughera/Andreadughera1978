import { db, tradesTable } from "@workspace/db";
import { eq, and, isNotNull, desc, sql } from "drizzle-orm";
import { get24hTickers } from "./binance";
import { logger } from "./logger";

export interface PortfolioStats {
  totalPnl: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  avgHoldHours: number;
  bestTrade: { symbol: string; pnl: number; date: string } | null;
  worstTrade: { symbol: string; pnl: number; date: string } | null;
  sharpeRatio: number;
  totalInvested: number;
  totalReturn: number;
}

export interface SymbolStat {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  winRate: number;
  avgPnl: number;
}

export interface EquityPoint {
  date: string;
  dailyPnl: number;
  cumulativePnl: number;
  trades: number;
}

export interface OpenPositionWithPnl {
  id: number;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  tpPrice: number;
  slPrice: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  tpDistancePct: number;
  slDistancePct: number;
  hoursOpen: number;
  confidence: number;
  createdAt: string;
}

/** Full portfolio performance analytics from historical closed trades. */
export async function getPortfolioStats(): Promise<PortfolioStats> {
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
    .orderBy(desc(tradesTable.closedAt));

  if (closedTrades.length === 0) {
    return {
      totalPnl: 0, winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0,
      maxDrawdown: 0, totalTrades: 0, winCount: 0, lossCount: 0,
      avgHoldHours: 0, bestTrade: null, worstTrade: null, sharpeRatio: 0,
      totalInvested: 0, totalReturn: 0,
    };
  }

  const wins = closedTrades.filter((t) => (t.pnlUsd ?? 0) > 0);
  const losses = closedTrades.filter((t) => (t.pnlUsd ?? 0) <= 0);

  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const grossWin = wins.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnlUsd ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const winRate = (wins.length / closedTrades.length) * 100;

  // Avg hold time
  const holdTimes = closedTrades
    .filter((t) => t.closedAt)
    .map((t) => (new Date(t.closedAt!).getTime() - new Date(t.createdAt).getTime()) / 3_600_000);
  const avgHoldHours = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;

  // Max drawdown (peak-to-trough on cumulative equity)
  const sorted = [...closedTrades].sort(
    (a, b) => new Date(a.closedAt ?? a.createdAt).getTime() - new Date(b.closedAt ?? b.createdAt).getTime(),
  );
  let peak = 0;
  let cumulative = 0;
  let maxDrawdown = 0;
  for (const t of sorted) {
    cumulative += t.pnlUsd ?? 0;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe (daily returns)
  const dailyMap = new Map<string, number>();
  for (const t of sorted) {
    const date = (t.closedAt ?? t.createdAt).toISOString().split("T")[0];
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + (t.pnlUsd ?? 0));
  }
  const dailyReturns = Array.from(dailyMap.values());
  let sharpeRatio = 0;
  if (dailyReturns.length > 1) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
  }

  // Estimated total invested (entry price * qty for all closed trades)
  const totalInvested = closedTrades.reduce((s, t) => s + t.entryPrice * t.quantity, 0);
  const totalReturn = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  const bestSorted = [...closedTrades].sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0));
  const best = bestSorted[0];
  const worst = bestSorted[bestSorted.length - 1];

  return {
    totalPnl,
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    maxDrawdown,
    totalTrades: closedTrades.length,
    winCount: wins.length,
    lossCount: losses.length,
    avgHoldHours,
    bestTrade: best
      ? { symbol: best.symbol, pnl: best.pnlUsd ?? 0, date: (best.closedAt ?? best.createdAt).toISOString() }
      : null,
    worstTrade: worst
      ? { symbol: worst.symbol, pnl: worst.pnlUsd ?? 0, date: (worst.closedAt ?? worst.createdAt).toISOString() }
      : null,
    sharpeRatio,
    totalInvested,
    totalReturn,
  };
}

/** Equity curve: cumulative PnL per day. */
export async function getEquityCurve(days = 30): Promise<EquityPoint[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const closedTrades = await db
    .select()
    .from(tradesTable)
    .where(
      and(
        eq(tradesTable.status, "CLOSED"),
        eq(tradesTable.side, "BUY"),
        isNotNull(tradesTable.pnlUsd),
        sql`${tradesTable.closedAt} >= ${since}`,
      ),
    )
    .orderBy(tradesTable.closedAt);

  const dailyMap = new Map<string, { pnl: number; count: number }>();

  // Fill every date in range with 0 so chart has no gaps
  for (let d = 0; d < days; d++) {
    const dt = new Date(since);
    dt.setDate(since.getDate() + d);
    const key = dt.toISOString().split("T")[0];
    dailyMap.set(key, { pnl: 0, count: 0 });
  }

  for (const t of closedTrades) {
    const date = (t.closedAt ?? t.createdAt).toISOString().split("T")[0];
    const existing = dailyMap.get(date) ?? { pnl: 0, count: 0 };
    dailyMap.set(date, { pnl: existing.pnl + (t.pnlUsd ?? 0), count: existing.count + 1 });
  }

  let cumulative = 0;
  return Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { pnl, count }]) => {
      cumulative += pnl;
      return {
        date,
        dailyPnl: Math.round(pnl * 100) / 100,
        cumulativePnl: Math.round(cumulative * 100) / 100,
        trades: count,
      };
    });
}

/** Per-symbol performance breakdown. */
export async function getSymbolStats(): Promise<SymbolStat[]> {
  const closedTrades = await db
    .select()
    .from(tradesTable)
    .where(
      and(
        eq(tradesTable.status, "CLOSED"),
        eq(tradesTable.side, "BUY"),
        isNotNull(tradesTable.pnlUsd),
      ),
    );

  const symbolMap = new Map<string, { trades: number; wins: number; losses: number; totalPnl: number }>();

  for (const t of closedTrades) {
    const existing = symbolMap.get(t.symbol) ?? { trades: 0, wins: 0, losses: 0, totalPnl: 0 };
    const pnl = t.pnlUsd ?? 0;
    symbolMap.set(t.symbol, {
      trades: existing.trades + 1,
      wins: existing.wins + (pnl > 0 ? 1 : 0),
      losses: existing.losses + (pnl <= 0 ? 1 : 0),
      totalPnl: existing.totalPnl + pnl,
    });
  }

  return Array.from(symbolMap.entries())
    .map(([symbol, stats]) => ({
      symbol,
      ...stats,
      winRate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
      avgPnl: stats.trades > 0 ? stats.totalPnl / stats.trades : 0,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

/** Open positions with live unrealized PnL. */
export async function getOpenPositionsWithPnl(): Promise<OpenPositionWithPnl[]> {
  const openTrades = await db
    .select()
    .from(tradesTable)
    .where(
      and(
        eq(tradesTable.status, "FILLED"),
        eq(tradesTable.side, "BUY"),
      ),
    )
    .orderBy(desc(tradesTable.createdAt));

  if (openTrades.length === 0) return [];

  const symbols = [...new Set(openTrades.map((t) => t.symbol))];
  let priceMap = new Map<string, number>();

  try {
    const tickers = await get24hTickers(symbols);
    priceMap = new Map(tickers.map((t) => [t.symbol, parseFloat(t.lastPrice)]));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Failed to fetch live prices for open positions");
  }

  const now = Date.now();

  return openTrades.map((t) => {
    const currentPrice = priceMap.get(t.symbol) ?? t.entryPrice;
    const unrealizedPnl = (currentPrice - t.entryPrice) * t.quantity;
    const unrealizedPct = t.entryPrice > 0 ? ((currentPrice - t.entryPrice) / t.entryPrice) * 100 : 0;
    const tpDistancePct = t.tpPrice > 0 ? ((t.tpPrice - currentPrice) / currentPrice) * 100 : 0;
    const slDistancePct = t.slPrice > 0 ? ((currentPrice - t.slPrice) / currentPrice) * 100 : 0;
    const hoursOpen = (now - new Date(t.createdAt).getTime()) / 3_600_000;

    return {
      id: t.id,
      symbol: t.symbol,
      entryPrice: t.entryPrice,
      currentPrice,
      quantity: t.quantity,
      tpPrice: t.tpPrice,
      slPrice: t.slPrice,
      unrealizedPnl: Math.round(unrealizedPnl * 10000) / 10000,
      unrealizedPct: Math.round(unrealizedPct * 100) / 100,
      tpDistancePct: Math.round(tpDistancePct * 100) / 100,
      slDistancePct: Math.round(slDistancePct * 100) / 100,
      hoursOpen: Math.round(hoursOpen * 10) / 10,
      confidence: t.confidence,
      createdAt: t.createdAt.toISOString(),
    };
  });
}
