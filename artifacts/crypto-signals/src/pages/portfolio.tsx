import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell
} from "recharts";
import {
  TrendingUp, TrendingDown, Activity, Award, Target, Clock,
  AlertTriangle, Shield, Cpu, BarChart2, Layers
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface PortfolioStats {
  totalPnl: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  avgHoldHours: number;
  bestTrade: { symbol: string; pnl: number; date: string } | null;
  worstTrade: { symbol: string; pnl: number; date: string } | null;
  sharpeRatio: number;
  totalReturn: number;
}

interface EquityPoint {
  date: string;
  dailyPnl: number;
  cumulativePnl: number;
  trades: number;
}

interface SymbolStat {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  winRate: number;
  avgPnl: number;
}

interface OpenPosition {
  id: number;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  tpPrice: number;
  slPrice: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  tpDistancePct: number;
  slDistancePct: number;
  hoursOpen: number;
  confidence: number;
}

interface MarketRegime {
  regime: string;
  regimeLabel: string;
  description: string;
  adx: number;
  bbWidth: number;
  btcTrend: string;
  tradingAdvice: string;
}

interface TunedParams {
  optimalMinConfidence: number;
  winRateByConfidence: Array<{ bucket: string; winRate: number; trades: number; avgPnl: number }>;
  insights: string[];
  lastAnalyzed: string;
  totalTradesAnalyzed: number;
}

interface RiskSummary {
  dailyDrawdownPct: number;
  dailyDrawdownLimitPct: number;
  dailyPnl: number;
  openPositions: number;
  maxPositions: number;
  investedCapital: number;
  riskStatus: "SAFE" | "WARNING" | "HALTED";
}

function StatCard({
  label, value, sub, icon: Icon, color, loading
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string; loading: boolean;
}) {
  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {loading ? <Skeleton className="h-7 w-24" /> : (
          <>
            <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function pnlColor(v: number) {
  return v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted-foreground";
}

function regimeBadgeClass(regime: string) {
  if (regime.startsWith("TRENDING_BULL")) return "bg-success/10 text-success border-success/30";
  if (regime.startsWith("TRENDING_BEAR")) return "bg-danger/10 text-danger border-danger/30";
  if (regime === "VOLATILE") return "bg-orange-500/10 text-orange-400 border-orange-500/30";
  if (regime === "CONSOLIDATING") return "bg-blue-500/10 text-blue-400 border-blue-500/30";
  return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
}

export default function Portfolio() {
  const { data: stats, isLoading: lStats } = useQuery<PortfolioStats>({
    queryKey: ["portfolio-stats"],
    queryFn: () => fetch(`${BASE}/api/portfolio/stats`).then((r) => r.json()) as Promise<PortfolioStats>,
    refetchInterval: 30_000,
  });

  const { data: equity, isLoading: lEquity } = useQuery<EquityPoint[]>({
    queryKey: ["portfolio-equity"],
    queryFn: () => fetch(`${BASE}/api/portfolio/equity-curve?days=30`).then((r) => r.json()) as Promise<EquityPoint[]>,
    refetchInterval: 60_000,
  });

  const { data: symbols, isLoading: lSymbols } = useQuery<SymbolStat[]>({
    queryKey: ["portfolio-symbols"],
    queryFn: () => fetch(`${BASE}/api/portfolio/symbols`).then((r) => r.json()) as Promise<SymbolStat[]>,
    refetchInterval: 60_000,
  });

  const { data: positions, isLoading: lPositions } = useQuery<OpenPosition[]>({
    queryKey: ["portfolio-positions"],
    queryFn: () => fetch(`${BASE}/api/portfolio/positions`).then((r) => r.json()) as Promise<OpenPosition[]>,
    refetchInterval: 15_000,
  });

  const { data: regime, isLoading: lRegime } = useQuery<MarketRegime>({
    queryKey: ["portfolio-regime"],
    queryFn: () => fetch(`${BASE}/api/portfolio/regime`).then((r) => r.json()) as Promise<MarketRegime>,
    refetchInterval: 15 * 60_000,
  });

  const { data: tuner, isLoading: lTuner } = useQuery<TunedParams>({
    queryKey: ["portfolio-tuner"],
    queryFn: () => fetch(`${BASE}/api/portfolio/tuner`).then((r) => r.json()) as Promise<TunedParams>,
    refetchInterval: 60 * 60_000,
  });

  const { data: risk, isLoading: lRisk } = useQuery<RiskSummary>({
    queryKey: ["portfolio-risk"],
    queryFn: () => fetch(`${BASE}/api/portfolio/risk`).then((r) => r.json()) as Promise<RiskSummary>,
    refetchInterval: 30_000,
  });

  const hasEquityData = equity && equity.some((p) => p.trades > 0 || p.cumulativePnl !== 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Portfolio Analytics</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time performance, risk metrics, and self-optimization</p>
        </div>
        {risk && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold font-mono ${
            risk.riskStatus === "SAFE" ? "bg-success/10 text-success border-success/30" :
            risk.riskStatus === "WARNING" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" :
            "bg-danger/10 text-danger border-danger/30"
          }`}>
            <Shield className="h-3 w-3" />
            RISK {risk.riskStatus}
          </div>
        )}
      </div>

      {/* Key Stats */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        <StatCard label="Total P&L" value={stats ? `${stats.totalPnl >= 0 ? '+' : ''}$${Number(stats.totalPnl).toFixed(2)}` : '$0.00'} icon={TrendingUp} color={stats ? pnlColor(stats.totalPnl) : "text-muted-foreground"} loading={lStats} />
        <StatCard label="Win Rate" value={stats ? `${Number(stats.winRate).toFixed(1)}%` : '0%'} sub={stats ? `${stats.winCount ?? 0}W / ${stats.lossCount ?? 0}L` : '0W / 0L'} icon={Target} color={stats && stats.winRate >= 55 ? "text-success" : "text-danger"} loading={lStats} />
        <StatCard label="Profit Factor" value={stats ? Number(stats.profitFactor).toFixed(2) : '—'} sub="Gross W / Gross L" icon={BarChart2} color={stats && stats.profitFactor >= 1.5 ? "text-success" : stats && stats.profitFactor >= 1 ? "text-yellow-400" : "text-danger"} loading={lStats} />
        <StatCard label="Sharpe Ratio" value={stats ? Number(stats.sharpeRatio).toFixed(2) : '—'} sub="Annualized" icon={Activity} color={stats && stats.sharpeRatio >= 1 ? "text-success" : "text-muted-foreground"} loading={lStats} />
        <StatCard label="Max Drawdown" value={stats ? `$${Number(stats.maxDrawdown).toFixed(2)}` : '$0.00'} icon={TrendingDown} color="text-danger" loading={lStats} />
        <StatCard label="Avg Hold" value={stats ? `${Number(stats.avgHoldHours).toFixed(1)}h` : '—'} icon={Clock} color="text-primary" loading={lStats} />
        <StatCard label="Avg Win" value={stats ? `$${Number(stats.avgWin).toFixed(2)}` : '$0.00'} icon={Award} color="text-success" loading={lStats} />
        <StatCard label="Avg Loss" value={stats ? `$${Number(stats.avgLoss).toFixed(2)}` : '$0.00'} icon={AlertTriangle} color="text-danger" loading={lStats} />
      </div>

      {/* Equity Curve + Market Regime */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Equity Curve */}
        <Card className="lg:col-span-2 bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Equity Curve (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lEquity ? (
              <Skeleton className="h-48 w-full" />
            ) : !hasEquityData ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No closed trades yet — equity curve will appear after first trade is closed
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={equity} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name === "cumulativePnl" ? "Cumulative P&L" : "Daily P&L"]}
                    labelFormatter={(l: string) => l}
                  />
                  <Area type="monotone" dataKey="cumulativePnl" stroke="hsl(var(--primary))" fill="url(#pnlGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Market Regime */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-purple-400" /> Market Regime
              </CardTitle>
              {regime && (
                <Badge variant="outline" className={`text-xs font-mono ${regimeBadgeClass(regime.regime)}`}>
                  {regime.regimeLabel.toUpperCase()}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {lRegime ? (
              <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
            ) : regime ? (
              <>
                <p className="text-sm text-muted-foreground leading-relaxed">{regime.description}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-xs text-muted-foreground">ADX</div>
                    <div className={`font-bold font-mono text-sm ${regime.adx > 25 ? "text-success" : "text-yellow-400"}`}>{regime.adx}</div>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-xs text-muted-foreground">BB Width</div>
                    <div className="font-bold font-mono text-sm">{regime.bbWidth}%</div>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <div className="text-xs text-muted-foreground">BTC 4h</div>
                    <div className={`font-bold font-mono text-sm ${regime.btcTrend === "BULL" ? "text-success" : regime.btcTrend === "BEAR" ? "text-danger" : "text-muted-foreground"}`}>
                      {regime.btcTrend}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-primary/80 bg-primary/5 rounded p-2 border border-primary/10 leading-relaxed">
                  💡 {regime.tradingAdvice}
                </div>
              </>
            ) : <p className="text-sm text-muted-foreground">Loading regime…</p>}
          </CardContent>
        </Card>
      </div>

      {/* Open Positions with Live PnL */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-success" /> Open Positions — Live P&L
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lPositions ? (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !positions || positions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No open positions</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider font-mono">
                  <tr>
                    <th className="px-4 py-2 text-left">Asset</th>
                    <th className="px-4 py-2 text-right">Entry</th>
                    <th className="px-4 py-2 text-right">Current</th>
                    <th className="px-4 py-2 text-right">Unrealized P&L</th>
                    <th className="px-4 py-2 text-right">TP dist.</th>
                    <th className="px-4 py-2 text-right">SL dist.</th>
                    <th className="px-4 py-2 text-right">Open for</th>
                    <th className="px-4 py-2 text-right">Conf.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {positions.map((p) => (
                    <tr key={p.id} className={`hover:bg-accent/10 transition-colors ${p.unrealizedPnl > 0 ? "border-l-2 border-success" : p.unrealizedPnl < 0 ? "border-l-2 border-danger" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-bold">{p.symbol.replace("USDT", "")}</div>
                        <div className="text-xs text-muted-foreground font-mono">{p.quantity.toFixed(4)} units</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">${p.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">${p.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                      <td className="px-4 py-3 text-right">
                        <div className={`font-bold font-mono text-sm ${pnlColor(p.unrealizedPnl)}`}>
                          {p.unrealizedPnl >= 0 ? "+" : ""}${p.unrealizedPnl.toFixed(2)}
                        </div>
                        <div className={`text-xs font-mono ${pnlColor(p.unrealizedPct)}`}>
                          {p.unrealizedPct >= 0 ? "+" : ""}{p.unrealizedPct.toFixed(2)}%
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-success">+{p.tpDistancePct.toFixed(2)}%</td>
                      <td className={`px-4 py-3 text-right font-mono text-xs ${p.slDistancePct < 2 ? "text-danger font-bold" : "text-muted-foreground"}`}>
                        {p.slDistancePct.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{p.hoursOpen.toFixed(1)}h</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{p.confidence.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Symbol Stats + Self-Tuner */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Per-symbol */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" /> Performance by Asset
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {lSymbols ? (
              <div className="p-4 space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : !symbols || symbols.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No trade history yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider font-mono">
                    <tr>
                      <th className="px-4 py-2 text-left">Asset</th>
                      <th className="px-4 py-2 text-center">Trades</th>
                      <th className="px-4 py-2 text-center">Win%</th>
                      <th className="px-4 py-2 text-right">Total P&L</th>
                      <th className="px-4 py-2 text-right">Avg P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {symbols.slice(0, 12).map((s) => (
                      <tr key={s.symbol} className="hover:bg-accent/10 transition-colors">
                        <td className="px-4 py-2 font-bold">{s.symbol.replace("USDT", "")}</td>
                        <td className="px-4 py-2 text-center font-mono text-xs text-muted-foreground">{s.trades}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`font-mono text-xs font-bold ${s.winRate >= 55 ? "text-success" : s.winRate < 45 ? "text-danger" : "text-yellow-400"}`}>
                            {s.winRate.toFixed(0)}%
                          </span>
                        </td>
                        <td className={`px-4 py-2 text-right font-mono text-xs font-bold ${pnlColor(s.totalPnl)}`}>
                          {s.totalPnl >= 0 ? "+" : ""}${s.totalPnl.toFixed(2)}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono text-xs ${pnlColor(s.avgPnl)}`}>
                          {s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Self-Tuner */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4 text-purple-400" /> Self-Optimization Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {lTuner ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : tuner && "winRateByConfidence" in tuner ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Optimal min confidence</span>
                  <span className="font-bold font-mono text-primary">{tuner.optimalMinConfidence}%</span>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground font-mono uppercase mb-2">Win Rate by Confidence Level</div>
                  {tuner.winRateByConfidence.map((b) => (
                    <div key={b.bucket} className="flex items-center gap-2">
                      <span className="text-xs font-mono w-12 text-muted-foreground">{b.bucket}%</span>
                      <div className="flex-1 bg-muted/30 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${b.winRate >= 60 ? "bg-success" : b.winRate >= 50 ? "bg-yellow-500" : "bg-danger"}`}
                          style={{ width: `${b.winRate}%` }}
                        />
                      </div>
                      <span className={`text-xs font-mono font-bold w-8 ${b.winRate >= 60 ? "text-success" : b.winRate >= 50 ? "text-yellow-400" : "text-danger"}`}>
                        {b.winRate}%
                      </span>
                      <span className="text-xs text-muted-foreground w-12 text-right">{b.trades}t</span>
                    </div>
                  ))}
                </div>
                {tuner.insights.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-border/40">
                    {tuner.insights.map((insight, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex gap-2">
                        <span className="text-primary shrink-0">→</span>
                        <span>{insight}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground/50 font-mono">
                  Analyzed {tuner.totalTradesAnalyzed} trades · {new Date(tuner.lastAnalyzed).toLocaleTimeString()}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Self-tuner initializing — needs at least 5 closed trades to begin analysis</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Risk Dashboard */}
      {risk && (
        <Card className={`bg-card/50 ${risk.riskStatus === "HALTED" ? "border-danger/40" : risk.riskStatus === "WARNING" ? "border-yellow-500/40" : "border-border/50"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Risk Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground mb-1">Today's P&L</div>
                <div className={`font-bold font-mono text-lg ${pnlColor(risk.dailyPnl)}`}>
                  {risk.dailyPnl >= 0 ? "+" : ""}${risk.dailyPnl.toFixed(2)}
                </div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground mb-1">Daily Drawdown</div>
                <div className={`font-bold font-mono text-lg ${risk.dailyDrawdownPct >= risk.dailyDrawdownLimitPct * 0.7 ? "text-danger" : "text-success"}`}>
                  {risk.dailyDrawdownPct.toFixed(1)}% / {risk.dailyDrawdownLimitPct.toFixed(0)}%
                </div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground mb-1">Open Positions</div>
                <div className="font-bold font-mono text-lg">{risk.openPositions} / {risk.maxPositions}</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground mb-1">Capital Deployed</div>
                <div className="font-bold font-mono text-lg">${risk.investedCapital.toFixed(2)}</div>
              </div>
            </div>
            {risk.riskStatus === "HALTED" && (
              <div className="mt-3 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
                ⛔ Trading halted — daily drawdown limit reached. New BUY entries are paused until tomorrow UTC.
              </div>
            )}
            {risk.riskStatus === "WARNING" && (
              <div className="mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-400">
                ⚠️ Approaching daily drawdown limit — position sizing reduced automatically.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
