import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("Unexpected DB pool error", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
