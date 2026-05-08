import { pgTable, serial, text, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailyReportsTable = pgTable("daily_reports", {
  id: serial("id").primaryKey(),
  date: text("date").notNull().unique(),
  capitalStart: real("capital_start"),
  capitalEnd: real("capital_end"),
  tradesCount: integer("trades_count").notNull().default(0),
  winCount: integer("win_count").notNull().default(0),
  lossCount: integer("loss_count").notNull().default(0),
  pnlUsd: real("pnl_usd").notNull().default(0),
  bestSymbol: text("best_symbol"),
  bestPnl: real("best_pnl"),
  worstSymbol: text("worst_symbol"),
  worstPnl: real("worst_pnl"),
  openPositionsCount: integer("open_positions_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertReportSchema = createInsertSchema(dailyReportsTable).omit({ id: true, createdAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type DailyReport = typeof dailyReportsTable.$inferSelect;
