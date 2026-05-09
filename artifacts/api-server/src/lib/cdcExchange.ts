import crypto from "crypto";
import axios from "axios";
import https from "https";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const CDC_BASE = "https://api.crypto.com/exchange/v1";

// Explicit IPv4-only agent — ensures outbound IP matches the whitelisted IPv4 address
const ipv4Agent = new https.Agent({ family: 4 });

const cdcClient = axios.create({
  baseURL: CDC_BASE,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
  httpsAgent: ipv4Agent,
});

interface CdcInstrumentEntry {
  instrument_name: string;
}

interface CdcInstrumentsResponse {
  code: number;
  result?: {
    instruments?: CdcInstrumentEntry[];
    data?: CdcInstrumentEntry[];
  };
  message?: string;
}

let instrumentCache: { names: Set<string>; at: number } | null = null;
const INSTRUMENT_CACHE_MS = 60 * 60 * 1000;

export interface CdcCreds {
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
  takeProfitPct: 15,
  stopLossPct: 5,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSettingValue(key: string): Promise<string | null> {
  const row = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .limit(1);
  return row[0]?.value ?? null;
}

async function setSettingValue(key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, updatedAt: new Date() },
    });
}

function getSettingsEncryptionKey(): Buffer | null {
  const raw = (
    process.env.SETTINGS_ENCRYPTION_KEY ??
    process.env.SESSION_SECRET ??
    ""
  ).trim();
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptSettingValue(value: string): string {
  const key = getSettingsEncryptionKey();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSettingValue(value: string | null): string | null {
  if (!value || !value.startsWith("enc:v1:")) return value;
  const key = getSettingsEncryptionKey();
  if (!key) {
    throw new Error("Encrypted setting cannot be read because SETTINGS_ENCRYPTION_KEY is not configured");
  }
  const [, , ivRaw, tagRaw, encryptedRaw] = value.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Quantity decimal precision per Crypto.com Exchange instrument.
 * Sending more decimals than the tick size causes error 213.
 */
const QTY_DECIMALS: Record<string, number> = {
  // _USDT pairs
  BTC_USDT:   4, ETH_USDT:  3, BNB_USDT:  2, SOL_USDT:  2,
  ADA_USDT:   0, XRP_USDT:  0, DOT_USDT:  1, LINK_USDT: 2,
  AVAX_USDT:  2, MATIC_USDT:0, UNI_USDT:  2, ATOM_USDT: 2,
  LTC_USDT:   3, NEAR_USDT: 1, APT_USDT:  2, TRX_USDT:  0,
  FTM_USDT:   0, ALGO_USDT: 0, DOGE_USDT: 0, FIL_USDT:  2,
  // _USD pairs (Crypto.com Exchange native USD)
  BTC_USD:    4, ETH_USD:   3, BNB_USD:   2, SOL_USD:   2,
  ADA_USD:    0, XRP_USD:   0, DOT_USD:   1, LINK_USD:  2,
  AVAX_USD:   2, MATIC_USD: 0, UNI_USD:   2, ATOM_USD:  2,
  LTC_USD:    3, NEAR_USD:  1, APT_USD:   2, TRX_USD:   0,
  FTM_USD:    0, ALGO_USD:  0, DOGE_USD:  0, FIL_USD:   2,
};

function formatQty(instrument: string, qty: number): string {
  const decimals = QTY_DECIMALS[instrument] ?? 4;
  const factor = Math.pow(10, decimals);
  const floored = Math.floor(qty * factor) / factor;
  return floored.toFixed(decimals);
}

/** Price tick size (decimal places) per instrument for limit/TP/SL orders */
const PRICE_DECIMALS: Record<string, number> = {
  // _USDT
  BTC_USDT: 2, ETH_USDT: 2, BNB_USDT: 2, SOL_USDT: 2,
  ADA_USDT: 4, XRP_USDT: 4, DOT_USDT: 4, LINK_USDT: 4,
  AVAX_USDT: 4, MATIC_USDT: 4, UNI_USDT: 4, ATOM_USDT: 4,
  LTC_USDT: 2, NEAR_USDT: 4, APT_USDT: 4, TRX_USDT: 4,
  FTM_USDT: 4, ALGO_USDT: 4, DOGE_USDT: 4, FIL_USDT: 4,
  // _USD
  BTC_USD: 2,  ETH_USD: 2,  BNB_USD: 2,  SOL_USD: 2,
  ADA_USD: 4,  XRP_USD: 4,  DOT_USD: 4,  LINK_USD: 4,
  AVAX_USD: 4, MATIC_USD: 4, UNI_USD: 4, ATOM_USD: 4,
  LTC_USD: 2,  NEAR_USD: 4, APT_USD: 4,  TRX_USD: 4,
  FTM_USD: 4,  ALGO_USD: 4, DOGE_USD: 4, FIL_USD: 4,
};

function formatPrice(instrument: string, price: number): string {
  const decimals = PRICE_DECIMALS[instrument] ?? 4;
  return price.toFixed(decimals);
}

async function getSupportedInstrumentNames(): Promise<Set<string>> {
  if (instrumentCache && Date.now() - instrumentCache.at < INSTRUMENT_CACHE_MS) {
    return instrumentCache.names;
  }

  const res = await cdcClient.get<CdcInstrumentsResponse>("/public/get-instruments");
  if (res.data.code !== 0) {
    throw new Error(`CDC instruments error ${res.data.code}: ${res.data.message ?? "Unknown error"}`);
  }

  const instruments = res.data.result?.instruments ?? res.data.result?.data ?? [];
  const names = new Set(instruments.map((item) => item.instrument_name).filter(Boolean));
  instrumentCache = { names, at: Date.now() };
  logger.info({ count: names.size }, "CDC supported instruments loaded");
  return names;
}

export async function isCdcInstrumentSupported(instrument: string): Promise<boolean> {
  try {
    return (await getSupportedInstrumentNames()).has(instrument);
  } catch (err) {
    logger.warn({ instrument, err: (err as Error).message }, "CDC instrument validation failed");
    return false;
  }
}

/** Convert Binance-style symbol (BTCUSDT) to CDC instrument name.
 *  quoteOverride lets callers switch between _USDT and _USD based on account holdings. */
export function toCdcInstrument(
  symbol: string,
  quoteOverride?: "USDT" | "USD",
): string {
  if (symbol.endsWith("USDT")) {
    const base = symbol.slice(0, -4);
    const quote = quoteOverride ?? "USDT";
    return `${base}_${quote}`;
  }
  if (symbol.endsWith("BTC")) {
    return `${symbol.slice(0, -3)}_BTC`;
  }
  return symbol;
}

// ─── Atomic nonce generator ────────────────────────────────────────────────
// CDC requires nonces to be strictly increasing and unique.
// Date.now() alone is not safe if two requests happen in the same millisecond.
// We keep a module-level counter and always return max(lastNonce+1, Date.now()).
let _lastNonce = 0;
function nextNonce(): number {
  const now = Date.now();
  _lastNonce = Math.max(_lastNonce + 1, now);
  return _lastNonce;
}

// ─── HMAC-SHA256 signing ───────────────────────────────────────────────────
// Per official Crypto.com Exchange API v1 JavaScript example (exchange-docs.crypto.com):
// SigPayload = method + id + api_key + paramsString + nonce
// paramsString = objectToString(params) — recursive sorted key+value concat, NOT JSON
// null / empty params → ""

function cdcIsObject(obj: unknown): obj is Record<string, unknown> {
  return (
    obj !== undefined && obj !== null && (obj as object).constructor === Object
  );
}
function cdcIsArray(obj: unknown): obj is unknown[] {
  return (
    obj !== undefined && obj !== null && (obj as object).constructor === Array
  );
}
function cdcArrayToString(arr: unknown[]): string {
  return arr.reduce<string>(
    (a, b) =>
      a +
      (cdcIsObject(b)
        ? cdcObjectToString(b)
        : cdcIsArray(b)
          ? cdcArrayToString(b)
          : String(b)),
    "",
  );
}
function cdcObjectToString(
  obj: Record<string, unknown> | null | undefined,
): string {
  if (obj == null) return "";
  return Object.keys(obj)
    .sort()
    .reduce<string>(
      (a, b) =>
        a +
        b +
        (cdcIsArray(obj[b])
          ? cdcArrayToString(obj[b] as unknown[])
          : cdcIsObject(obj[b])
            ? cdcObjectToString(obj[b] as Record<string, unknown>)
            : String(obj[b])),
      "",
    );
}

function buildParamStr(params: Record<string, unknown>): string {
  return cdcObjectToString(params);
}

function signRequest(
  method: string,
  id: number,
  apiKey: string,
  params: Record<string, unknown>,
  nonce: number,
  secretKey: string,
): string {
  const paramStr = buildParamStr(params);
  const payload = `${method}${id}${apiKey}${paramStr}${nonce}`;
  return crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
}

async function privatePostOnce<T>(
  method: string,
  params: Record<string, unknown>,
  creds: CdcCreds,
): Promise<T> {
  // Use atomic nonce — guarantees uniqueness even if called in same millisecond
  const nonce = nextNonce();
  const id    = nonce;
  const sig   = signRequest(method, id, creds.apiKey, params, nonce, creds.secretKey);

  const body = { id, method, api_key: creds.apiKey, params, nonce, sig };

  let res;
  try {
    res = await cdcClient.post<{
      id: number;
      code: number;
      result?: T;
      message?: string;
    }>(`/private/${method.replace("private/", "")}`, body);
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status: number; data: unknown } };
    if (axiosErr.response) {
      logger.error(
        { status: axiosErr.response.status, body: axiosErr.response.data },
        "CDC API HTTP error",
      );
      throw new Error(
        `CDC API HTTP ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`,
      );
    }
    throw err;
  }

  if (res.data.code !== 0) {
    logger.error(
      { code: res.data.code, message: res.data.message },
      "CDC API application error",
    );
    throw new Error(
      `CDC API error ${res.data.code}: ${res.data.message ?? "Unknown error"}`,
    );
  }

  return res.data.result as T;
}

/** privatePost with one automatic retry (600ms delay) on transient errors.
 *  401 most likely means a nonce collision or clock skew — retrying with a
 *  fresh nonce resolves it without user intervention. */
async function privatePost<T>(
  method: string,
  params: Record<string, unknown>,
  creds: CdcCreds,
): Promise<T> {
  try {
    return await privatePostOnce<T>(method, params, creds);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    const isTransient = msg.includes("40101") || msg.includes("401") || msg.includes("40004");
    if (!isTransient) throw err;
    // Wait 600ms then retry with a fresh nonce
    logger.warn({ method, msg }, "CDC transient error — retrying in 600ms with fresh nonce");
    await new Promise((r) => setTimeout(r, 600));
    return await privatePostOnce<T>(method, params, creds);
  }
}

// ─── Credentials & config ─────────────────────────────────────────────────
// Cache creds and config in memory to avoid hammering DB every 2 min (position monitor).
// TTL: 5 min for creds, 1 min for config. Invalidated on save.

let _credsCache: { value: CdcCreds | null; at: number } | null = null;
let _configCache: { value: TradeConfig; at: number } | null = null;
let _liveTradingWarningLogged = false;

function liveTradingAllowed(): boolean {
  return process.env.LIVE_TRADING_ENABLED === "true";
}

export async function getCdcCreds(): Promise<CdcCreds | null> {
  if (_credsCache && Date.now() - _credsCache.at < 5 * 60 * 1000) {
    return _credsCache.value;
  }
  const dbApiKey = decryptSettingValue(await getSettingValue("CDC_API_KEY"));
  const dbSecretKey = decryptSettingValue(await getSettingValue("CDC_SECRET_KEY"));

  const apiKey = (dbApiKey ?? process.env.CDC_API_KEY ?? "").trim();
  const secretKey = (dbSecretKey ?? process.env.CDC_SECRET_KEY ?? "").trim();

  const value = (!apiKey || !secretKey) ? null : { apiKey, secretKey };
  _credsCache = { value, at: Date.now() };
  return value;
}

export function invalidateCredsCache(): void {
  _credsCache = null;
  _configCache = null;
}

export async function saveCdcCreds(
  apiKey: string,
  secretKey: string,
): Promise<void> {
  await setSettingValue("CDC_API_KEY", encryptSettingValue(apiKey));
  await setSettingValue("CDC_SECRET_KEY", encryptSettingValue(secretKey));
}

export async function getTradeConfig(): Promise<TradeConfig> {
  if (_configCache && Date.now() - _configCache.at < 60 * 1000) {
    return _configCache.value;
  }
  const [autoTrade, minConf, tpPct, slPct] = await Promise.all([
    getSettingValue("AUTO_TRADE_ENABLED"),
    getSettingValue("MIN_CONFIDENCE"),
    getSettingValue("TAKE_PROFIT_PCT"),
    getSettingValue("STOP_LOSS_PCT"),
  ]);
  const requestedAutoTrade = autoTrade === "true";
  const value = {
    autoTradeEnabled: requestedAutoTrade && liveTradingAllowed(),
    minConfidence: minConf ? parseFloat(minConf) : DEFAULT_CONFIG.minConfidence,
    takeProfitPct: tpPct ? parseFloat(tpPct) : DEFAULT_CONFIG.takeProfitPct,
    stopLossPct: slPct ? parseFloat(slPct) : DEFAULT_CONFIG.stopLossPct,
  };
  if (requestedAutoTrade && !value.autoTradeEnabled && !_liveTradingWarningLogged) {
    _liveTradingWarningLogged = true;
    logger.warn("Auto-trade is enabled in settings but blocked until LIVE_TRADING_ENABLED=true is set");
  }
  _configCache = { value, at: Date.now() };
  return value;
}

export async function saveTradeConfig(config: TradeConfig): Promise<void> {
  await Promise.all([
    setSettingValue("AUTO_TRADE_ENABLED", String(config.autoTradeEnabled)),
    setSettingValue("MIN_CONFIDENCE", String(config.minConfidence)),
    setSettingValue("TAKE_PROFIT_PCT", String(config.takeProfitPct)),
    setSettingValue("STOP_LOSS_PCT", String(config.stopLossPct)),
  ]);
  _configCache = null; // force reload after save
}

// ─── Connection test ──────────────────────────────────────────────────────

// Exchange v1 position balance entry (inside position_balances[])
interface CdcPositionBalance {
  instrument_name: string;
  quantity: string;
  reserved_qty: string;
  market_value: string;
  max_withdrawal_balance: string;
}

// Exchange v1 top-level balance entry
interface CdcBalanceEntry {
  instrument_name: string;         // "USD" — denominator currency
  total_available_balance: string; // USD-equivalent available
  total_cash_balance: string;      // total cash in USD equivalent
  position_balances: CdcPositionBalance[];
}

interface AccountSummaryResult {
  data: CdcBalanceEntry[];
}

export interface AccountInfo {
  accountType: string;
  balances: Array<{ asset: string; free: string; locked: string }>;
}

export type StablecoinType = "USDT" | "USD" | "USDC";

export interface StablecoinBalance {
  amount: number;
  currency: StablecoinType;
}

/** Returns the available quote balance for spot trading.
 *  Only USD/USDT are used because the order router maps symbols to _USD/_USDT books.
 *  USDC is intentionally ignored to avoid placing USDT orders against a USDC balance. */
export async function getStablecoinBalance(
  creds: CdcCreds,
): Promise<StablecoinBalance | null> {
  const result = await privatePost<AccountSummaryResult>(
    "private/user-balance",
    {},
    creds,
  );
  const entry = (result.data ?? [])[0];
  if (!entry) return null;

  const CANDIDATES: StablecoinType[] = ["USD", "USDT"];
  let best: StablecoinBalance | null = null;

  for (const currency of CANDIDATES) {
    const pos = (entry.position_balances ?? []).find(
      (p) => p.instrument_name === currency,
    );
    if (!pos) continue;
    const amount = parseFloat(pos.quantity) || 0;
    if (amount > 0 && (!best || amount > best.amount)) {
      best = { amount, currency };
    }
  }

  if (best) {
    logger.info({ currency: best.currency, amount: best.amount }, "CDC stablecoin balance found");
    return best;
  }

  // No stablecoin found
  logger.warn(
    {
      positions: (entry.position_balances ?? []).map((p) => ({
        instrument_name: p.instrument_name,
        quantity: p.quantity,
      })),
      hint: "No USD/USDT found. Convert your holdings to USD or USDT on Crypto.com Exchange.",
    },
    "No stablecoin found — auto-trade skipped",
  );
  return null;
}

/** @deprecated Use getStablecoinBalance instead */
export async function getAvailableUsdt(creds: CdcCreds): Promise<number> {
  const bal = await getStablecoinBalance(creds);
  return bal?.amount ?? 0;
}

/** Returns the available quantity of a base crypto asset (e.g. "BTC" for BTCUSDT).
 *  Used to determine how much to sell when closing a position. */
export async function getCryptoHolding(
  creds: CdcCreds,
  symbol: string,
): Promise<number> {
  // Derive base asset: BTCUSDT → BTC, ETHUSDT → ETH
  let base = symbol;
  if (symbol.endsWith("USDT")) base = symbol.slice(0, -4);
  else if (symbol.endsWith("USD")) base = symbol.slice(0, -3);

  const result = await privatePost<AccountSummaryResult>(
    "private/user-balance",
    {},
    creds,
  );
  const entry = (result.data ?? [])[0];
  const pos = (entry?.position_balances ?? []).find(
    (p) => p.instrument_name === base,
  );
  const qty = pos ? parseFloat(pos.quantity) || 0 : 0;
  logger.info({ symbol, base, qty }, "CDC crypto holding lookup");
  return qty;
}

export async function testCdcConnection(creds: CdcCreds): Promise<AccountInfo> {
  const result = await privatePost<AccountSummaryResult>(
    "private/user-balance",
    {},
    creds,
  );

  const entry = (result.data ?? [])[0];
  const positions = entry?.position_balances ?? [];

  const balances = positions
    .filter((p) => parseFloat(p.quantity) > 0)
    .map((p) => ({
      asset: p.instrument_name,
      free: parseFloat(p.quantity).toFixed(8),
      locked: parseFloat(p.reserved_qty || "0").toFixed(8),
    }));

  // Include a synthetic USD total row so the UI always shows something useful
  if (entry?.total_cash_balance) {
    balances.unshift({
      asset: "USD (total)",
      free: parseFloat(entry.total_cash_balance).toFixed(2),
      locked: "0.00000000",
    });
  }

  return {
    accountType: "SPOT",
    balances,
  };
}

// ─── Order execution ──────────────────────────────────────────────────────

interface CreateOrderResult {
  order_id: string;
  client_oid?: string;
}

async function placeMarketOrder(
  creds: CdcCreds,
  instrument: string,
  side: "BUY" | "SELL",
  quantity: number,
): Promise<string> {
  const result = await privatePost<CreateOrderResult>(
    "private/create-order",
    {
      instrument_name: instrument,
      side,
      type: "MARKET",
      quantity: formatQty(instrument, quantity),
      client_oid: crypto.randomUUID(),
    },
    creds,
  );
  return result.order_id;
}


export interface TradeResult {
  orderId: string;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  quantity: number;
}

/**
 * Close an open position by selling the full crypto holding.
 * Used by position monitor for server-side TP/SL exits.
 */
export async function closePosition(
  creds: CdcCreds,
  symbol: string,
  quoteOverride?: StablecoinType,
): Promise<{ orderId: string; quantity: number }> {
  const instrument = toCdcInstrument(
    symbol,
    quoteOverride === "USDC" ? "USDT" : quoteOverride,
  );
  if (!(await isCdcInstrumentSupported(instrument))) {
    throw new Error(`Unsupported Crypto.com Exchange instrument: ${instrument}`);
  }
  const qty = await getCryptoHolding(creds, symbol);
  if (qty <= 0) throw new Error(`No ${symbol.replace(/USDT?$/, "")} position to close`);
  const orderId = await placeMarketOrder(creds, instrument, "SELL", qty);
  logger.info({ symbol, instrument, qty, orderId }, "Position closed via market SELL");
  return { orderId, quantity: qty };
}

export async function executeCdcTrade(
  creds: CdcCreds,
  symbol: string,
  side: "BUY" | "SELL",
  price: number,
  takeProfitPct: number,
  stopLossPct: number,
  quoteOverride?: StablecoinType,
  notionalUsd = 10,
): Promise<TradeResult> {
  const instrument = toCdcInstrument(
    symbol,
    quoteOverride === "USDC" ? "USDT" : quoteOverride,
  );
  if (!(await isCdcInstrumentSupported(instrument))) {
    throw new Error(`Unsupported Crypto.com Exchange instrument: ${instrument}`);
  }

  let rawQty: number;
  if (side === "SELL") {
    // Sell the actual held quantity of this crypto
    rawQty = await getCryptoHolding(creds, symbol);
    if (rawQty <= 0) {
      throw new Error(`No ${symbol.replace(/USDT?$/, "")} position to sell`);
    }
  } else {
    rawQty = notionalUsd / price;
  }

  // Format to Exchange precision, then parse back for TP/SL math
  const qtyStr = formatQty(instrument, rawQty);
  const qty = parseFloat(qtyStr);

  logger.info(
    { instrument, side, qty, price },
    "Placing market order on Crypto.com Exchange",
  );
  const orderId = await placeMarketOrder(creds, instrument, side, qty);

  // Compute TP and SL prices (stored in DB — enforced by server-side position monitor every 5 min)
  let tpPrice: number;
  let slPrice: number;

  if (side === "BUY") {
    tpPrice = price * (1 + takeProfitPct / 100);
    slPrice = price * (1 - stopLossPct / 100);
  } else {
    tpPrice = price * (1 - takeProfitPct / 100);
    slPrice = price * (1 + stopLossPct / 100);
  }

  logger.info(
    { instrument, side, tpPrice: tpPrice.toFixed(6), slPrice: slPrice.toFixed(6) },
    "TP/SL levels set (enforced by server-side monitor every 5 min)",
  );

  return { orderId, entryPrice: price, tpPrice, slPrice, quantity: qty };
}
