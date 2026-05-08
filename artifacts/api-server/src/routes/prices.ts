import { Router } from "express";
import { get24hTickers, getKlines, TRACKED_SYMBOLS } from "../lib/binance";
import { GetPriceHistoryQueryParams } from "@workspace/api-zod";
import { GetPriceHistoryParams } from "@workspace/api-zod";

const router = Router();

router.get("/prices", async (_req, res) => {
  const tickers = await get24hTickers(TRACKED_SYMBOLS);
  const prices = tickers.map((t) => ({
    symbol: t.symbol,
    price: parseFloat(t.lastPrice),
    priceChange: parseFloat(t.priceChange),
    priceChangePercent: parseFloat(t.priceChangePercent),
    volume: parseFloat(t.volume),
    high: parseFloat(t.highPrice),
    low: parseFloat(t.lowPrice),
    updatedAt: new Date(),
  }));
  res.json(prices);
});

router.get("/prices/:symbol", async (req, res) => {
  const paramsParsed = GetPriceHistoryParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.issues });
    return;
  }
  const { symbol } = paramsParsed.data;

  const queryParsed = GetPriceHistoryQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.issues });
    return;
  }
  const { interval, limit } = queryParsed.data;

  const klines = await getKlines(symbol, interval, limit);
  const candles = klines.map((k) => ({
    openTime: k.openTime,
    open: parseFloat(k.open),
    high: parseFloat(k.high),
    low: parseFloat(k.low),
    close: parseFloat(k.close),
    volume: parseFloat(k.volume),
    closeTime: k.closeTime,
  }));
  res.json(candles);
});

export default router;
