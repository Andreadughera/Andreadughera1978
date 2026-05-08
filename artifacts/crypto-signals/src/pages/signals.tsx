import { useState } from "react";
import { Link } from "wouter";
import { useListSignals, getListSignalsQueryKey, ListSignalsType } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Signals() {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<ListSignalsType | "ALL">("ALL");

  const params = {
    ...(symbolFilter ? { symbol: symbolFilter.toUpperCase() } : {}),
    ...(typeFilter !== "ALL" ? { type: typeFilter } : {}),
    limit: 100
  };

  const { data: signals, isLoading } = useListSignals(params, {
    query: { refetchInterval: 15000, queryKey: getListSignalsQueryKey(params) }
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Signal Feed</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time algorithmic trading indicators</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search symbol (e.g. BTC)"
              className="pl-9 font-mono bg-card"
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
            />
          </div>
          <Select value={typeFilter} onValueChange={(val: any) => setTypeFilter(val)}>
            <SelectTrigger className="w-[120px] bg-card">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              <SelectItem value="BUY" className="text-success">BUY</SelectItem>
              <SelectItem value="SELL" className="text-danger">SELL</SelectItem>
              <SelectItem value="HOLD">HOLD</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border border-border/50 bg-card/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-mono text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Pair</th>
                <th className="px-4 py-3 font-medium">Signal</th>
                <th className="px-4 py-3 font-medium text-right">Price</th>
                <th className="px-4 py-3 font-medium text-right">RSI</th>
                <th className="px-4 py-3 font-medium text-right">MA (S/L)</th>
                <th className="px-4 py-3 font-medium text-center">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="p-4"><Skeleton className="h-6 w-full" /></td>
                  </tr>
                ))
              ) : signals && signals.length > 0 ? (
                signals.map((sig) => (
                  <tr key={sig.id} className="hover:bg-accent/10 transition-colors group">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {new Date(sig.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link href={`/signals/${sig.symbol}`} className="font-bold hover:text-primary transition-colors flex items-center gap-2">
                        {sig.symbol}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant="outline" className={`font-mono ${
                        sig.type === 'BUY' ? 'bg-success/10 text-success border-success/20' : 
                        sig.type === 'SELL' ? 'bg-danger/10 text-danger border-danger/20' : 
                        'bg-muted text-muted-foreground border-border'
                      }`}>
                        {sig.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-mono">
                      ${sig.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-mono">
                      <span className={sig.rsi > 70 ? 'text-danger' : sig.rsi < 30 ? 'text-success' : ''}>
                        {sig.rsi.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-mono text-xs">
                      {sig.maShort.toFixed(1)} / {sig.maLong.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${sig.confidence > 80 ? 'bg-success' : sig.confidence > 50 ? 'bg-primary' : 'bg-muted-foreground'}`} 
                            style={{ width: `${sig.confidence}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs">{sig.confidence}%</span>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Zap className="h-8 w-8 text-muted-foreground/30" />
                      <p>No signals found matching your criteria</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
