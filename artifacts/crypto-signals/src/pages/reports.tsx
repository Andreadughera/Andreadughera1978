import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Rss, TrendingUp, TrendingDown, Activity, Shield } from "lucide-react";

interface TodayReport {
  date: string;
  tradesCount: number;
  winCount: number;
  lossCount: number;
  pnlUsd: number;
  openPositionsCount: number;
  openPositions: Array<{
    symbol: string;
    entryPrice: number;
    tpPrice: number;
    slPrice: number;
    isListing: boolean;
    createdAt: string;
  }>;
}

interface DailyReport {
  id: number;
  date: string;
  tradesCount: number;
  winCount: number;
  lossCount: number;
  pnlUsd: number;
  bestSymbol: string | null;
  bestPnl: number | null;
  worstSymbol: string | null;
  worstPnl: number | null;
  openPositionsCount: number;
  createdAt: string;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function PnlBadge({ value }: { value: number }) {
  const isPos = value >= 0;
  return (
    <span className={`font-mono font-bold text-sm ${isPos ? "text-green-400" : "text-red-400"}`}>
      {isPos ? "+" : ""}{value.toFixed(4)} USD
    </span>
  );
}

export default function Reports() {
  const { data: today } = useQuery<TodayReport>({
    queryKey: ["reports-today"],
    queryFn: () => fetch(`${BASE}/api/reports/today`).then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const { data: history = [] } = useQuery<DailyReport[]>({
    queryKey: ["reports-history"],
    queryFn: () => fetch(`${BASE}/api/reports`).then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const winRate = today && today.tradesCount > 0
    ? Math.round((today.winCount / today.tradesCount) * 100)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
          <Rss className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Daily Reports</h1>
          <p className="text-sm text-muted-foreground">
            Generated every day at 08:00 UTC — full P/L summary
          </p>
        </div>
      </div>

      {/* Today's summary */}
      {today && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Today — {today.date}
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-border/50">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Total P/L</p>
                <PnlBadge value={today.pnlUsd} />
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Closed Trades</p>
                <p className="font-bold text-lg">{today.tradesCount}</p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
                <p className="font-bold text-lg">
                  {winRate !== null ? `${winRate}%` : "—"}
                  <span className="text-xs text-muted-foreground ml-1">
                    ({today.winCount}W / {today.lossCount}L)
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Open Positions</p>
                <p className="font-bold text-lg">{today.openPositionsCount}</p>
              </CardContent>
            </Card>
          </div>

          {/* Open positions detail */}
          {today.openPositions.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Open Positions — monitored by server-side TP/SL
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {today.openPositions.map((pos, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-2 border-b border-border/30 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{pos.symbol}</span>
                        {pos.isListing && (
                          <Badge variant="secondary" className="text-yellow-400 border-yellow-400/20 bg-yellow-400/10 text-xs">NEW</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs font-mono">
                        <span className="text-muted-foreground">Entry ${pos.entryPrice?.toFixed(4)}</span>
                        <span className="text-green-400">TP ${pos.tpPrice?.toFixed(4)}</span>
                        <span className="text-red-400">SL ${pos.slPrice?.toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Historical reports */}
      {history.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Report History</h2>
          <div className="space-y-3">
            {history.map((report) => (
              <Card key={report.id} className="border-border/50">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono font-semibold">{report.date}</span>
                    <PnlBadge value={report.pnlUsd} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground">
                    <div>
                      <span>Trades: </span>
                      <span className="text-foreground font-medium">{report.tradesCount}</span>
                      <span className="ml-2 text-green-400">{report.winCount}W</span>
                      <span className="ml-1 text-red-400">{report.lossCount}L</span>
                    </div>
                    {report.bestSymbol && (
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-green-400" />
                        <span>{report.bestSymbol}</span>
                        <span className="text-green-400">+${report.bestPnl?.toFixed(3)}</span>
                      </div>
                    )}
                    {report.worstSymbol && report.worstPnl && report.worstPnl < 0 && (
                      <div className="flex items-center gap-1">
                        <TrendingDown className="h-3 w-3 text-red-400" />
                        <span>{report.worstSymbol}</span>
                        <span className="text-red-400">${report.worstPnl?.toFixed(3)}</span>
                      </div>
                    )}
                    <div>Open: {report.openPositionsCount} positions</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!today && history.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Rss className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-lg font-medium">No reports yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Reports are generated automatically every day at 08:00 UTC.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
