import { Router } from "express";
import { db, dailyReportsTable, tradesTable } from "@workspace/db";
import { desc, eq, and, sql } from "drizzle-orm";
import { generateDailyReport } from "../lib/positionMonitor";

const router = Router();

router.get("/reports", async (_req, res) => {
  const rows = await db
    .select()
    .from(dailyReportsTable)
    .orderBy(desc(dailyReportsTable.date))
    .limit(30);
  res.json(rows);
});

router.get("/reports/today", async (_req, res) => {
  const today = new Date();
  const startOfDay = new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  const closedToday = await db
    .select()
    .from(tradesTable)
    .where(
      and(
        eq(tradesTable.side, "BUY"),
        eq(tradesTable.status, "CLOSED"),
        sql`${tradesTable.closedAt} >= ${startOfDay}`,
      ),
    );

  const openPositions = await db
    .select()
    .from(tradesTable)
    .where(and(eq(tradesTable.status, "FILLED"), eq(tradesTable.side, "BUY")));

  const pnlUsd = closedToday.reduce((acc, t) => acc + (t.pnlUsd ?? 0), 0);
  const winCount = closedToday.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const lossCount = closedToday.filter((t) => (t.pnlUsd ?? 0) < 0).length;

  res.json({
    date: today.toISOString().split("T")[0],
    tradesCount: closedToday.length,
    winCount,
    lossCount,
    pnlUsd,
    openPositionsCount: openPositions.length,
    openPositions: openPositions.map((t) => ({
      symbol: t.symbol,
      entryPrice: t.entryPrice,
      tpPrice: t.tpPrice,
      slPrice: t.slPrice,
      isListing: t.isListing,
      createdAt: t.createdAt,
    })),
  });
});

// Trigger report generation manually
router.post("/reports/generate", async (_req, res) => {
  try {
    await generateDailyReport();
    res.json({ ok: true, message: "Report generated" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
