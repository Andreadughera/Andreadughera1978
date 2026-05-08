import { pgTable, serial, text, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const listingStatusEnum = ["DETECTED", "BOUGHT", "CLOSED", "SKIPPED"] as const;

export const newListingsTable = pgTable("new_listings", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  instrument: text("instrument").notNull(),
  volume24h: real("volume_24h"),
  tradeExecuted: boolean("trade_executed").default(false),
  orderId: text("order_id"),
  entryPrice: real("entry_price"),
  tpPrice: real("tp_price"),
  slPrice: real("sl_price"),
  status: text("status", { enum: listingStatusEnum }).notNull().default("DETECTED"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertListingSchema = createInsertSchema(newListingsTable).omit({ id: true, createdAt: true, firstSeenAt: true });
export type InsertListing = z.infer<typeof insertListingSchema>;
export type NewListing = typeof newListingsTable.$inferSelect;
