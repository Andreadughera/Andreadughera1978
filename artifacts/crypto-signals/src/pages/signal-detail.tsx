import { useRoute, Link } from "wouter";
import { useGetPriceHistory, getGetPriceHistoryQueryKey, useGetSignalsHistory, getGetSignalsHistoryQueryKey } from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ExternalLink, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function SignalDetail() {
  const [, params] = useRoute("/signals/:symbol");
  const symbol = params?.symbol || "";

  const { data: history, isLoading: loadingHistory } = useGetPriceHistory(symbol, { limit: 100 }, {
    query: { enabled: !!symbol, queryKey: getGetPriceHistoryQueryKey(symbol, { limit: 100 }) }
  });

  const { data: signals, isLoading: loadingSignals } = useGetSignalsHistory({ symbol, limit: 10 }, {
    query: { enabled: !!symbol, queryKey: getGetSignalsHistoryQueryKey({ symbol, limit: 10 }) }
  });

  const chartData = history?.map(c => ({
    time: new Date(c.closeTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    price: c.close,
    volume: c.volume
  })) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/signals" className="p-2 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{symbol}</h1>
            <p className="text-sm text-muted-foreground font-mono">Binance Testnet Market Data</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Price Action
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingHistory ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="time" stroke="#666" tick={{ fill: '#666', fontSize: 12, fontFamily: 'Space Mono' }} tickMargin={10} />
                      <YAxis domain={['auto', 'auto']} stroke="#666" tick={{ fill: '#666', fontSize: 12, fontFamily: 'Space Mono' }} tickFormatter={(val) => `$${val}`} width={80} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f0f11', borderColor: '#1c1c1f', fontFamily: 'Space Mono', fontSize: '12px' }}
                        itemStyle={{ color: '#00f0ff' }}
                      />
                      <Line type="monotone" dataKey="price" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 6, fill: "hsl(var(--primary))" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Volume Profile</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingHistory ? (
                <Skeleton className="h-[150px] w-full" />
              ) : (
                <div className="h-[150px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                      <XAxis dataKey="time" hide />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f0f11', borderColor: '#1c1c1f', fontFamily: 'Space Mono', fontSize: '12px' }}
                        cursor={{ fill: '#ffffff10' }}
                      />
                      <Bar dataKey="volume" fill="hsl(var(--muted-foreground))" opacity={0.3} radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-card/50 border-border/50 h-full">
            <CardHeader>
              <CardTitle className="text-lg">Recent Signals</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingSignals ? (
                <div className="space-y-4">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                </div>
              ) : signals && signals.length > 0 ? (
                <div className="space-y-4">
                  {signals.map(sig => (
                    <div key={sig.id} className="p-4 border border-border/50 rounded-lg bg-background/50 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className={`font-mono text-xs ${
                          sig.type === 'BUY' ? 'bg-success/10 text-success border-success/20' : 
                          sig.type === 'SELL' ? 'bg-danger/10 text-danger border-danger/20' : 
                          'bg-muted text-muted-foreground border-border'
                        }`}>
                          {sig.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono">
                          {new Date(sig.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-sm font-mono">
                        <div>
                          <div className="text-xs text-muted-foreground">Price</div>
                          <div>${sig.price.toFixed(4)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">RSI</div>
                          <div className={sig.rsi > 70 ? 'text-danger' : sig.rsi < 30 ? 'text-success' : ''}>{sig.rsi.toFixed(2)}</div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/50">
                        <div className="text-xs text-muted-foreground mb-1">Reason</div>
                        <p className="text-xs">{sig.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  No recent signals for this pair.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
