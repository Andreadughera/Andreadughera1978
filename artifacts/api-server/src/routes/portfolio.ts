import { Router } from "express";
import {
  getPortfolioStats,
  getEquityCurve,
  getSymbolStats,
  getOpenPositionsWithPnl,
} from "../lib/portfolioAnalytics";
import { detectMarketRegime } from "../lib/marketRegime";
import { buildCorrelationMatrix } from "../lib/correlation";
import { getTunedParams, runSelfTuning } from "../lib/selfTuner";
import { getRiskSummary } from "../lib/riskManager";
import { logger } from "../lib/logger";

const router = Router();

router.get("/portfolio/stats", async (req, res) => {
  try {
    const stats = await getPortfolioStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Portfolio stats failed");
    res.status(500).json({ error: "Failed to compute portfolio stats" });
  }
});

router.get("/portfolio/equity-curve", async (req, res) => {
  try {
    const days = parseInt(String(req.query.days ?? "30"), 10) || 30;
    const curve = await getEquityCurve(Math.min(90, Math.max(7, days)));
    res.json(curve);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Equity curve failed");
    res.status(500).json({ error: "Failed to build equity curve" });
  }
});

router.get("/portfolio/symbols", async (_req, res) => {
  try {
    const stats = await getSymbolStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Symbol stats failed");
    res.status(500).json({ error: "Failed to compute symbol stats" });
  }
});

router.get("/portfolio/positions", async (_req, res) => {
  try {
    const positions = await getOpenPositionsWithPnl();
    res.json(positions);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Open positions failed");
    res.status(500).json({ error: "Failed to fetch open positions" });
  }
});

router.get("/portfolio/regime", async (_req, res) => {
  try {
    const regime = await detectMarketRegime();
    res.json(regime);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Market regime failed");
    res.status(500).json({ error: "Failed to detect market regime" });
  }
});

router.get("/portfolio/correlation", async (_req, res) => {
  try {
    const matrix = await buildCorrelationMatrix();
    res.json(matrix);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Correlation matrix failed");
    res.status(500).json({ error: "Failed to build correlation matrix" });
  }
});

router.get("/portfolio/tuner", async (_req, res) => {
  try {
    // Run tuning if not done recently (non-blocking)
    runSelfTuning().catch(() => {});
    const params = getTunedParams();
    if (!params) {
      res.json({ status: "analyzing", message: "Self-tuner initializing — check back in a moment" });
      return;
    }
    res.json(params);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Self-tuner endpoint failed");
    res.status(500).json({ error: "Failed to get tuner params" });
  }
});

router.get("/portfolio/risk", async (_req, res) => {
  try {
    const risk = await getRiskSummary();
    res.json(risk);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Risk summary failed");
    res.status(500).json({ error: "Failed to get risk summary" });
  }
});

export default router;
