import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface SmartMoneyData {
  symbol: string;
  fundingRate: number;
  fundingVote: "BUY" | "SELL" | "HOLD";
  openInterest: number;
  oiChangeDir: "UP" | "DOWN" | "FLAT";
  whaleBuyUsd: number;
  whaleSellUsd: number;
  whaleVote: "BUY" | "SELL" | "HOLD";
  fetchedAt: number;
}

function fmtFunding(rate: number) {
  return (rate * 100).toFixed(4) + "%";
}

function fmtUsd(val: number) {
  if (val >= 1_000_000) return "$" + (val / 1_000_000).toFixed(2) + "M";
  if (val >= 1_000)     return "$" + (val / 1_000).toFixed(1) + "k";
  return "$" + val.toFixed(0);
}

function VoteBadge({ vote }: { vote: "BUY" | "SELL" | "HOLD" }) {
  const cls =
    vote === "BUY"  ? "bg-success/15 text-success border-success/30" :
    vote === "SELL" ? "bg-danger/15 text-danger border-danger/30"    :
                      "bg-muted/30 text-muted-foreground border-border";
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${cls}`}>
      {vote}
    </span>
  );
}

function OiBadge({ dir }: { dir: "UP" | "DOWN" | "FLAT" }) {
  const cls =
    dir === "UP"   ? "text-success" :
    dir === "DOWN" ? "text-danger"  : "text-muted-foreground";
  const icon = dir === "UP" ? "↑" : dir === "DOWN" ? "↓" : "→";
  return <span className={`font-bold ${cls}`}>{icon} {dir}</span>;
}

function FundingBar({ rate }: { rate: number }) {
  const pct = Math.min(Math.abs(rate) / 0.001 * 50, 50);
  const isPos = rate >= 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-muted/30 rounded-full overflow-hidden flex">
        {isPos ? (
          <>
            <div className="w-1/2" />
            <div className="bg-danger/70 rounded-full" style={{ width: pct + "%" }} />
          </>
        ) : (
          <>
            <div className="bg-success/70 rounded-full ml-auto" style={{ width: pct + "%" }} />
            <div className="w-1/2" />
          </>
        )}
      </div>
      <span className={`text-xs font-mono ${isPos ? "text-danger" : "text-success"}`}>
        {isPos ? "+" : ""}{fmtFunding(rate)}
      </span>
    </div>
  );
}

function WhaleBar({ buyUsd, sellUsd }: { buyUsd: number; sellUsd: number }) {
  const total = buyUsd + sellUsd;
  if (total === 0) return <span className="text-xs text-muted-foreground">No whale activity</span>;
  const buyPct = (buyUsd / total) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-danger/40 rounded-full overflow-hidden">
        <div className="h-full bg-success/70 rounded-full" style={{ width: buyPct + "%" }} />
      </div>
      <span className="text-xs text-muted-foreground font-mono">
        <span className="text-success">{fmtUsd(buyUsd)}</span>
        {" / "}
        <span className="text-danger">{fmtUsd(sellUsd)}</span>
      </span>
    </div>
  );
}

function SmartScore({ row }: { row: SmartMoneyData }) {
  let score = 0;
  if (row.fundingVote === "BUY")  score += 1;
  if (row.fundingVote === "SELL") score -= 1;
  if (row.whaleVote   === "BUY")  score += 1;
  if (row.whaleVote   === "SELL") score -= 1;
  if (row.oiChangeDir === "UP")   score += 1;
  if (row.oiChangeDir === "DOWN") score -= 1;
  const label =
    score >=  2 ? "VERY BULLISH" :
    score ===  1 ? "BULLISH"     :
    score === -1 ? "BEARISH"     :
    score <= -2  ? "VERY BEARISH": "NEUTRAL";
  const cls =
    score >=  2 ? "text-success bg-success/10 border-success/30" :
    score ===  1 ? "text-success/70 bg-success/5 border-success/20" :
    score === -1 ? "text-danger/70 bg-danger/5 border-danger/20"    :
    score <= -2  ? "text-danger bg-danger/10 border-danger/30"      :
                   "text-muted-foreground bg-muted/10 border-border";
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  );
}

export default function SmartMoney() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery<SmartMoneyData[]>({
    queryKey: ["smart-money"],
    queryFn: () => fetch(`${BASE}/api/smart-money`).then((r) => r.json()),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 0,
  });

  const lastUpdate = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Smart Money</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Funding rates, whale trades ($20k+) e open interest — dati che muovono il mercato prima di Twitter
          </p>
        </div>
        {lastUpdate && (
          <span className="text-xs text-muted-foreground font-mono">
            Aggiornato {lastUpdate}
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/50 bg-card p-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Funding Rate</p>
          <p className="text-xs text-muted-foreground">
            <span className="text-success font-bold">Negativo</span> = i trader short stanno pagando i long → qualcuno si aspetta un rialzo<br />
            <span className="text-danger font-bold">Molto positivo</span> = troppi long a leva → rischio di crollo improvviso
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Balene (Whale)</p>
          <p className="text-xs text-muted-foreground">
            Ordini da $20k+ rilevati nelle ultime 500 transazioni.<br />
            <span className="text-success font-bold">Verde</span> = buy grossi, <span className="text-danger font-bold">rosso</span> = vendite grosse
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card p-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Open Interest</p>
          <p className="text-xs text-muted-foreground">
            Soldi totali nei futures. <span className="text-success font-bold">↑ UP</span> con prezzo in salita = trend forte.<br />
            <span className="text-danger font-bold">↓ DOWN</span> con prezzo in salita = trend debole, potenziale inversione.
          </p>
        </div>
      </div>

      {/* Table */}
      {isLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Caricamento dati smart money...
        </div>
      )}
      {error && (
        <div className="text-center py-12 text-danger text-sm">
          Errore nel caricamento. Riprova tra qualche secondo.
        </div>
      )}
      {data && data.length > 0 && (
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Coppia</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Funding Rate</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Balene (Buy / Sell)</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Open Interest</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Funding</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Balene</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Score</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={row.symbol}
                  className={`border-b border-border/30 hover:bg-accent/5 transition-colors ${i % 2 === 0 ? "" : "bg-muted/5"}`}
                >
                  <td className="px-4 py-3 font-bold">
                    {row.symbol.replace("USDT", "")}
                    <span className="text-muted-foreground font-normal text-xs">/USDT</span>
                  </td>
                  <td className="px-4 py-3">
                    <FundingBar rate={row.fundingRate} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <WhaleBar buyUsd={row.whaleBuyUsd} sellUsd={row.whaleSellUsd} />
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {row.openInterest > 0 ? (
                      <div className="flex items-center gap-2">
                        <OiBadge dir={row.oiChangeDir} />
                        <span className="text-xs text-muted-foreground font-mono">
                          {row.openInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <VoteBadge vote={row.fundingVote} />
                  </td>
                  <td className="px-4 py-3">
                    <VoteBadge vote={row.whaleVote} />
                  </td>
                  <td className="px-4 py-3">
                    <SmartScore row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        I dati si aggiornano ogni 5 minuti · Fonte: Binance Futures + Spot (API pubbliche gratuite) · Usati anche come 2 voti aggiuntivi nel motore segnali
      </p>
    </div>
  );
}
