import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authRouter, requireAuth } from "./lib/auth";
import { refreshSignals } from "./routes/signals";
import { monitorOpenPositions, generateDailyReport } from "./lib/positionMonitor";
import { initListingDetector, detectNewListings } from "./lib/listingDetector";
import { detectMarketRegime } from "./lib/marketRegime";
import { buildCorrelationMatrix } from "./lib/correlation";
import { runSelfTuning } from "./lib/selfTuner";

const app: Express = express();

// Disable ETag generation so API responses never return 304 Not Modified.
app.set("etag", false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (process.env.NODE_ENV !== "production" || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin not allowed"));
    },
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Force no-cache on all API responses so browsers never serve stale data
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api", authRouter);
app.use("/api", requireAuth);
app.use("/api", router);

// ─── Signal refresh every 60s (with overlap guard) ───────────────────────────
const SIGNAL_REFRESH_INTERVAL_MS = 60 * 1000;
let _refreshRunning = false;

async function runRefresh(label: string) {
  if (_refreshRunning) {
    logger.warn("Signal refresh skipped — previous cycle still running");
    return;
  }
  _refreshRunning = true;
  try {
    await refreshSignals();
    logger.info(`${label} signal refresh complete`);
  } catch (err) {
    logger.error({ err }, `${label} signal refresh failed`);
  } finally {
    _refreshRunning = false;
  }
}

async function startSignalRefresh() {
  // Delay initial refresh by 15s so the server is fully up and passes health checks first
  logger.info("Signal refresh scheduled — starting in 15s...");
  setTimeout(async () => {
    await runRefresh("Initial");
    setInterval(() => runRefresh("Periodic"), SIGNAL_REFRESH_INTERVAL_MS);
  }, 15_000);
}

// ─── Position monitor every 2 minutes ────────────────────────────────────────
const POSITION_MONITOR_INTERVAL_MS = 2 * 60 * 1000;

async function startPositionMonitor() {
  logger.info("Position monitor started (server-side TP/SL every 2 min)");
  setInterval(async () => {
    try {
      await monitorOpenPositions();
    } catch (err) {
      logger.error({ err }, "Position monitor error");
    }
  }, POSITION_MONITOR_INTERVAL_MS);
  try {
    await monitorOpenPositions();
  } catch (err) {
    logger.error({ err }, "Initial position monitor check failed");
  }
}

// ─── New listing detector every 5 minutes ────────────────────────────────────
const LISTING_DETECTOR_INTERVAL_MS = 5 * 60 * 1000;

async function startListingDetector() {
  await initListingDetector();
  logger.info("New listing detector started (polling every 5 min)");
  setInterval(async () => {
    try {
      await detectNewListings();
    } catch (err) {
      logger.error({ err }, "Listing detector error");
    }
  }, LISTING_DETECTOR_INTERVAL_MS);
}

// ─── Market regime detection every 15 minutes ────────────────────────────────
async function startMarketRegimeDetector() {
  try {
    const regime = await detectMarketRegime();
    logger.info({ regime: regime.regime, adx: regime.adx }, "Initial market regime detected");
  } catch (err) {
    logger.warn({ err }, "Initial market regime detection failed");
  }
  setInterval(async () => {
    try {
      await detectMarketRegime();
    } catch (err) {
      logger.warn({ err }, "Periodic market regime detection failed");
    }
  }, 15 * 60 * 1000);
}

// ─── Correlation matrix refresh every 30 minutes ─────────────────────────────
async function startCorrelationRefresh() {
  // Build correlation matrix in background (non-blocking startup)
  setTimeout(async () => {
    try {
      await buildCorrelationMatrix();
      logger.info("Correlation matrix built");
    } catch (err) {
      logger.warn({ err }, "Correlation matrix build failed");
    }
  }, 30_000); // wait 30s after startup before first build

  setInterval(async () => {
    try {
      await buildCorrelationMatrix();
    } catch (err) {
      logger.warn({ err }, "Periodic correlation refresh failed");
    }
  }, 30 * 60 * 1000);
}

// ─── Self-tuner every hour ────────────────────────────────────────────────────
async function startSelfTuner() {
  setTimeout(async () => {
    try {
      await runSelfTuning();
      logger.info("Self-tuner initial analysis complete");
    } catch (err) {
      logger.warn({ err }, "Self-tuner initial analysis failed");
    }
  }, 60_000); // wait 1 min after startup

  setInterval(async () => {
    try {
      await runSelfTuning();
    } catch (err) {
      logger.warn({ err }, "Periodic self-tuning failed");
    }
  }, 60 * 60 * 1000);
}

// ─── Daily report at 8:00 AM UTC ─────────────────────────────────────────────
let lastReportDate = "";

setInterval(async () => {
  const now = new Date();
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  const today = now.toISOString().split("T")[0];
  if (hour === 8 && minute < 1 && lastReportDate !== today) {
    lastReportDate = today;
    try {
      await generateDailyReport();
      logger.info({ date: today }, "Scheduled daily report generated");
    } catch (err) {
      logger.error({ err }, "Daily report generation failed");
    }
  }
}, 60 * 1000);

// ─── Start all services ───────────────────────────────────────────────────────
startSignalRefresh();
startPositionMonitor();
startListingDetector();
startMarketRegimeDetector();
startCorrelationRefresh();
startSelfTuner();

export default app;
