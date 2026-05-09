import { useGetSignalsSummary, getGetSignalsSummaryQueryKey, useListPrices, getListPricesQueryKey, useGetMarketOverview, getGetMarketOverviewQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, TrendingUp, TrendingDown, Minus, Zap, AlertTriangle, Globe, Brain, Flame, Layers, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface MarketRegime {
  regime: string;
  regimeLabel: string;
  description: string;
  adx: number;
  bbWidth: number;
  btcTrend: string;
  tradingAdvice: string;
}

interface RiskSummary {
  dailyDrawdownPct: number;
  dailyDrawdownLimitPct: number;
  dailyPnl: number;
  openPositions: number;
  maxPositions: number;
  riskStatus: "SAFE" | "WARNING" | "HALTED";
}

interface TrendingCoin {
  name: string;
  symbol: string;
  marketCapRank: number | null;
  priceChangePercent24h: number | null;
  thumb: string;
}

interface GlobalMarketData {
  totalMarketCapUsd: number;
  marketCapChangePercent24h: number;
  btcDominance: number;
  ethDominance: number;
  activeCryptocurrencies: number;
  updatedAt: string;
}

interface MarketBriefing {
  summary: string;
  keyPoints: string[];
  outlook: "BULLISH" | "BEARISH" | "NEUTRAL";
  generatedAt: string;
}

interface SentimentData {
  fearGreed: { value: number; classification: string; updatedAt: string };
  whaleAlerts: Array<{
    symbol: string;
    volumeMultiplier: number;
    direction: string;
    price: number;
    detectedAt: string;
  }>;
  marketMood: string;
  tradingBias: string;
  lastUpdated: string;
  globalMarket?: GlobalMarketData | null;
  trending?: TrendingCoin[];
  aiBriefing?: MarketBriefing;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function FearGreedGauge({ value, classification }: { value: number; classification: string }) {
  const getColor = (v: number) => {
    if (v <= 24) return { bar: "bg-red-500", text: "text-red-400" };
    if (v <= 44) return { bar: "bg-orange-500", text: "text-orange-400" };
    if (v <= 55) return { bar: "bg-yellow-500", text: "text-yellow-400" };
    if (v <= 74) return { bar: "bg-lime-500", text: "text-lime-400" };
    return { bar: "bg-green-500", text: "text-green-400" };
  };
  const colors = getColor(value);
  const emoji = value <= 24 ? "😱" : value <= 44 ? "😨" : value <= 55 ? "😐" : value <= 74 ? "😊" : "🤑";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={`text-3xl font-bold font-mono ${colors.text}`}>{value}</span>
        <span className="text-2xl">{emoji}</span>
      </div>
      <div className="relative h-3 bg-muted rounded-full overflow-hidden">
        <div className={`absolute left-0 top-0 h-full ${colors.bar} rounded-full transition-all duration-700`} style={{ width: `${value}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>Ext. Fear</span><span>Fear</span><span>Neutral</span><span>Greed</span><span>Ext. Greed</span>
      </div>
      <p className={`text-xs font-semibold ${colors.text}`}>{classification}</p>
    </div>
  );
}

function fmt(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${n.toLocaleString()}`;
}

export default function Dashboard() {
  const REFRESH_INTERVAL = 15000;
  
  const { data: summary, isLoading: loadingSummary } = useGetSignalsSummary({
    query: { refetchInterval: REFRESH_INTERVAL, queryKey: getGetSignalsSummaryQueryKey() }
  });
  const { data: prices, isLoading: loadingPrices } = useListPrices({
    query: { refetchInterval: REFRESH_INTERVAL, queryKey: getListPricesQueryKey() }
  });
  const { data: market, isLoading: loadingMarket } = useGetMarketOverview({
    query: { refetchInterval: REFRESH_INTERVAL, queryKey: getGetMarketOverviewQueryKey() }
  });
  const { data: sentiment, isLoading: loadingSentiment } = useQuery<SentimentData>({
    queryKey: ["sentiment"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/sentiment`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<SentimentData>;
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });
  const { data: regime } = useQuery<MarketRegime>({
    queryKey: ["regime"],
    queryFn: () => fetch(`${BASE}/api/portfolio/regime`).then((r) => r.json()) as Promise<MarketRegime>,
    refetchInterval: 15 * 60 * 1000,
    staleTime: 10 * 60 * 1000,
  });
  const { data: risk } = useQuery<RiskSummary>({
    queryKey: ["risk"],
    queryFn: () => fetch(`${BASE}/api/portfolio/risk`).then((r) => r.json()) as Promise<RiskSummary>,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const outlookColor = sentiment?.aiBriefing?.outlook === "BULLISH"
    ? "text-success border-success/30 bg-success/10"
    : sentiment?.aiBriefing?.outlook === "BEARISH"
    ? "text-danger border-danger/30 bg-danger/10"
    : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";

  const regimeColor = regime?.regime === "TRENDING_BULL"
    ? "text-success border-success/30 bg-success/10"
    : regime?.regime === "TRENDING_BEAR"
    ? "text-danger border-danger/30 bg-danger/10"
    : regime?.regime === "VOLATILE"
    ? "text-orange-400 border-orange-500/30 bg-orange-500/10"
    : regime?.regime === "CONSOLIDATING"
    ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
    : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Market Pulse</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {regime && (
            <Badge variant="outline" className={`text-xs font-mono flex items-center gap-1 ${regimeColor}`}>
              <Layers className="h-3 w-3" />
              {(regime.regimeLabel ?? regime.regime ?? "UNKNOWN").toUpperCase()} · ADX {regime.adx ?? "--"}
            </Badge>
          )}
          {risk && risk.riskStatus !== "SAFE" && (
            <Badge variant="outline" className={`text-xs font-mono flex items-center gap-1 ${risk.riskStatus === "HALTED" ? "text-danger border-danger/30 bg-danger/10" : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"}`}>
              <Shield className="h-3 w-3" />
              {risk.riskStatus === "HALTED" ? "TRADING HALTED" : "RISK WARNING"}
            </Badge>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Live Feed Active
          </div>
        </div>
      </div>

      {/* Signal Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 border-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Signals</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {loadingSummary ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold font-mono text-primary">{summary?.total || 0}</div>}
            <p className="text-xs text-muted-foreground mt-1 font-mono">Across {summary?.trackedSymbols || 0} pairs</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-success/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">BUY Signals</CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {loadingSummary ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold font-mono text-success">{summary?.buyCount || 0}</div>}
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-danger/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">SELL Signals</CardTitle>
            <TrendingDown className="h-4 w-4 text-danger" />
          </CardHeader>
          <CardContent>
            {loadingSummary ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold font-mono text-danger">{summary?.sellCount || 0}</div>}
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">HOLD Signals</CardTitle>
            <Minus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingSummary ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold font-mono text-muted-foreground">{summary?.holdCount || 0}</div>}
          </CardContent>
        </Card>
      </div>

      {/* Global Market Metrics */}
      {(sentiment?.globalMarket || loadingSentiment) && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" /> Global Market
            </CardTitle>
            {sentiment?.globalMarket && (
              <span className={`text-xs font-mono font-bold ${sentiment.globalMarket.marketCapChangePercent24h >= 0 ? "text-success" : "text-danger"}`}>
                {sentiment.globalMarket.marketCapChangePercent24h >= 0 ? "+" : ""}{sentiment.globalMarket.marketCapChangePercent24h.toFixed(2)}% 24h
              </span>
            )}
          </CardHeader>
          <CardContent>
            {loadingSentiment ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : sentiment?.globalMarket ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <div className="text-xs text-muted-foreground mb-1">Total Market Cap</div>
                  <div className="font-bold font-mono text-lg">{fmt(sentiment.globalMarket.totalMarketCapUsd)}</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <div className="text-xs text-muted-foreground mb-1">BTC Dominance</div>
                  <div className="font-bold font-mono text-lg text-orange-400">{sentiment.globalMarket.btcDominance.toFixed(1)}%</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <div className="text-xs text-muted-foreground mb-1">ETH Dominance</div>
                  <div className="font-bold font-mono text-lg text-blue-400">{sentiment.globalMarket.ethDominance.toFixed(1)}%</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <div className="text-xs text-muted-foreground mb-1">Active Coins</div>
                  <div className="font-bold font-mono text-lg">{sentiment.globalMarket.activeCryptocurrencies.toLocaleString()}</div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Fear & Greed + AI Briefing */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg">Fear & Greed Index</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {loadingSentiment ? (
              <div className="space-y-3"><Skeleton className="h-8 w-24" /><Skeleton className="h-3 w-full" /><Skeleton className="h-4 w-32" /></div>
            ) : sentiment ? (
              <FearGreedGauge value={sentiment.fearGreed.value} classification={sentiment.fearGreed.classification} />
            ) : <p className="text-muted-foreground text-sm">Unavailable</p>}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-400" /> AI Market Briefing
            </CardTitle>
            {sentiment?.aiBriefing && (
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${outlookColor}`}>
                {sentiment.aiBriefing.outlook}
              </span>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingSentiment ? (
              <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" /></div>
            ) : sentiment?.aiBriefing ? (
              <>
                <p className="text-sm text-muted-foreground leading-relaxed">{sentiment.aiBriefing.summary}</p>
                {sentiment.aiBriefing.keyPoints.length > 0 && (
                  <ul className="space-y-1">
                    {sentiment.aiBriefing.keyPoints.map((p, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span> {p}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground/50 font-mono">
                  Generated {new Date(sentiment.aiBriefing.generatedAt).toLocaleTimeString()}
                </p>
              </>
            ) : <p className="text-muted-foreground text-sm">Unavailable</p>}
          </CardContent>
        </Card>
      </div>

      {/* Trending + Whale Alerts */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Trending coins */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" /> Trending Now
            </CardTitle>
            <span className="text-xs text-muted-foreground">CoinGecko</span>
          </CardHeader>
          <CardContent>
            {loadingSentiment ? (
              <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : sentiment?.trending?.length ? (
              <div className="space-y-0">
                {sentiment.trending.slice(0, 7).map((coin, i) => {
                  const chg = coin.priceChangePercent24h;
                  const isUp = chg !== null && chg >= 0;
                  return (
                    <div key={coin.symbol} className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground font-mono w-4">#{i + 1}</span>
                        {coin.thumb && <img src={coin.thumb} alt={coin.name} className="w-5 h-5 rounded-full" />}
                        <div>
                          <div className="font-bold text-sm">{coin.symbol}</div>
                          <div className="text-xs text-muted-foreground">{coin.name}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        {chg !== null ? (
                          <span className={`text-xs font-mono font-bold ${isUp ? "text-success" : "text-danger"}`}>
                            {isUp ? "+" : ""}{chg.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {coin.marketCapRank && (
                          <div className="text-xs text-muted-foreground">rank #{coin.marketCapRank}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-muted-foreground">No trending data</p>}
          </CardContent>
        </Card>

        {/* Whale alerts or trading bias */}
        <Card className={`bg-card/50 ${sentiment && sentiment.whaleAlerts.length > 0 ? "border-yellow-500/20" : "border-border/50"}`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              {sentiment && sentiment.whaleAlerts.length > 0
                ? <><AlertTriangle className="h-4 w-4 text-yellow-400" /> Volume Spikes</>
                : <><Zap className="h-4 w-4 text-yellow-400" /> AI Trading Bias</>}
            </CardTitle>
            <span className="text-xs text-muted-foreground">Last 30 min</span>
          </CardHeader>
          <CardContent>
            {loadingSentiment ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : sentiment && sentiment.whaleAlerts.length > 0 ? (
              <div className="space-y-0">
                {sentiment.whaleAlerts.slice(0, 6).map((alert, i) => (
                  <div key={i} className="flex items-center justify-between py-3 border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${alert.direction === "BUY" ? "bg-success" : alert.direction === "SELL" ? "bg-danger" : "bg-muted-foreground"}`} />
                      <div>
                        <div className="font-bold text-sm">{alert.symbol.replace("USDT", "")}</div>
                        <div className="text-xs text-muted-foreground font-mono">{new Date(alert.detectedAt).toLocaleTimeString()}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono font-bold text-yellow-400">{alert.volumeMultiplier}x vol</div>
                      <div className={`text-xs font-mono ${alert.direction === "BUY" ? "text-success" : alert.direction === "SELL" ? "text-danger" : "text-muted-foreground"}`}>{alert.direction}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : sentiment ? (
              <div className="space-y-3">
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold font-mono border ${
                  sentiment.marketMood === "EXTREME_FEAR" ? "bg-red-500/10 text-red-400 border-red-500/30" :
                  sentiment.marketMood === "FEAR" ? "bg-orange-500/10 text-orange-400 border-orange-500/30" :
                  sentiment.marketMood === "NEUTRAL" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" :
                  sentiment.marketMood === "GREED" ? "bg-lime-500/10 text-lime-400 border-lime-500/30" :
                  "bg-green-500/10 text-green-400 border-green-500/30"
                }`}>{sentiment.marketMood.replace("_", " ")}</div>
                <p className="text-sm text-muted-foreground">{sentiment.tradingBias}</p>
                <p className="text-xs text-muted-foreground/50 font-mono">No abnormal volume spikes detected</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Live Prices + Top Movers */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card/50 border-border/50">
          <CardHeader><CardTitle className="text-lg">Live Prices</CardTitle></CardHeader>
          <CardContent>
            {loadingPrices ? (
              <div className="space-y-4">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : (
              <div className="space-y-0">
                {prices?.slice(0, 8).map((p) => {
                  const isUp = p.priceChangePercent >= 0;
                  return (
                    <Link key={p.symbol} href={`/signals/${p.symbol}`}>
                      <div className="flex items-center justify-between py-3 border-b border-border/40 hover:bg-accent/20 cursor-pointer px-2 -mx-2 rounded transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="font-bold tracking-wider">{p.symbol.replace('USDT', '')}</div>
                          <div className="text-xs text-muted-foreground font-mono">/USD</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-sm">${p.price.toFixed(2)}</div>
                          <div className={`text-xs font-mono ${isUp ? 'text-success' : 'text-danger'}`}>
                            {isUp ? '+' : ''}{p.priceChangePercent.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader><CardTitle className="text-lg">Top Movers</CardTitle></CardHeader>
          <CardContent>
            {loadingMarket ? (
              <div className="space-y-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-success"/> Gainers</h3>
                  <div className="space-y-0 border border-success/20 rounded-md bg-success/5">
                    {market?.topGainers.slice(0,3).map((p: any) => (
                      <div key={p.symbol} className="flex justify-between items-center p-3 border-b border-success/10 last:border-0">
                        <span className="font-bold">{p.symbol.replace('USDT', '')}</span>
                        <span className="text-success font-mono">+{p.priceChangePercent.toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2"><TrendingDown className="h-4 w-4 text-danger"/> Losers</h3>
                  <div className="space-y-0 border border-danger/20 rounded-md bg-danger/5">
                    {market?.topLosers.slice(0,3).map((p: any) => (
                      <div key={p.symbol} className="flex justify-between items-center p-3 border-b border-danger/10 last:border-0">
                        <span className="font-bold">{p.symbol.replace('USDT', '')}</span>
                        <span className="text-danger font-mono">{p.priceChangePercent.toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
