import { Router } from "express";
import { z } from "zod";
import {
  getCdcCreds,
  saveCdcCreds,
  getTradeConfig,
  saveTradeConfig,
  testCdcConnection,
  invalidateCredsCache,
} from "../lib/cdcExchange";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getServerIp } from "./health";

const router = Router();

// ─── GET /settings/exchange ────────────────────────────────────────────────
router.get("/settings/exchange", async (_req, res) => {
  const creds = await getCdcCreds();
  const config = await getTradeConfig();

  const dbApiKey = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "CDC_API_KEY"))
    .limit(1);

  const apiKeyFromDb = dbApiKey.length > 0;
  const source = apiKeyFromDb ? "db" : process.env.CDC_API_KEY ? "env" : "none";

  res.json({
    apiKeyConfigured: !!creds?.apiKey,
    secretKeyConfigured: !!creds?.secretKey,
    autoTradeEnabled: config.autoTradeEnabled,
    minConfidence: config.minConfidence,
    takeProfitPct: config.takeProfitPct,
    stopLossPct: config.stopLossPct,
    source,
  });
});

// ─── POST /settings/exchange ───────────────────────────────────────────────
const SaveBody = z.object({
  apiKey: z.string().nullable().optional(),
  secretKey: z.string().nullable().optional(),
  autoTradeEnabled: z.boolean(),
  minConfidence: z.number().min(0).max(100),
  takeProfitPct: z.number().min(0.01).max(20),
  stopLossPct: z.number().min(0.01).max(10),
});

router.post("/settings/exchange", async (req, res) => {
  const parsed = SaveBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { apiKey, secretKey, autoTradeEnabled, minConfidence, takeProfitPct, stopLossPct } =
    parsed.data;

  if (apiKey && secretKey) {
    await saveCdcCreds(apiKey, secretKey);
    invalidateCredsCache();
  }

  await saveTradeConfig({ autoTradeEnabled, minConfidence, takeProfitPct, stopLossPct });

  const creds = await getCdcCreds();
  const dbApiKey = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "CDC_API_KEY"))
    .limit(1);
  const source = dbApiKey.length > 0 ? "db" : process.env.CDC_API_KEY ? "env" : "none";

  res.json({
    apiKeyConfigured: !!creds?.apiKey,
    secretKeyConfigured: !!creds?.secretKey,
    autoTradeEnabled,
    minConfidence,
    takeProfitPct,
    stopLossPct,
    source,
  });
});

// ─── POST /settings/exchange/test ──────────────────────────────────────────
router.post("/settings/exchange/test", async (_req, res) => {
  const creds = await getCdcCreds();
  if (!creds) {
    res.json({
      success: false,
      message: "No API keys configured. Add your Crypto.com Exchange API key and secret above.",
      accountType: null,
      balances: null,
    });
    return;
  }
  try {
    const account = await testCdcConnection(creds);
    res.json({
      success: true,
      message: "Connected to Crypto.com Exchange successfully",
      accountType: account.accountType,
      balances: account.balances.slice(0, 10),
    });
  } catch (err) {
    const raw = (err as Error).message ?? "";
    let message = raw;

    // Map Crypto.com error codes to actionable guidance
    if (raw.includes("40101") || raw.includes("Authentication failure")) {
      const serverIp = await getServerIp().catch(() => "check Settings page");
      message =
        "Authentication failure (code 40101). Check the following:\n" +
        "1. Keys must be from crypto.com/exchange → API Management (not from the main Crypto.com app).\n" +
        `2. IP ${serverIp} must be added to the API key's IP whitelist.\n` +
        "3. The key must have 'Trading' permissions enabled.\n" +
        "4. Re-copy both keys carefully — no extra spaces or line breaks.";
    } else if (raw.includes("306") || raw.includes("INSUFFICIENT_AVAILABLE_BALANCE")) {
      message = "Connected successfully but account has insufficient USDT balance. Deposit USDT to your Crypto.com Exchange Spot wallet to enable auto-trading.";
    } else if (raw.includes("ECONNREFUSED") || raw.includes("ENOTFOUND")) {
      message = "Cannot reach Crypto.com Exchange API. Check your network/firewall.";
    }

    res.json({
      success: false,
      message,
      accountType: null,
      balances: null,
    });
  }
});

// ─── POST /settings/exchange/kill-switch ───────────────────────────────────
router.post("/settings/exchange/kill-switch", async (_req, res) => {
  const config = await getTradeConfig();
  await saveTradeConfig({ ...config, autoTradeEnabled: false });
  res.json({
    success: true,
    autoTradeEnabled: false,
    message: "Auto-trade disabled",
  });
});

export default router;
