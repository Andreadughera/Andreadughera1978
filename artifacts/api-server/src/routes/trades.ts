import { Router } from "express";
import { db, tradesTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

const router = Router();

router.get("/trades", async (req, res) => {
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
  const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;

  const rows = await db
    .select()
    .from(tradesTable)
    .where(symbol ? eq(tradesTable.symbol, symbol) : undefined)
    .orderBy(desc(tradesTable.createdAt))
    .limit(limit);

  res.json(rows);
});

router.get("/trades/stats", async (_req, res) => {
  const rows = await db
    .select({
      status: tradesTable.status,
      side: tradesTable.side,
      count: sql<number>`count(*)::int`,
    })
    .from(tradesTable)
    .groupBy(tradesTable.status, tradesTable.side);

  const total  = rows.reduce((s, r) => s + r.count, 0);
  const filled  = rows.filter((r) => r.status === "FILLED").reduce((s, r) => s + r.count, 0);
  const closed  = rows.filter((r) => r.status === "CLOSED").reduce((s, r) => s + r.count, 0);
  const failed  = rows.filter((r) => r.status === "FAILED").reduce((s, r) => s + r.count, 0);
  const pending = rows.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.count, 0);
  // executed = actually reached the exchange (FILLED + CLOSED), meaningful metric
  const executed = filled + closed;

  res.json({ total, executed, filled, closed, failed, pending });
});

export default router;
