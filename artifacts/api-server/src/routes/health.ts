import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import https from "https";

const router: IRouter = Router();
const ipv4Agent = new https.Agent({ family: 4 });

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

function fetchFromUrl(url: string, agent?: https.Agent): Promise<string> {
  return new Promise((resolve, reject) => {
    const opts = agent ? { agent } : {};
    https.get(url, opts, (r) => {
      let data = "";
      r.on("data", (c: Buffer) => { data += c.toString(); });
      r.on("end", () => resolve(data.trim()));
    }).on("error", reject);
  });
}

function firstAvailable(...values: string[]): string {
  return values.find((value) => value && value !== "unavailable" && value !== "none") ?? "unavailable";
}

// Fetch all IPs in parallel — shows what different services see
// ipv4: what IPv4-only service sees (what whitelist should have)
// ipv6: what IPv6-preferring service sees (might be what CDC sees)
// aws:  what AWS sees (neutral)
let cache: { ipv4: string; ipv6: string; aws: string; at: number } | null = null;

async function refreshCache() {
  const [ipv4, ipv6, aws] = await Promise.allSettled([
    fetchFromUrl("https://api4.ipify.org", ipv4Agent),
    fetchFromUrl("https://api6.ipify.org"),
    fetchFromUrl("https://checkip.amazonaws.com"),
  ]);
  cache = {
    ipv4: ipv4.status === "fulfilled" ? ipv4.value : "unavailable",
    ipv6: ipv6.status === "fulfilled" ? ipv6.value : "none",
    aws:  aws.status  === "fulfilled" ? aws.value  : "unavailable",
    at: Date.now(),
  };
  return cache;
}

export async function getServerIp(): Promise<string> {
  if (cache && Date.now() - cache.at < 3 * 60 * 1000) {
    return firstAvailable(cache.ipv4, cache.aws);
  }
  const c = await refreshCache();
  return firstAvailable(c.ipv4, c.aws);
}

router.get("/server-info", async (_req, res) => {
  if (cache && Date.now() - cache.at < 3 * 60 * 1000) {
    res.json({ ip: firstAvailable(cache.ipv4, cache.aws), ipv4: cache.ipv4, ipv6: cache.ipv6, aws: cache.aws });
    return;
  }
  const [ipv4, ipv6, aws] = await Promise.allSettled([
    fetchFromUrl("https://api4.ipify.org", ipv4Agent),
    fetchFromUrl("https://api6.ipify.org"),
    fetchFromUrl("https://checkip.amazonaws.com"),
  ]);
  cache = {
    ipv4: ipv4.status === "fulfilled" ? ipv4.value : "unavailable",
    ipv6: ipv6.status === "fulfilled" ? ipv6.value : "none",
    aws:  aws.status  === "fulfilled" ? aws.value  : "unavailable",
    at: Date.now(),
  };
  res.json({ ip: firstAvailable(cache.ipv4, cache.aws), ipv4: cache.ipv4, ipv6: cache.ipv6, aws: cache.aws });
});

export default router;
