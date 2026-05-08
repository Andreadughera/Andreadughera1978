import { useListTrades, useGetTradesStats, getListTradesQueryKey, getGetTradesStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Activity, TrendingUp, TrendingDown, CheckCircle2, XCircle, Clock, ArrowRight, RefreshCw, DollarSign } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface OpenPositionPnl {
  id: number;
  symbol: string;
  unrealizedPnl: number;
  unrealizedPct: number;
  currentPrice: number;
  tpDistancePct: number;
  slDistancePct: number;
}

const REFRESH = 15_000;
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    FILLED:    "bg-success/10 text-success border-success/20",
    CLOSED:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
    FAILED:    "bg-danger/10 text-danger border-danger/20",
    PENDING:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    CANCELLED: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={`font-mono text-xs ${styles[status] ?? styles.CANCELLED}`}>
      {status}
    </Badge>
  );
}

function LiveClock({ lastFetch }: { lastFetch: Date | null }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!lastFetch) return null;

  const secondsAgo = Math.floor((now.getTime() - lastFetch.getTime()) / 1000);
  const label = secondsAgo < 5
    ? "just now"
    : secondsAgo < 60
      ? `${secondsAgo}s ago`
      : formatDistanceToNow(lastFetch, { addSuffix: true });

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
      <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: `${REFRESH}ms` }} />
      <span>Checked {label}</span>
      <span className="text-muted-foreground/40">· {format(lastFetch, "HH:mm:ss")}</span>
    </div>
  );
}

function pnlColor(v: number) {
  return v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted-foreground";
}

export default function Trades() {
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const { data: stats, isLoading: loadingStats } = useGetTradesStats({
    query: {
      refetchInterval: REFRESH,
      queryKey: getGetTradesStatsQueryKey(),
    }
  });

  const { data: trades = [], isLoading, dataUpdatedAt } = useListTrades({ limit: 100 }, {
    query: {
      refetchInterval: REFRESH,
      queryKey: getListTradesQueryKey({ limit: 100 }),
    }
  });

  const { data: openPositions = [], isLoading: loadingPositions } = useQuery<OpenPositionPnl[]>({
    queryKey: ["open-positions-pnl"],
    queryFn: () => fetch(`${BASE}/api/portfolio/positions`).then((r) => r.json()) as Promise<OpenPositionPnl[]>,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (dataUpdatedAt) setLastFetch(new Date(dataUpdatedAt));
  }, [dataUpdatedAt]);

  const totalUnrealizedPnl = openPositions.reduce((s, p) => s + p.unrealizedPnl, 0);

  const statCards = [
    { label: "Executed", value: stats?.executed, icon: Activity,     color: "text-primary"    },
    { label: "Open",     value: stats?.filled,   icon: TrendingUp,   color: "text-success"    },
    { label: "Closed",   value: stats?.closed,   icon: CheckCircle2, color: "text-blue-400"   },
    { label: "Failed",   value: stats?.failed,   icon: XCircle,      color: "text-danger"     },
    { label: "Pending",  value: stats?.pending,  icon: Clock,        color: "text-yellow-400" },
    { label: "Total DB", value: stats?.total,    icon: TrendingDown, color: "text-muted-foreground" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trade Executions</h1>
          <p className="text-muted-foreground text-sm mt-1">Auto-executed from signals with confidence above threshold</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <LiveClock lastFetch={lastFetch} />
          <Link href="/settings" className="text-xs font-mono text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
            Configure auto-trade <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Live Open Positions PnL Strip */}
      {(openPositions.length > 0 || loadingPositions) && (
        <Card className={`bg-card/50 ${totalUnrealizedPnl > 0 ? "border-success/30" : totalUnrealizedPnl < 0 ? "border-danger/30" : "border-border/50"}`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Open Positions — Live Unrealized P&L
            </CardTitle>
            {!loadingPositions && (
              <div className={`text-lg font-bold font-mono ${pnlColor(totalUnrealizedPnl)}`}>
                {totalUnrealizedPnl >= 0 ? "+" : ""}${totalUnrealizedPnl.toFixed(2)} total
              </div>
            )}
          </CardHeader>
          <CardContent className="pb-3">
            {loadingPositions ? (
              <div className="flex gap-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-28 rounded-lg" />)}</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {openPositions.map((p) => (
                  <div
                    key={p.id}
                    className={`rounded-lg px-3 py-2 border text-sm min-w-[120px] ${
                      p.unrealizedPnl > 0
                        ? "bg-success/5 border-success/20"
                        : p.unrealizedPnl < 0
                        ? "bg-danger/5 border-danger/20"
                        : "bg-muted/20 border-border/40"
                    }`}
                  >
                    <div className="font-bold">{p.symbol.replace("USDT", "")}</div>
                    <div className={`font-mono font-bold text-sm ${pnlColor(p.unrealizedPnl)}`}>
                      {p.unrealizedPnl >= 0 ? "+" : ""}${p.unrealizedPnl.toFixed(3)}
                    </div>
                    <div className={`font-mono text-xs ${pnlColor(p.unrealizedPct)}`}>
                      {p.unrealizedPct >= 0 ? "+" : ""}{p.unrealizedPct.toFixed(2)}%
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      TP: <span className="text-success">+{p.tpDistancePct.toFixed(1)}%</span> · SL: <span className={p.slDistancePct < 1.5 ? "text-danger font-bold" : "text-muted-foreground"}>{p.slDistancePct.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-card/50 border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
              <Icon className={`h-3.5 w-3.5 ${color}`} />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {loadingStats
                ? <Skeleton className="h-7 w-10" />
                : <div className={`text-xl font-bold font-mono ${color}`}>{value ?? 0}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trade table */}
      <Card className="bg-card/50 border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-mono text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Side</th>
                <th className="px-4 py-3 font-medium text-right">Entry</th>
                <th className="px-4 py-3 font-medium text-right">TP</th>
                <th className="px-4 py-3 font-medium text-right">SL</th>
                <th className="px-4 py-3 font-medium text-right">Qty</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
                <th className="px-4 py-3 font-medium text-center">Confidence</th>
                <th className="px-4 py-3 font-medium">Order ID</th>
                <th className="px-4 py-3 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={10} className="p-3"><Skeleton className="h-5 w-full" /></td>
                  </tr>
                ))
              ) : trades.length > 0 ? (
                trades.map((t) => (
                  <tr key={t.id} className="hover:bg-accent/10 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-bold">{t.symbol.replace("USDT", "")}</div>
                      <div className="text-xs text-muted-foreground font-mono">/USDT</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant="outline" className={`font-mono text-xs ${t.side === "BUY" ? "bg-success/10 text-success border-success/20" : "bg-danger/10 text-danger border-danger/20"}`}>
                        {t.side}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-mono text-xs">
                      ${Number(t.entryPrice ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-mono text-xs text-success">
                      {t.tpPrice != null ? `$${Number(t.tpPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-mono text-xs text-danger">
                      {t.slPrice != null ? `$${Number(t.slPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-mono text-xs">
                      {Number(t.quantity ?? 0).toFixed(4)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${t.confidence > 80 ? "bg-success" : t.confidence > 60 ? "bg-primary" : "bg-muted-foreground"}`}
                            style={{ width: `${t.confidence}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs">{Number(t.confidence ?? 0).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[180px]">
                      {t.status === "FAILED" && t.errorMessage ? (
                        <span className="text-danger/80 font-sans normal-case leading-tight block truncate" title={t.errorMessage}>
                          {t.errorMessage}
                        </span>
                      ) : t.binanceOrderId ? (
                        t.binanceOrderId.length > 14
                          ? t.binanceOrderId.slice(0, 14) + "…"
                          : t.binanceOrderId
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-mono text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Activity className="h-10 w-10 text-muted-foreground/20" />
                      <p className="text-muted-foreground">No trades executed yet.</p>
                      <p className="text-xs text-muted-foreground/60">
                        Configure API keys in{" "}
                        <Link href="/settings" className="text-primary hover:underline">Settings</Link>
                        {" "}and enable auto-trade.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
