import { useState, useEffect, useCallback, useRef } from "react";
import { useGetExchangeSettings, getGetExchangeSettingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Database, Save, Activity, AlertTriangle, ExternalLink, Info } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";

interface ConnectionTestResult {
  success: boolean;
  message: string;
  accountType?: string | null;
  balances?: Array<{ asset: string; free: string; locked: string }> | null;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { ...opts, credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function parseNum(value: string): number {
  return parseFloat(value.replace(",", "."));
}

function ServerIpBadge() {
  const [ip, setIp] = useState<string | null>(null);
  const fetchIp = useCallback(() => {
    fetch(`${BASE}/api/server-info`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setIp(d.ip))
      .catch(() => setIp("unavailable"));
  }, []);
  useEffect(() => { fetchIp(); }, [fetchIp]);
  if (!ip) return <span className="font-mono text-xs text-muted-foreground">loading...</span>;
  return (
    <span
      className="font-mono bg-background px-1.5 py-0.5 rounded border border-border/50 text-primary select-all cursor-pointer"
      title="Click to copy"
      onClick={() => navigator.clipboard.writeText(ip)}
    >
      {ip} <span className="text-muted-foreground text-[10px]">(click to copy)</span>
    </span>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [minConfidence, setMinConfidence] = useState(70);
  const [takeProfit, setTakeProfit] = useState(1.5);
  const [stopLoss, setStopLoss] = useState(0.3);

  const initialized = useRef(false);

  const { data: settings, isLoading } = useGetExchangeSettings({
    query: {
      queryKey: getGetExchangeSettingsQueryKey(),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    }
  });

  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true;
      setAutoTradeEnabled(settings.autoTradeEnabled ?? false);
      setMinConfidence(settings.minConfidence ?? 70);
      setTakeProfit(settings.takeProfitPct ?? 1.5);
      setStopLoss(settings.stopLossPct ?? 0.3);
    }
  }, [settings]);

  const saveKeys = useMutation({
    mutationFn: (body: object) =>
      apiFetch("/api/settings/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("API keys saved");
      queryClient.invalidateQueries({ queryKey: getGetExchangeSettingsQueryKey() });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save keys"),
  });

  const saveConfig = useMutation({
    mutationFn: (body: object) =>
      apiFetch("/api/settings/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Configuration saved");
      queryClient.invalidateQueries({ queryKey: getGetExchangeSettingsQueryKey() });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save config"),
  });

  const testConn = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/exchange/test", { method: "POST" }) as Promise<ConnectionTestResult>,
    onSuccess: (data) => {
      setTestResult(data);
      if (data.success) toast.success("Connection successful");
      else toast.error(data.message || "Connection failed");
    },
    onError: (e: Error) => {
      setTestResult({ success: false, message: e.message || "Connection failed" });
      toast.error("Connection test failed");
    },
  });

  const killSwitch = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/exchange/kill-switch", { method: "POST" }),
    onSuccess: () => {
      setAutoTradeEnabled(false);
      toast.success("Auto-trade disabled");
      queryClient.invalidateQueries({ queryKey: getGetExchangeSettingsQueryKey() });
    },
    onError: (e: Error) => toast.error(e.message || "Kill switch failed"),
  });

  const handleSaveKeys = () => {
    const body: Record<string, unknown> = {
      autoTradeEnabled,
      minConfidence,
      takeProfitPct: takeProfit,
      stopLossPct: stopLoss,
    };
    if (apiKey) body.apiKey = apiKey;
    if (apiSecret) body.secretKey = apiSecret;
    saveKeys.mutate(body);
  };

  const handleSaveConfig = () => {
    if (isNaN(minConfidence) || minConfidence < 0 || minConfidence > 100) {
      toast.error("Fiducia minima non valida (0–100)");
      return;
    }
    if (isNaN(takeProfit) || takeProfit < 0.01 || takeProfit > 20) {
      toast.error("Prendi profitto non valido (0.01–20%)");
      return;
    }
    if (isNaN(stopLoss) || stopLoss < 0.01 || stopLoss > 10) {
      toast.error("Stop loss non valido (0.01–10%)");
      return;
    }
    saveConfig.mutate({
      autoTradeEnabled,
      minConfidence,
      takeProfitPct: takeProfit,
      stopLossPct: stopLoss,
    });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure Crypto.com Exchange API and auto-trade parameters</p>
      </div>

      {/* API Keys Card */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="border-b border-border/50 bg-muted/20">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Crypto.com Exchange API Keys</CardTitle>
            {!isLoading && settings && (
              <Badge variant="outline" className="font-mono text-xs flex items-center gap-1">
                <Database className="w-3 h-3" />
                Source: {settings.source}
              </Badge>
            )}
          </div>
          <CardDescription className="flex items-center gap-1">
            Keys are stored encrypted when SETTINGS_ENCRYPTION_KEY is configured. Generate API keys at{" "}
            <a
              href="https://crypto.com/exchange/personal/api-management"
              target="_blank"
              rel="noopener"
              className="text-primary underline-offset-2 hover:underline inline-flex items-center gap-0.5"
            >
              crypto.com/exchange <ExternalLink className="w-3 h-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          {/* Key status indicators */}
          {isLoading ? (
            <div className="flex gap-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-44" /></div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 bg-background/50 px-3 py-2 rounded-md border border-border/50">
                <span className="text-xs text-muted-foreground font-mono">API KEY</span>
                {settings?.apiKeyConfigured ? (
                  <Badge variant="outline" className="text-success border-success/30 bg-success/10 gap-1 text-xs">
                    <CheckCircle2 className="w-3 h-3" /> Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-danger border-danger/30 bg-danger/10 gap-1 text-xs">
                    <XCircle className="w-3 h-3" /> Not set
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 bg-background/50 px-3 py-2 rounded-md border border-border/50">
                <span className="text-xs text-muted-foreground font-mono">SECRET KEY</span>
                {settings?.secretKeyConfigured ? (
                  <Badge variant="outline" className="text-success border-success/30 bg-success/10 gap-1 text-xs">
                    <CheckCircle2 className="w-3 h-3" /> Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-danger border-danger/30 bg-danger/10 gap-1 text-xs">
                    <XCircle className="w-3 h-3" /> Not set
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* API Key Setup Checklist */}
          <div className="p-4 rounded-md border border-blue-500/30 bg-blue-500/5 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="text-sm font-semibold text-blue-300">API Key Setup Requirements</span>
            </div>
            <ol className="text-xs text-muted-foreground space-y-1.5 ml-6 list-decimal">
              <li>Go to <a href="https://crypto.com/exchange/personal/api-management" target="_blank" rel="noopener" className="text-primary hover:underline inline-flex items-center gap-0.5">crypto.com/exchange → API Management <ExternalLink className="w-2.5 h-2.5" /></a> — <strong className="text-foreground">not</strong> the main Crypto.com app</li>
              <li>Create a new API key with <strong className="text-foreground">Trading</strong> permission enabled</li>
              <li>
                Add this server IP to the <strong className="text-foreground">IP Whitelist</strong>:{" "}
                <ServerIpBadge />
                <span className="block mt-1 text-yellow-400/80">Warning: Replit/autoscale can change this IP on restart. Use a fixed egress IP before relying on live trading.</span>
              </li>
              <li>Copy the API Key and Secret Key below exactly — no extra spaces</li>
            </ol>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">CDC_API_KEY</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter your Crypto.com Exchange API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiSecret" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">CDC_SECRET_KEY</Label>
              <Input
                id="apiSecret"
                type="password"
                placeholder="Enter your Crypto.com Exchange Secret Key"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="font-mono bg-background"
              />
              <p className="text-xs text-muted-foreground">Leave blank to keep existing keys.</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleSaveKeys}
              disabled={saveKeys.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Save className="w-4 h-4 mr-2" />
              {saveKeys.isPending ? "Saving…" : "Save Keys"}
            </Button>
            <Button
              onClick={() => testConn.mutate()}
              disabled={testConn.isPending}
              variant="outline"
              className="border-primary/40 text-primary hover:bg-primary/10"
            >
              <Activity className="w-4 h-4 mr-2" />
              {testConn.isPending ? "Testing…" : "Test Connection"}
            </Button>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`p-4 rounded-md border ${testResult.success ? "bg-success/10 border-success/30" : "bg-danger/10 border-danger/30"}`}>
              <div className="flex items-center gap-2 mb-2">
                {testResult.success
                  ? <CheckCircle2 className="w-4 h-4 text-success" />
                  : <XCircle className="w-4 h-4 text-danger" />}
                <span className={`font-medium text-sm ${testResult.success ? "text-success" : "text-danger"}`}>
                  {testResult.success ? "Connection Successful" : "Connection Failed"}
                </span>
              </div>
              {testResult.success ? (
                <div className="text-sm space-y-2">
                  {testResult.accountType && (
                    <p className="font-mono text-xs text-muted-foreground">Account type: {testResult.accountType}</p>
                  )}
                  {testResult.balances && testResult.balances.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground mb-2 font-mono uppercase tracking-wider">Non-zero balances</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {testResult.balances.map((b) => (
                          <div key={b.asset} className="bg-background/80 px-2 py-1.5 rounded border border-border/50 font-mono text-xs flex justify-between">
                            <span className="font-bold">{b.asset}</span>
                            <span className="text-muted-foreground">{parseFloat(b.free).toFixed(4)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-danger/80 space-y-1">
                  {testResult.message.split("\n").map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto-Trade Config Card */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="border-b border-border/50 bg-muted/20">
          <CardTitle className="text-lg">Auto-Trade Configuration</CardTitle>
          <CardDescription>Parameters for automatic execution of trading signals on Crypto.com Exchange</CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
            <div className="space-y-1">
              <Label className="text-base font-semibold">Enable Auto-Trade</Label>
              <p className="text-xs text-muted-foreground">Trades will execute on Crypto.com Exchange when a signal exceeds the confidence threshold</p>
            </div>
            <Switch
              checked={autoTradeEnabled}
              onCheckedChange={setAutoTradeEnabled}
              className="data-[state=checked]:bg-primary"
            />
          </div>

          {autoTradeEnabled && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-xs text-yellow-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Auto-trade is active. Market orders will be placed on Crypto.com Exchange for signals above the confidence threshold. Real funds will be used.</span>
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Min Confidence</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0} max={100}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(parseNum(e.target.value))}
                  className="bg-background font-mono"
                />
                <span className="text-muted-foreground font-mono text-sm">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Only execute trades above this score</p>
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Take Profit</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0.01} max={20} step={0.1}
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(parseNum(e.target.value))}
                  className="bg-background font-mono text-success"
                />
                <span className="text-muted-foreground font-mono text-sm">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Target profit per trade</p>
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Stop Loss</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0.01} max={10} step={0.1}
                  value={stopLoss}
                  onChange={(e) => setStopLoss(parseNum(e.target.value))}
                  className="bg-background font-mono text-danger"
                />
                <span className="text-muted-foreground font-mono text-sm">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Maximum loss per trade</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              onClick={handleSaveConfig}
              disabled={saveConfig.isPending}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Save className="w-4 h-4 mr-2" />
              {saveConfig.isPending ? "Saving…" : "Save Configuration"}
            </Button>
            <Button
              onClick={() => killSwitch.mutate()}
              disabled={killSwitch.isPending}
              variant="destructive"
              className="w-full"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              {killSwitch.isPending ? "Stopping…" : "Emergency Stop Auto-Trade"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
