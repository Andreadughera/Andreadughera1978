import { Router } from "express";
import { getSentimentData } from "../lib/sentiment";

const router = Router();

router.get("/sentiment", async (req, res) => {
  try {
    const data = await getSentimentData();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch sentiment data");
    res.status(500).json({ error: "Failed to fetch sentiment data" });
  }
});

export default router;
