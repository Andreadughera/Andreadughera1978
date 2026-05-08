import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, BarChart2, Zap, ShieldCheck, ShieldAlert, History, Settings, Rss, Star, PieChart, ArrowLeftRight, Waves } from "lucide-react";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const { data: health, isError } = useHealthCheck({
    query: { refetchInterval: 30000, queryKey: getHealthCheckQueryKey() }
  });

  const navItems = [
    { href: "/", label: "Pulse", icon: Activity },
    { href: "/signals", label: "Signals", icon: Zap },
    { href: "/trades", label: "Trades", icon: History },
    { href: "/portfolio", label: "Portfolio", icon: PieChart },
    { href: "/arbitrage", label: "Arbitrage", icon: ArrowLeftRight },
    { href: "/smart-money", label: "Whale", icon: Waves },
    { href: "/market", label: "Market", icon: BarChart2 },
    { href: "/listings", label: "Listings", icon: Star },
    { href: "/reports", label: "Reports", icon: Rss },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground dark">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4 md:px-6">
          <div className="flex items-center overflow-x-auto">
            <Link href="/" className="mr-4 flex items-center space-x-2 shrink-0">
              <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center border border-primary/50">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <span className="font-bold text-lg tracking-tight">CryptoSentinel</span>
            </Link>
            <nav className="flex items-center space-x-0.5 text-sm font-medium">
              {navItems.map((item) => {
                const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-2 rounded-md transition-colors hover:bg-accent hover:text-accent-foreground flex items-center gap-1.5 whitespace-nowrap ${
                      active ? "bg-accent/50 text-primary" : "text-muted-foreground"
                    }`}
                    data-testid={`nav-${item.label.toLowerCase()}`}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          
          <div className="flex items-center gap-2 text-xs font-mono shrink-0 ml-2">
            {!isError && health?.status === 'ok' ? (
              <div className="flex items-center gap-1.5 text-success px-2 py-1 rounded bg-success/10 border border-success/20">
                <ShieldCheck className="h-3 w-3" />
                <span>API ONLINE</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-danger px-2 py-1 rounded bg-danger/10 border border-danger/20">
                <ShieldAlert className="h-3 w-3" />
                <span>API OFFLINE</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto p-4 md:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
