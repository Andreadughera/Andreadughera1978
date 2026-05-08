import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

const BASE =
  ((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "")
    .replace(/\/$/, "");

export type ListSignalsType = "BUY" | "SELL" | "HOLD";

type QueryOptions<T> = {
  query?: Omit<UseQueryOptions<T, Error>, "queryKey" | "queryFn"> & {
    queryKey?: readonly unknown[];
  };
};

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

async function request<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await fetch(buildUrl(path, params), { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  params?: Record<string, unknown>,
  options?: QueryOptions<T>,
) {
  return useQuery<T, Error>({
    ...(options?.query ?? {}),
    queryKey: options?.query?.queryKey ?? key,
    queryFn: () => request<T>(path, params),
  });
}

export const getHealthCheckQueryKey = () => ["healthz"] as const;
export function useHealthCheck(options?: QueryOptions<{ status: "ok" }>) {
  return useApiQuery<{ status: "ok" }>(getHealthCheckQueryKey(), "/api/healthz", undefined, options);
}

export const getGetSignalsSummaryQueryKey = () => ["signals", "summary"] as const;
export function useGetSignalsSummary(options?: QueryOptions<any>) {
  return useApiQuery<any>(getGetSignalsSummaryQueryKey(), "/api/signals/summary", undefined, options);
}

export const getListSignalsQueryKey = (params?: Record<string, unknown>) => ["signals", params ?? {}] as const;
export function useListSignals(params?: Record<string, unknown>, options?: QueryOptions<any[]>) {
  return useApiQuery<any[]>(getListSignalsQueryKey(params), "/api/signals", params, options);
}

export const getGetSignalsHistoryQueryKey = (params?: Record<string, unknown>) => ["signals", "history", params ?? {}] as const;
export function useGetSignalsHistory(params?: Record<string, unknown>, options?: QueryOptions<any[]>) {
  return useApiQuery<any[]>(getGetSignalsHistoryQueryKey(params), "/api/signals/history", params, options);
}

export const getListPricesQueryKey = () => ["prices"] as const;
export function useListPrices(options?: QueryOptions<any[]>) {
  return useApiQuery<any[]>(getListPricesQueryKey(), "/api/prices", undefined, options);
}

export const getGetPriceHistoryQueryKey = (symbol: string, params?: Record<string, unknown>) => ["prices", symbol, params ?? {}] as const;
export function useGetPriceHistory(symbol: string, params?: Record<string, unknown>, options?: QueryOptions<any[]>) {
  return useApiQuery<any[]>(getGetPriceHistoryQueryKey(symbol, params), `/api/prices/${symbol}`, params, options);
}

export const getGetMarketOverviewQueryKey = () => ["market", "overview"] as const;
export function useGetMarketOverview(options?: QueryOptions<any>) {
  return useApiQuery<any>(getGetMarketOverviewQueryKey(), "/api/market/overview", undefined, options);
}

export const getListTradesQueryKey = (params?: Record<string, unknown>) => ["trades", params ?? {}] as const;
export function useListTrades(params?: Record<string, unknown>, options?: QueryOptions<any[]>) {
  return useApiQuery<any[]>(getListTradesQueryKey(params), "/api/trades", params, options);
}

export const getGetTradesStatsQueryKey = () => ["trades", "stats"] as const;
export function useGetTradesStats(options?: QueryOptions<any>) {
  return useApiQuery<any>(getGetTradesStatsQueryKey(), "/api/trades/stats", undefined, options);
}

export const getGetExchangeSettingsQueryKey = () => ["settings", "exchange"] as const;
export function useGetExchangeSettings(options?: QueryOptions<any>) {
  return useApiQuery<any>(getGetExchangeSettingsQueryKey(), "/api/settings/exchange", undefined, options);
}
