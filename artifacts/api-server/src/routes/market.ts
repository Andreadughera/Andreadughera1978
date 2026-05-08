import { Router } from "express";
import { get24hTickers, TRACKED_SYMBOLS } from "../lib/binance";

const router = Router();

router.get("/market/overview", async (_req, res) => {
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

  const sorted = [...prices].sort(
    (a, b) => b.priceChangePercent - a.priceChangePercent,
  );

  const topGainers = sorted.slice(0, 3);
  const topLosers = sorted.slice(-3).reverse();
  const volumeLeaders = [...prices]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 3);

  res.json({
    topGainers,
    topLosers,
    volumeLeaders,
    totalSymbols: prices.length,
    updatedAt: new Date(),
  });
});

export default router;
