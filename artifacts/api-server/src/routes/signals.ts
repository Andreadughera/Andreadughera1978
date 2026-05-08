import { Router } from "express";
import { db, signalsTable, tradesTable } from "@workspace/db";
import { desc, eq, and, sql, inArray } from "drizzle-orm";
import {
  ListSignalsQueryParams,
  GetSignalsHistoryQueryParams,
} from "@workspace/api-zod";
import { computeSignal, TRACKED_SYMBOLS } from "../lib/binance";
import { getCdcCreds, getTradeConfig, executeCdcTrade, getStablecoinBalance, getCryptoHolding } from "../lib/cdcExchange";
import { logger } from "../lib/logger";
import { canOpenNewPosition } from "../lib/riskManager";
import { findHighlyCorrelatedPosition } from "../lib/correlation";
import { getLastRegime } from "../lib/marketRegime";

const router = Router();

// ─── Global trade semaphore ────────────────────────────────────────────────
// Prevents race condition where 20 parallel signals all pass the balance check
// at the same time and all try to execute — only ONE trade can run at a time.
let _tradeLock = false;
const _tradeQueue: Array<() => void> = [];
const _inFlightBuySymbols = new Set<string>();

function acquireTradeLock(): Promise<void> {
  return new Promise((resolve) => {
    if (!_tradeLock) {
      _tradeLock = true;
      resolve();
    } else {
      _tradeQueue.push(resolve);
    }
  });
}

function releaseTradeLock(): void {
  const next = _tradeQueue.shift();
  if (next) {
    next();
  } else {
    _tradeLock = false;
  }
}

router.get("/signals", async (req, res) => {
  const parsed = ListSignalsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { symbol, type, limit } = parsed.data;

  const rows = await db
    .select()
    .from(signalsTable)
    .where(
      and(
        symbol ? eq(signalsTable.symbol, symbol) : undefined,
        type ? eq(signalsTable.type, type) : undefined,
      ),
    )
    .orderBy(desc(signalsTable.createdAt))
    .limit(limit ?? 20);

  res.json(rows);
});

router.get("/signals/summary", async (_req, res) => {
  const rows = await db
    .select({
      type: signalsTable.type,
      count: sql<number>`count(*)::int`,
    })
    .from(signalsTable)
    .groupBy(signalsTable.type);

  const buyCount = rows.find((r) => r.type === "BUY")?.count ?? 0;
  const sellCount = rows.find((r) => r.type === "SELL")?.count ?? 0;
  const holdCount = rows.find((r) => r.type === "HOLD")?.count ?? 0;
  const total = buyCount + sellCount + holdCount;

  const lastRow = await db
    .select({ createdAt: signalsTable.createdAt })
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt))
    .limit(1);

  res.json({
    total,
    buyCount,
    sellCount,
    holdCount,
    trackedSymbols: TRACKED_SYMBOLS.length,
    lastUpdated: lastRow[0]?.createdAt ?? new Date(),
  });
});

router.get("/signals/history", async (req, res) => {
  const parsed = GetSignalsHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { symbol, limit } = parsed.data;

  const rows = await db
    .select()
    .from(signalsTable)
    .where(symbol ? eq(signalsTable.symbol, symbol) : undefined)
    .orderBy(desc(signalsTable.createdAt))
    .limit(limit ?? 50);

  res.json(rows);
});

async function tryAutoTrade(
  signalId: number,
  symbol: string,
  type: "BUY" | "SELL" | "HOLD",
  price: number,
  confidence: number,
  atr = 0,
): Promise<void> {
  if (type === "HOLD") return;

  const config = await getTradeConfig();
  if (!config.autoTradeEnabled) return;
  if (confidence < config.minConfidence) return;

  // Prevent duplicate: skip BUY if we already hold an open position for this symbol
  if (type === "BUY") {
    if (_inFlightBuySymbols.has(symbol)) {
      logger.info({ symbol }, "BUY skipped: trade already in progress for this symbol");
      return;
    }
    _inFlightBuySymbols.add(symbol);

    const existing = await db
      .select({ id: tradesTable.id })
      .from(tradesTable)
      .where(
        and(
          eq(tradesTable.symbol, symbol),
          eq(tradesTable.side, "BUY"),
          inArray(tradesTable.status, ["PENDING", "FILLED"]),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      logger.info({ symbol, existingTradeId: existing[0].id }, "BUY skipped: position already open or pending for this symbol");
      _inFlightBuySymbols.delete(symbol);
      return;
    }

    // ── Risk gate: daily drawdown + position concentration ───────────────────
    const riskCheck = await canOpenNewPosition(symbol);
    if (!riskCheck.allowed) {
      logger.warn({ symbol, reason: riskCheck.reason }, "BUY blocked by risk manager");
      _inFlightBuySymbols.delete(symbol);
      return;
    }

    // ── Correlation gate: don't open a highly correlated duplicate position ──
    const openSymbols = await db
      .select({ symbol: tradesTable.symbol })
      .from(tradesTable)
      .where(and(eq(tradesTable.status, "FILLED"), eq(tradesTable.side, "BUY")));
    const openSymbolList = openSymbols.map((r) => r.symbol);
    const corrCheck = await findHighlyCorrelatedPosition(symbol, openSymbolList, 0.85);
    if (corrCheck.correlated) {
      logger.info(
        { symbol, correlatedWith: corrCheck.withSymbol, correlation: corrCheck.correlation },
        "BUY skipped: highly correlated position already open",
      );
      _inFlightBuySymbols.delete(symbol);
      return;
    }
  }

  const creds = await getCdcCreds();
  if (!creds) {
    logger.warn({ symbol }, "Auto-trade skipped: no Crypto.com API keys configured");
    if (type === "BUY") _inFlightBuySymbols.delete(symbol);
    return;
  }

  const MIN_NOTIONAL = 10;
  let tradeNotional = MIN_NOTIONAL;
  let quoteCurrency: "USDT" | "USD" | "USDC" = "USDT";

  // ATR-based dynamic stop loss: 2x ATR gives breathing room for volatility
  // Capped between 3% (minimum) and 9% (maximum risk per trade)
  const atrPct = atr > 0 && price > 0 ? (atr / price) * 100 : config.stopLossPct;
  const dynamicSlPct = Math.max(3, Math.min(9, atrPct * 2));

  // ── Regime-aware TP multiplier ────────────────────────────────────────────
  // In a strong bull trend, extend TP target to capture bigger moves.
  // In volatile or ranging markets, take profits faster to avoid reversals.
  const regime = getLastRegime();
  const tpMultiplier =
    regime?.regime === "TRENDING_BULL" ? 2.0  : // double the target in bull trends
    regime?.regime === "VOLATILE"      ? 0.6  : // quick exit in volatile conditions
    regime?.regime === "RANGING"       ? 0.8  : // tighter target in ranges
    regime?.regime === "CONSOLIDATING" ? 0.75 : // tightest in consolidation
    1.0;
  const effectiveTpPct = +(config.takeProfitPct * tpMultiplier).toFixed(2);

  if (type === "BUY") {
    // Pre-check stablecoin balance — skip if none or insufficient
    try {
      const bal = await getStablecoinBalance(creds);
      if (!bal || bal.amount < MIN_NOTIONAL) {
        logger.warn(
          { symbol, balance: bal, required: MIN_NOTIONAL },
          "Auto-trade skipped: insufficient stablecoin balance",
        );
        _inFlightBuySymbols.delete(symbol);
        return;
      }
      quoteCurrency = bal.currency;
      // Dynamic position sizing based on confidence + balance (no hard cap):
      //  confidence ≥ 90% → 22% of balance (max conviction)
      //  confidence ≥ 80% → 16% of balance (high conviction)
      //  confidence ≥ 70% → 12% of balance (standard entry)
      // Max = 30% of balance or $200, whichever is smaller (to avoid over-concentration)
      const MAX_NOTIONAL = Math.min(200, bal.amount * 0.30);
      const balPct  = confidence >= 90 ? 0.22 : confidence >= 80 ? 0.16 : 0.12;
      const minSize = confidence >= 90 ? 15   : confidence >= 80 ? 12   : 10;
      tradeNotional = Math.min(MAX_NOTIONAL, Math.max(minSize, bal.amount * balPct));
      logger.info(
        { symbol, amount: bal.amount, currency: bal.currency, confidence, tradeNotional, dynamicSlPct: dynamicSlPct.toFixed(2), tpMultiplier, effectiveTpPct, regime: regime?.regime ?? "UNKNOWN" },
        "Balance check passed for BUY — regime-aware TP applied",
      );
    } catch (err) {
      logger.warn({ symbol, err: (err as Error).message }, "Balance check failed, skipping BUY");
      _inFlightBuySymbols.delete(symbol);
      return;
    }
  } else {
    // SELL — check we actually hold the crypto; determine quote from stablecoin
    try {
      const holding = await getCryptoHolding(creds, symbol);
      if (holding <= 0) {
        logger.info({ symbol }, "Auto-sell skipped: no position held");
        return;
      }
      logger.info({ symbol, holding }, "Position found — auto-sell triggered");
      // Detect quote currency so instrument name is correct (BTC_USD vs BTC_USDT)
      const bal = await getStablecoinBalance(creds);
      if (bal) quoteCurrency = bal.currency;
    } catch (err) {
      logger.warn({ symbol, err: (err as Error).message }, "Holding check failed, skipping SELL");
      return;
    }
  }

  // ── Acquire global trade lock ──────────────────────────────────────────────
  // Only one trade can execute at a time to prevent race conditions where
  // multiple symbols pass the balance check simultaneously then all fail with
  // "insufficient balance" from the exchange.
  await acquireTradeLock();
  logger.info({ symbol, type }, "Trade lock acquired — proceeding to execute");

  // Insert trade record in PENDING state
  const [trade] = await db
    .insert(tradesTable)
    .values({
      symbol,
      signalId,
      side: type,
      quantity: 0,
      entryPrice: price,
      tpPrice: 0,
      slPrice: 0,
      status: "PENDING",
      confidence,
    })
    .returning();

  logger.info({ symbol, type, confidence }, "Auto-trade triggered on Crypto.com Exchange");

  try {
    const result = await executeCdcTrade(
      creds,
      symbol,
      type,
      price,
      type === "BUY" ? effectiveTpPct : config.takeProfitPct,
      type === "BUY" ? dynamicSlPct : config.stopLossPct,
      quoteCurrency,
      tradeNotional,
    );

    await db
      .update(tradesTable)
      .set({
        quantity: result.quantity,
        entryPrice: result.entryPrice,
        tpPrice: result.tpPrice,
        slPrice: result.slPrice,
        status: "FILLED",
        binanceOrderId: `${result.orderId}|quote:${quoteCurrency}`, // column reused for CDC order ID
      })
      .where(eq(tradesTable.id, trade.id));

    logger.info({ symbol, orderId: result.orderId }, "Auto-trade filled on Crypto.com Exchange");
  } catch (err) {
    const raw = (err as Error).message ?? "Unknown error";
    // Map known exchange error codes to human-readable messages
    let msg = raw;
    if (raw.includes("306") || raw.includes("INSUFFICIENT_AVAILABLE_BALANCE")) {
      msg = "Insufficient balance — deposit funds to your Crypto.com Exchange Spot wallet";
    } else if (raw.includes("40101") || raw.includes("Authentication failure")) {
      msg = "Authentication failed — check API key and IP whitelist in Settings";
    } else if (raw.includes("213") || raw.includes("Invalid quantity")) {
      msg = "Invalid order quantity — contact support";
    } else if (raw.includes("No ") && raw.includes("position to sell")) {
      msg = "No position to sell — asset not held in account";
    }
    logger.error({ symbol, err: raw }, "Auto-trade failed");
    await db
      .update(tradesTable)
      .set({ status: "FAILED", errorMessage: msg })
      .where(eq(tradesTable.id, trade.id));
  } finally {
    releaseTradeLock();
    if (type === "BUY") _inFlightBuySymbols.delete(symbol);
    logger.info({ symbol, type }, "Trade lock released");
  }
}

export async function refreshSignals(): Promise<void> {
  // Compute all signals in parallel for speed
  const signalResults = await Promise.allSettled(
    TRACKED_SYMBOLS.map((symbol) => computeSignal(symbol)),
  );

  // Collect valid signals
  const validSignals: NonNullable<Awaited<ReturnType<typeof computeSignal>>>[] = [];
  for (let i = 0; i < signalResults.length; i++) {
    const result = signalResults[i];
    if (result.status === "rejected") {
      logger.error({ symbol: TRACKED_SYMBOLS[i], err: result.reason }, "Signal computation failed");
      continue;
    }
    if (result.value) validSignals.push(result.value);
  }

  if (validSignals.length === 0) return;

  // Batch insert ALL signals in a single DB round-trip (1 connection instead of 20)
  let savedRows: (typeof signalsTable.$inferSelect)[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      savedRows = await db
        .insert(signalsTable)
        .values(
          validSignals.map((s) => ({
            symbol: s.symbol,
            type: s.type,
            price: s.price,
            rsi: s.rsi,
            maShort: s.maShort,
            maLong: s.maLong,
            confidence: s.confidence,
            reason: s.reason,
          })),
        )
        .returning();
      break;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      const isConnErr = msg.includes("Connection terminated") || msg.includes("socket disconnected") || msg.includes("timeout");
      if (isConnErr && attempt < 3) {
        logger.warn({ attempt, count: validSignals.length }, "Batch signal insert failed (connection), retrying…");
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      } else {
        logger.error({ err: msg }, "Batch signal insert failed after retries");
        return;
      }
    }
  }

  // Fire-and-forget auto-trade for each saved signal (don't block the refresh loop)
  for (const saved of savedRows) {
    const signal = validSignals.find((s) => s.symbol === saved.symbol);
    if (!signal) continue;
    tryAutoTrade(saved.id, signal.symbol, signal.type, signal.price, signal.confidence, signal.atr).catch(
      (err) => logger.error({ symbol: signal.symbol, err: (err as Error).message }, "tryAutoTrade error"),
    );
  }
}

export default router;
