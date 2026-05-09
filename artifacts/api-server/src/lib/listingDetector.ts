import axios from "axios";
import { db, tradesTable, newListingsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { getCdcCreds, executeCdcTrade, getStablecoinBalance } from "./cdcExchange";
import { getTradeConfig } from "./cdcExchange";
import { canOpenNewPosition } from "./riskManager";
import { findHighlyCorrelatedPosition } from "./correlation";

const BINANCE_BASE = "https://api.binance.us/api/v3";
const MIN_VOLUME_USD = 500_000;
const LISTING_TP_PCT = 10;
const LISTING_SL_PCT = 3;
const LISTING_NOTIONAL = Math.max(
  1,
  Math.min(10, Number(process.env.MAX_TRADE_NOTIONAL_USD ?? "10")),
);

let knownSymbols: Set<string> | null = null;
let listingTradeRunning = false;

export async function initListingDetector(): Promise<void> {
  try {
    const res = await axios.get<{ symbols: Array<{ symbol: string; status: string }> }>(
      `${BINANCE_BASE}/exchangeInfo`,
      { timeout: 10000 },
    );
    knownSymbols = new Set(
      res.data.symbols
        .filter((s) => s.symbol.endsWith("USDT") && s.status === "TRADING")
        .map((s) => s.symbol),
    );
    logger.info({ count: knownSymbols.size }, "Listing detector: initialized known symbols");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Listing detector: init failed, will retry");
    knownSymbols = new Set();
  }
}

export async function detectNewListings(): Promise<void> {
  if (!knownSymbols) {
    await initListingDetector();
    return;
  }

  try {
    const res = await axios.get<{ symbols: Array<{ symbol: string; status: string }> }>(
      `${BINANCE_BASE}/exchangeInfo`,
      { timeout: 10000 },
    );

    const currentSymbols = res.data.symbols
      .filter((s) => s.symbol.endsWith("USDT") && s.status === "TRADING")
      .map((s) => s.symbol);

    const newOnes = currentSymbols.filter((s) => !knownSymbols!.has(s));

    for (const s of currentSymbols) knownSymbols.add(s);

    if (newOnes.length === 0) return;

    logger.info({ newOnes }, "NEW LISTING DETECTED on Binance");

    for (const symbol of newOnes) {
      try {
        await db
          .insert(newListingsTable)
          .values({
            symbol,
            instrument: `${symbol.slice(0, -4)}_USDT`,
            status: "DETECTED",
          })
          .onConflictDoNothing();
      } catch {
        // already in DB
      }

      await attemptListingTrade(symbol);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Listing detector: poll error");
  }
}

async function attemptListingTrade(symbol: string): Promise<void> {
  const creds = await getCdcCreds();
  if (!creds) return;

  const config = await getTradeConfig();
  if (!config.autoTradeEnabled) {
    logger.info({ symbol }, "Auto-trade disabled — listing detected but not bought");
    return;
  }
  if (process.env.ENABLE_LISTING_AUTO_TRADE !== "true") {
    logger.info(
      { symbol },
      "Listing auto-trade blocked: set ENABLE_LISTING_AUTO_TRADE=true to enable this high-risk strategy",
    );
    return;
  }
  if (listingTradeRunning) {
    logger.info({ symbol }, "Listing trade skipped: another listing trade is already running");
    return;
  }
  listingTradeRunning = true;

  try {
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
      logger.info({ symbol, existingTradeId: existing[0].id }, "Listing BUY skipped: position already open or pending");
      return;
    }

    const riskCheck = await canOpenNewPosition(symbol);
    if (!riskCheck.allowed) {
      logger.warn({ symbol, reason: riskCheck.reason }, "Listing BUY blocked by risk manager");
      return;
    }

    const openSymbols = await db
      .select({ symbol: tradesTable.symbol })
      .from(tradesTable)
      .where(and(eq(tradesTable.status, "FILLED"), eq(tradesTable.side, "BUY")));
    const corrCheck = await findHighlyCorrelatedPosition(symbol, openSymbols.map((row) => row.symbol), 0.85);
    if (corrCheck.correlated) {
      logger.info(
        { symbol, correlatedWith: corrCheck.withSymbol, correlation: corrCheck.correlation },
        "Listing BUY skipped: highly correlated position already open",
      );
      return;
    }

    const tickerRes = await axios.get<{ lastPrice: string; quoteVolume: string }>(
      `${BINANCE_BASE}/ticker/24hr`,
      { params: { symbol }, timeout: 5000 },
    );
    const price = parseFloat(tickerRes.data.lastPrice);
    const volume = parseFloat(tickerRes.data.quoteVolume);

    if (volume < MIN_VOLUME_USD) {
      logger.info({ symbol, volume }, "Listing skipped: insufficient volume");
      await db
        .update(newListingsTable)
        .set({ status: "SKIPPED", volume24h: volume })
        .where(eq(newListingsTable.symbol, symbol));
      return;
    }

    const bal = await getStablecoinBalance(creds);
    if (!bal || bal.amount < LISTING_NOTIONAL) {
      logger.warn({ symbol, balance: bal?.amount }, "Listing skipped: insufficient balance");
      return;
    }

    const result = await executeCdcTrade(
      creds,
      symbol,
      "BUY",
      price,
      LISTING_TP_PCT,
      LISTING_SL_PCT,
      bal.currency,
      LISTING_NOTIONAL,
    );

    await db.insert(tradesTable).values({
      symbol,
      side: "BUY",
      quantity: result.quantity,
      entryPrice: result.entryPrice,
      tpPrice: result.tpPrice,
      slPrice: result.slPrice,
      status: "FILLED",
      binanceOrderId: `${result.orderId}|quote:${bal.currency}`,
      confidence: 75,
      isListing: true,
    });

    await db
      .update(newListingsTable)
      .set({
        tradeExecuted: true,
        orderId: result.orderId,
        entryPrice: price,
        tpPrice: result.tpPrice,
        slPrice: result.slPrice,
        volume24h: volume,
        status: "BOUGHT",
      })
      .where(eq(newListingsTable.symbol, symbol));

    logger.info(
      { symbol, price, tpPrice: result.tpPrice, slPrice: result.slPrice },
      "Listing quick-flip trade placed (TP +10%, SL -3%, time exit 30 min)",
    );
  } catch (err) {
    logger.error({ symbol, err: (err as Error).message }, "Listing trade failed");
  } finally {
    listingTradeRunning = false;
  }
}
