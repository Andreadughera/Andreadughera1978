import { useGetMarketOverview, getGetMarketOverviewQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, BarChart2 } from "lucide-react";
import { Link } from "wouter";

export default function Market() {
  const { data: market, isLoading } = useGetMarketOverview({
    query: { refetchInterval: 15000, queryKey: getGetMarketOverviewQueryKey() }
  });

  const renderTable = (data: any[] | undefined, type: 'gainers' | 'losers' | 'volume') => {
    if (isLoading) {
      return (
        <div className="space-y-2 mt-4">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      );
    }
    
    if (!data || data.length === 0) return <div className="text-muted-foreground text-sm py-4">No data available</div>;

    return (
      <div className="mt-4">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground font-mono uppercase border-b border-border/50">
            <tr>
              <th className="pb-2 text-left font-medium">Pair</th>
              <th className="pb-2 text-right font-medium">Price</th>
              <th className="pb-2 text-right font-medium">Change</th>
              {type === 'volume' && <th className="pb-2 text-right font-medium">Vol</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {data.map(item => (
              <tr key={item.symbol} className="hover:bg-accent/5 transition-colors">
                <td className="py-3">
                  <Link href={`/signals/${item.symbol}`} className="font-bold hover:text-primary transition-colors">
                    {item.symbol.replace('USDT', '')}
                  </Link>
                </td>
                <td className="py-3 text-right font-mono">${item.price.toFixed(4)}</td>
                <td className={`py-3 text-right font-mono ${item.priceChangePercent >= 0 ? 'text-success' : 'text-danger'}`}>
                  {item.priceChangePercent > 0 ? '+' : ''}{item.priceChangePercent.toFixed(2)}%
                </td>
                {type === 'volume' && (
                  <td className="py-3 text-right font-mono text-muted-foreground">
                    {(item.volume / 1000).toFixed(1)}k
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Market Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">24-hour performance across all tracked pairs</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-card/50 border-success/20">
          <CardHeader className="pb-2 border-b border-border/30">
            <CardTitle className="text-lg flex items-center gap-2 text-success">
              <TrendingUp className="h-5 w-5" />
              Top Gainers
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {renderTable(market?.topGainers, 'gainers')}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-danger/20">
          <CardHeader className="pb-2 border-b border-border/30">
            <CardTitle className="text-lg flex items-center gap-2 text-danger">
              <TrendingDown className="h-5 w-5" />
              Top Losers
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {renderTable(market?.topLosers, 'losers')}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-primary/20">
          <CardHeader className="pb-2 border-b border-border/30">
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <BarChart2 className="h-5 w-5" />
              Volume Leaders
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {renderTable(market?.volumeLeaders, 'volume')}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
