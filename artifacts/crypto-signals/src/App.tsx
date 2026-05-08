import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Signals from "@/pages/signals";
import SignalDetail from "@/pages/signal-detail";
import Market from "@/pages/market";
import Trades from "@/pages/trades";
import SettingsPage from "@/pages/settings";
import Listings from "@/pages/listings";
import Reports from "@/pages/reports";
import Portfolio from "@/pages/portfolio";
import Arbitrage from "@/pages/arbitrage";
import SmartMoney from "@/pages/smart-money";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 60_000,
      retry: 1,
    },
  },
});

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface AuthStatus {
  authRequired: boolean;
  configured: boolean;
  authenticated: boolean;
}

function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/auth/status`, { credentials: "include" })
      .then((res) => res.json())
      .then((data: AuthStatus) => setStatus(data))
      .catch(() =>
        setStatus({ authRequired: true, configured: false, authenticated: false }),
      );
  }, []);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Login failed");
      }
      setStatus({ authRequired: true, configured: true, authenticated: true });
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!status) {
    return (
      <div className="min-h-screen bg-background text-foreground grid place-items-center">
        <div className="text-sm text-muted-foreground">Loading secure session...</div>
      </div>
    );
  }

  if (!status.authRequired || status.authenticated) return <>{children}</>;

  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center p-6">
      <form
        onSubmit={submitLogin}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg space-y-4"
      >
        <div>
          <h1 className="text-2xl font-bold">Crypto Sentinel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Accesso protetto alla dashboard e alle API di trading.
          </p>
        </div>

        {!status.configured && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
            Autenticazione non configurata sul server. Imposta DASHBOARD_PASSWORD e
            SESSION_SECRET nelle variabili ambiente prima di usare soldi reali.
          </div>
        )}

        <label className="block space-y-2">
          <span className="text-sm font-medium">Password dashboard</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            autoFocus
          />
        </label>

        {error && <div className="text-sm text-danger">{error}</div>}

        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? "Accesso..." : "Entra"}
        </button>
      </form>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={() => <ErrorBoundary><Dashboard /></ErrorBoundary>} />
        <Route path="/signals" component={() => <ErrorBoundary><Signals /></ErrorBoundary>} />
        <Route path="/signals/:symbol" component={() => <ErrorBoundary><SignalDetail /></ErrorBoundary>} />
        <Route path="/trades" component={() => <ErrorBoundary><Trades /></ErrorBoundary>} />
        <Route path="/market" component={() => <ErrorBoundary><Market /></ErrorBoundary>} />
        <Route path="/listings" component={() => <ErrorBoundary><Listings /></ErrorBoundary>} />
        <Route path="/reports" component={() => <ErrorBoundary><Reports /></ErrorBoundary>} />
        <Route path="/portfolio" component={() => <ErrorBoundary><Portfolio /></ErrorBoundary>} />
        <Route path="/arbitrage" component={() => <ErrorBoundary><Arbitrage /></ErrorBoundary>} />
        <Route path="/smart-money" component={() => <ErrorBoundary><SmartMoney /></ErrorBoundary>} />
        <Route path="/settings" component={() => <ErrorBoundary><SettingsPage /></ErrorBoundary>} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <AuthGate>
            <Router />
          </AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
