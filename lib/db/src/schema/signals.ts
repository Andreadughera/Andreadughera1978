import { pgTable, serial, text, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalTypeEnum = ["BUY", "SELL", "HOLD"] as const;

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  type: text("type", { enum: signalTypeEnum }).notNull(),
  price: real("price").notNull(),
  rsi: real("rsi").notNull(),
  maShort: real("ma_short").notNull(),
  maLong: real("ma_long").notNull(),
  confidence: real("confidence").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
