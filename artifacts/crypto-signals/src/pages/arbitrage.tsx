import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeftRight, RefreshCw, TrendingUp, Minus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface ArbitrageEntry {
  symbol: string;
  displaySymbol: string;
  binancePrice: number | null;
  cdcPrice: number | null;
  spreadPct: number | null;
  opportunity: "BUY_CDC" | "BUY_BINANCE" | "NEUTRAL" | "UNAVAILABLE";
  binanceAvailable: boolean;
  cdcAvailable: boolean;
  updatedAt: string;
}

function OpportunityBadge({ opp }: { opp: string }) {
  if (opp === "BUY_CDC") return (
    <Badge variant="outline" className="bg-success/10 text-success border-success/30 font-mono text-xs">
      BUY CDC
    </Badge>
  );
  if (opp === "BUY_BINANCE") return (
    <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 font-mono text-xs">
      BUY BNB
    </Badge>
  );
  if (opp === "NEUTRAL") return (
    <Badge variant="outline" className="bg-muted text-muted-foreground border-border font-mono text-xs">
      NEUTRAL
    </Badge>
  );
  return (
    <Badge variant="outline" className="bg-muted/50 text-muted-foreground/50 border-border/50 font-mono text-xs">
      N/A
    </Badge>
  );
}

function SpreadBar({ spreadPct }: { spreadPct: number | null }) {
  if (spreadPct === null) return <span className="text-muted-foreground font-mono text-sm">—</span>;

  const abs = Math.abs(spreadPct);
  const isPositive = spreadPct > 0;

  return (
    <div className="flex items-center gap-2">
      <div className={`font-bold font-mono text-sm ${abs >= 0.3 ? (isPositive ? "text-success" : "text-blue-400") : abs >= 0.15 ? "text-yellow-400" : "text-muted-foreground"}`}>
        {spreadPct >= 0 ? "+" : ""}{spreadPct.toFixed(3)}%
      </div>
      {abs >= 0.15 && (
        <div className="relative h-1.5 w-12 bg-muted/30 rounded-full overflow-hidden">
          <div
            className={`absolute top-0 h-full rounded-full ${abs >= 0.3 ? "bg-success" : "bg-yellow-500"}`}
            style={{ width: `${Math.min(100, abs * 100)}%`, left: isPositive ? "50%" : "auto", right: isPositive ? "auto" : "50%" }}
          />
        </div>
      )}
    </div>
  );
}

export default function Arbitrage() {
  const { data: entries, isLoading, dataUpdatedAt, refetch, isRefetching } = useQuery<ArbitrageEntry[]>({
    queryKey: ["arbitrage"],
    queryFn: () => fetch(`${BASE}/api/arbitrage`).then((r) => r.json()) as Promise<ArbitrageEntry[]>,
    refetchInterval: 30_000,
  });

  const opportunities = entries?.filter((e) => e.opportunity !== "NEUTRAL" && e.opportunity !== "UNAVAILABLE") ?? [];
  const bigOpps = opportunities.filter((e) => Math.abs(e.spreadPct ?? 0) >= 0.3);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Arbitrage Monitor</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time price spread between Binance US and Crypto.com Exchange</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground font-mono">
            {dataUpdatedAt ? `Updated ${formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true })}` : "Loading…"}
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-mono"
          >
            <RefreshCw className={`h-3 w-3 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-primary" />
              <div>
                <div className="text-xs text-muted-foreground">Total Pairs</div>
                <div className="font-bold font-mono text-lg">{entries?.length ?? 0}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-success/20">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              <div>
                <div className="text-xs text-muted-foreground">Opportunities</div>
                <div className="font-bold font-mono text-lg text-success">{opportunities.length}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={`bg-card/50 ${bigOpps.length > 0 ? "border-yellow-500/30" : "border-border/50"}`}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className={`h-4 w-4 ${bigOpps.length > 0 ? "text-yellow-400" : "text-muted-foreground"}`} />
              <div>
                <div className="text-xs text-muted-foreground">{'>'} 0.3% spread</div>
                <div className={`font-bold font-mono text-lg ${bigOpps.length > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>{bigOpps.length}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Minus className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Neutral</div>
                <div className="font-bold font-mono text-lg text-muted-foreground">
                  {entries?.filter(e => e.opportunity === "NEUTRAL").length ?? 0}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Explanation */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-4 pb-3">
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">How to read this table</p>
            <p>A <span className="text-success font-mono">BUY CDC</span> signal means CDC price is lower than Binance — buy on CDC, sell on Binance. A <span className="text-blue-400 font-mono">BUY BNB</span> signal means the opposite. Note: transaction fees (~0.1% each side) mean spreads below 0.2% are typically not profitable after costs.</p>
          </div>
        </CardContent>
      </Card>

      {/* Main table */}
      <Card className="bg-card/50 border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground font-mono text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Asset</th>
                <th className="px-4 py-3 text-right font-medium">Binance Price</th>
                <th className="px-4 py-3 text-right font-medium">CDC Price</th>
                <th className="px-4 py-3 text-center font-medium">Spread</th>
                <th className="px-4 py-3 text-center font-medium">Opportunity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="p-3"><Skeleton className="h-5 w-full" /></td>
                  </tr>
                ))
              ) : entries && entries.length > 0 ? (
                entries.map((entry) => {
                  const isHighSpread = Math.abs(entry.spreadPct ?? 0) >= 0.3;
                  return (
                    <tr
                      key={entry.symbol}
                      className={`hover:bg-accent/10 transition-colors ${isHighSpread ? "bg-yellow-500/5" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-bold">{entry.displaySymbol}</div>
                        <div className="text-xs text-muted-foreground font-mono">/USDT</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {entry.binancePrice !== null
                          ? `$${entry.binancePrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
                          : <span className="text-muted-foreground">N/A</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {entry.cdcPrice !== null
                          ? `$${entry.cdcPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
                          : <span className="text-muted-foreground">N/A</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-center">
                        <SpreadBar spreadPct={entry.spreadPct} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <OpportunityBadge opp={entry.opportunity} />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-muted-foreground">
                    No arbitrage data available
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
