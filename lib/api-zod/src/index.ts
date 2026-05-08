import { z } from "zod";

export const HealthCheckResponse = z.object({
  status: z.literal("ok"),
});

export const ListSignalsQueryParams = z.object({
  symbol: z.string().optional(),
  type: z.enum(["BUY", "SELL", "HOLD"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const GetSignalsHistoryQueryParams = z.object({
  symbol: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const GetPriceHistoryParams = z.object({
  symbol: z.string(),
});

export const GetPriceHistoryQueryParams = z.object({
  interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("1h"),
  limit: z.coerce.number().int().positive().max(500).default(100),
});
