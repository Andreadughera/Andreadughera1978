import { Router } from "express";
import { db, newListingsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

router.get("/listings", async (_req, res) => {
  const rows = await db
    .select()
    .from(newListingsTable)
    .orderBy(desc(newListingsTable.firstSeenAt))
    .limit(50);
  res.json(rows);
});

export default router;
