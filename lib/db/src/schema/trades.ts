import { pgTable, serial, text, timestamp, real, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradeStatusEnum = ["PENDING", "FILLED", "CLOSED", "FAILED", "CANCELLED"] as const;

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  signalId: integer("signal_id"),
  side: text("side", { enum: ["BUY", "SELL"] }).notNull(),
  quantity: real("quantity").notNull(),
  entryPrice: real("entry_price").notNull(),
  tpPrice: real("tp_price").notNull(),
  slPrice: real("sl_price").notNull(),
  exitPrice: real("exit_price"),
  pnlUsd: real("pnl_usd"),
  closedAt: timestamp("closed_at"),
  isListing: boolean("is_listing").default(false),
  status: text("status", { enum: tradeStatusEnum }).notNull().default("PENDING"),
  binanceOrderId: text("binance_order_id"),
  confidence: real("confidence").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, createdAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
