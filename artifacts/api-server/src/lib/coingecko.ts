import axios from "axios";
import { logger } from "./logger";

const client = axios.create({
  baseURL: "https://api.coingecko.com/api/v3",
  timeout: 8000,
  headers: { Accept: "application/json" },
});

export interface TrendingCoin {
  name: string;
  symbol: string;
  marketCapRank: number | null;
  priceChangePercent24h: number | null;
  thumb: string;
}

export interface GlobalMarketData {
  totalMarketCapUsd: number;
  marketCapChangePercent24h: number;
  btcDominance: number;
  ethDominance: number;
  activeCryptocurrencies: number;
  updatedAt: string;
}

// ─── Trending cache (10 min) ─────────────────────────────────────────────────
let trendingCache: { data: TrendingCoin[]; expiresAt: number } | null = null;

export async function getTrendingCoins(): Promise<TrendingCoin[]> {
  const now = Date.now();
  if (trendingCache && now < trendingCache.expiresAt) return trendingCache.data;
  try {
    const res = await client.get<{
      coins: Array<{
        item: {
          name: string;
          symbol: string;
          market_cap_rank: number | null;
          data: { price_change_percentage_24h?: { usd?: number } };
          thumb: string;
        };
      }>;
    }>("/search/trending");
    const data: TrendingCoin[] = res.data.coins.map((c) => ({
      name: c.item.name,
      symbol: c.item.symbol.toUpperCase(),
      marketCapRank: c.item.market_cap_rank,
      priceChangePercent24h: c.item.data?.price_change_percentage_24h?.usd ?? null,
      thumb: c.item.thumb,
    }));
    trendingCache = { data, expiresAt: now + 10 * 60 * 1000 };
    logger.info({ count: data.length }, "CoinGecko trending coins updated");
    return data;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "CoinGecko trending failed");
    return trendingCache?.data ?? [];
  }
}

// ─── Global market cache (5 min) ─────────────────────────────────────────────
let globalCache: { data: GlobalMarketData; expiresAt: number } | null = null;

export async function getGlobalMarketData(): Promise<GlobalMarketData | null> {
  const now = Date.now();
  if (globalCache && now < globalCache.expiresAt) return globalCache.data;
  try {
    const res = await client.get<{
      data: {
        total_market_cap: { usd: number };
        market_cap_change_percentage_24h_usd: number;
        market_cap_percentage: { btc: number; eth: number };
        active_cryptocurrencies: number;
        updated_at: number;
      };
    }>("/global");
    const d = res.data.data;
    const data: GlobalMarketData = {
      totalMarketCapUsd: d.total_market_cap.usd,
      marketCapChangePercent24h: d.market_cap_change_percentage_24h_usd,
      btcDominance: d.market_cap_percentage.btc,
      ethDominance: d.market_cap_percentage.eth,
      activeCryptocurrencies: d.active_cryptocurrencies,
      updatedAt: new Date(d.updated_at * 1000).toISOString(),
    };
    globalCache = { data, expiresAt: now + 5 * 60 * 1000 };
    return data;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "CoinGecko global data failed");
    return globalCache?.data ?? null;
  }
}
