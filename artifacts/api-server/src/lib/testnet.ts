import crypto from "crypto";
import axios from "axios";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const TESTNET_BASE = "https://testnet.binance.vision/api/v3";

const testnetClient = axios.create({
  baseURL: TESTNET_BASE,
  timeout: 10000,
});

export interface BinanceCreds {
  apiKey: string;
  secretKey: string;
}

export interface TradeConfig {
  autoTradeEnabled: boolean;
  minConfidence: number;
  takeProfitPct: number;
  stopLossPct: number;
}

const DEFAULT_CONFIG: TradeConfig = {
  autoTradeEnabled: false,
  minConfidence: 70,
  takeProfitPct: 1.5,
  stopLossPct: 0.3,
};

async function getSettingValue(key: string): Promise<string | null> {
  const row = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .limit(1);
  return row[0]?.value ?? null;
}

export async function getBinanceCreds(): Promise<BinanceCreds | null> {
  // DB takes priority over env vars
  const dbApiKey = await getSettingValue("BINANCE_API_KEY");
  const dbSecretKey = await getSettingValue("BINANCE_SECRET_KEY");

  const apiKey = dbApiKey ?? process.env.BINANCE_API_KEY ?? null;
  const secretKey = dbSecretKey ?? process.env.BINANCE_SECRET_KEY ?? null;

  if (!apiKey || !secretKey) return null;
  return { apiKey, secretKey };
}

export async function getTradeConfig(): Promise<TradeConfig> {
  const [autoTrade, minConf, tpPct, slPct] = await Promise.all([
    getSettingValue("AUTO_TRADE_ENABLED"),
    getSettingValue("MIN_CONFIDENCE"),
    getSettingValue("TAKE_PROFIT_PCT"),
    getSettingValue("STOP_LOSS_PCT"),
  ]);
  return {
    autoTradeEnabled: autoTrade === "true",
    minConfidence: minConf ? parseFloat(minConf) : DEFAULT_CONFIG.minConfidence,
    takeProfitPct: tpPct ? parseFloat(tpPct) : DEFAULT_CONFIG.takeProfitPct,
    stopLossPct: slPct ? parseFloat(slPct) : DEFAULT_CONFIG.stopLossPct,
  };
}

export async function saveTradeConfig(config: TradeConfig): Promise<void> {
  const entries: [string, string][] = [
    ["AUTO_TRADE_ENABLED", String(config.autoTradeEnabled)],
    ["MIN_CONFIDENCE", String(config.minConfidence)],
    ["TAKE_PROFIT_PCT", String(config.takeProfitPct)],
    ["STOP_LOSS_PCT", String(config.stopLossPct)],
  ];
  for (const [key, value] of entries) {
    await db
      .insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  }
}

export async function saveBinanceCreds(apiKey: string, secretKey: string): Promise<void> {
  for (const [key, value] of [["BINANCE_API_KEY", apiKey], ["BINANCE_SECRET_KEY", secretKey]] as const) {
    await db
      .insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  }
}

function sign(queryString: string, secretKey: string): string {
  return crypto.createHmac("sha256", secretKey).update(queryString).digest("hex");
}

function buildSignedParams(params: Record<string, string | number>): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  return query;
}

export interface AccountInfo {
  accountType: string;
  balances: Array<{ asset: string; free: string; locked: string }>;
}

export async function testConnection(creds: BinanceCreds): Promise<AccountInfo> {
  const timestamp = Date.now();
  const params = { timestamp };
  const qs = buildSignedParams(params);
  const signature = sign(qs, creds.secretKey);

  const res = await testnetClient.get<AccountInfo>(`/account?${qs}&signature=${signature}`, {
    headers: { "X-MBX-APIKEY": creds.apiKey },
  });
  return res.data;
}

export interface OrderResult {
  orderId: number;
  symbol: string;
  status: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  fills?: Array<{ price: string; qty: string }>;
}

export async function placeMarketOrder(
  creds: BinanceCreds,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
): Promise<OrderResult> {
  const timestamp = Date.now();
  const params = {
    symbol,
    side,
    type: "MARKET",
    quantity: quantity.toFixed(6),
    timestamp,
    newOrderRespType: "FULL",
  };
  const qs = buildSignedParams(params);
  const signature = sign(qs, creds.secretKey);

  const res = await testnetClient.post<OrderResult>(
    `/order?${qs}&signature=${signature}`,
    null,
    { headers: { "X-MBX-APIKEY": creds.apiKey } },
  );
  return res.data;
}

export interface OcoOrderResult {
  orderListId: number;
  contingencyType: string;
  listStatusType: string;
  orders: Array<{ symbol: string; orderId: number }>;
}

export async function placeOcoOrder(
  creds: BinanceCreds,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
  tpPrice: number,
  slPrice: number,
  slLimitPrice: number,
): Promise<OcoOrderResult> {
  const timestamp = Date.now();
  const params = {
    symbol,
    side,
    quantity: quantity.toFixed(6),
    price: tpPrice.toFixed(8),
    stopPrice: slPrice.toFixed(8),
    stopLimitPrice: slLimitPrice.toFixed(8),
    stopLimitTimeInForce: "GTC",
    timestamp,
  };
  const qs = buildSignedParams(params);
  const signature = sign(qs, creds.secretKey);

  const res = await testnetClient.post<OcoOrderResult>(
    `/order/oco?${qs}&signature=${signature}`,
    null,
    { headers: { "X-MBX-APIKEY": creds.apiKey } },
  );
  return res.data;
}

/** Returns minimum quantity step for a symbol from testnet exchange info */
const symbolStepCache = new Map<string, number>();

export async function getMinQuantity(symbol: string): Promise<number> {
  if (symbolStepCache.has(symbol)) return symbolStepCache.get(symbol)!;
  try {
    const res = await testnetClient.get<{
      symbols: Array<{
        symbol: string;
        filters: Array<{ filterType: string; stepSize?: string; minQty?: string }>;
      }>;
    }>("/exchangeInfo", { params: { symbol } });
    const sym = res.data.symbols.find((s) => s.symbol === symbol);
    const lotFilter = sym?.filters.find((f) => f.filterType === "LOT_SIZE");
    const step = parseFloat(lotFilter?.stepSize ?? "0.001");
    symbolStepCache.set(symbol, step);
    return step;
  } catch {
    return 0.001;
  }
}

/**
 * Execute a trade for a signal:
 * 1. Place a market order
 * 2. Place an OCO order for take-profit and stop-loss on the opposite side
 */
export async function executeTrade(
  creds: BinanceCreds,
  symbol: string,
  side: "BUY" | "SELL",
  price: number,
  takeProfitPct: number,
  stopLossPct: number,
): Promise<{ orderId: string; entryPrice: number; tpPrice: number; slPrice: number; quantity: number }> {
  const step = await getMinQuantity(symbol);

  // Use a small fixed USDT notional for testnet: $20 worth
  const notionalUsdt = 20;
  let quantity = notionalUsdt / price;
  // Round to step size
  quantity = Math.max(step, Math.floor(quantity / step) * step);

  logger.info({ symbol, side, quantity, price }, "Placing market order on testnet");
  const order = await placeMarketOrder(creds, symbol, side, quantity);

  const executedPrice = order.fills?.length
    ? order.fills.reduce((sum, f) => sum + parseFloat(f.price) * parseFloat(f.qty), 0) /
      order.fills.reduce((sum, f) => sum + parseFloat(f.qty), 0)
    : price;

  // OCO is placed on the opposite side to close the position
  const closeSide = side === "BUY" ? "SELL" : "BUY";

  let tpPrice: number;
  let slPrice: number;

  if (side === "BUY") {
    tpPrice = executedPrice * (1 + takeProfitPct / 100);
    slPrice = executedPrice * (1 - stopLossPct / 100);
  } else {
    tpPrice = executedPrice * (1 - takeProfitPct / 100);
    slPrice = executedPrice * (1 + stopLossPct / 100);
  }

  const slLimitPrice = side === "BUY"
    ? slPrice * 0.999
    : slPrice * 1.001;

  logger.info({ symbol, closeSide, tpPrice, slPrice }, "Placing OCO order on testnet");

  try {
    await placeOcoOrder(creds, symbol, closeSide, quantity, tpPrice, slPrice, slLimitPrice);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "OCO order failed (market order still filled)");
  }

  return {
    orderId: String(order.orderId),
    entryPrice: executedPrice,
    tpPrice,
    slPrice,
    quantity,
  };
}
