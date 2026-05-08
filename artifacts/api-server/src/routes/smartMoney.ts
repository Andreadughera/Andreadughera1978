import { Router } from "express";
import { getAllSmartMoney } from "../lib/smartMoney";
import { TRACKED_SYMBOLS } from "../lib/binance";

const router = Router();

router.get("/smart-money", async (_req, res) => {
  try {
    const data = await getAllSmartMoney(TRACKED_SYMBOLS);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
