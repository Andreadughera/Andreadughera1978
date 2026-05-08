import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, TrendingUp, AlertCircle, Clock } from "lucide-react";

interface NewListing {
  id: number;
  symbol: string;
  instrument: string;
  volume24h: number | null;
  tradeExecuted: boolean;
  orderId: string | null;
  entryPrice: number | null;
  tpPrice: number | null;
  slPrice: number | null;
  status: "DETECTED" | "BOUGHT" | "CLOSED" | "SKIPPED";
  firstSeenAt: string;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function statusBadge(status: NewListing["status"]) {
  switch (status) {
    case "DETECTED":
      return <Badge variant="secondary" className="text-yellow-400 border-yellow-400/30 bg-yellow-400/10">DETECTED</Badge>;
    case "BOUGHT":
      return <Badge variant="secondary" className="text-green-400 border-green-400/30 bg-green-400/10">BOUGHT</Badge>;
    case "CLOSED":
      return <Badge variant="secondary" className="text-blue-400 border-blue-400/30 bg-blue-400/10">CLOSED</Badge>;
    case "SKIPPED":
      return <Badge variant="secondary" className="text-muted-foreground border-border">SKIPPED</Badge>;
  }
}

export default function Listings() {
  const { data: listings = [], isLoading } = useQuery<NewListing[]>({
    queryKey: ["listings"],
    queryFn: () => fetch(`${BASE}/api/listings`).then((r) => r.json()),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <Star className="h-5 w-5 text-yellow-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">New Listings</h1>
          <p className="text-sm text-muted-foreground">
            Auto-detected new pairs on Binance — quick-flip strategy (TP +10%, SL -3%, exit in 30 min)
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">Loading listings...</div>
      )}

      {!isLoading && listings.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Star className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-lg font-medium">No new listings detected yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              The system checks Binance every 5 minutes for new trading pairs.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {listings.map((listing) => (
          <Card key={listing.id} className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-mono">{listing.symbol}</CardTitle>
                {statusBadge(listing.status)}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Entry Price</p>
                  <p className="font-mono font-semibold">
                    {listing.entryPrice ? `$${listing.entryPrice.toFixed(6)}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Take Profit</p>
                  <p className="font-mono font-semibold text-green-400">
                    {listing.tpPrice ? `$${listing.tpPrice.toFixed(6)}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Stop Loss</p>
                  <p className="font-mono font-semibold text-red-400">
                    {listing.slPrice ? `$${listing.slPrice.toFixed(6)}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">24h Volume</p>
                  <p className="font-mono font-semibold">
                    {listing.volume24h
                      ? `$${(listing.volume24h / 1_000_000).toFixed(2)}M`
                      : "—"}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Detected {new Date(listing.firstSeenAt).toLocaleString()}</span>
                {listing.tradeExecuted && (
                  <>
                    <span className="mx-1">·</span>
                    <TrendingUp className="h-3 w-3 text-green-400" />
                    <span className="text-green-400">Trade executed</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/50 bg-muted/20">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">Quick-Flip Strategy</p>
              <p>New listings often surge immediately then retrace. The system buys $10 with a tight +10% take-profit and -3% stop-loss. If neither triggers within 30 minutes, the position is automatically closed regardless.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
