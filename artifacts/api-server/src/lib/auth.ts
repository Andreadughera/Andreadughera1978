import crypto from "crypto";
import { Router, type NextFunction, type Request, type Response } from "express";

const COOKIE_NAME = "crypto_sentinel_session";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function getAdminPassword(): string | null {
  return (process.env.DASHBOARD_PASSWORD ?? process.env.API_ADMIN_TOKEN ?? "").trim() || null;
}

function getSessionSecret(): string | null {
  return (
    process.env.SESSION_SECRET ??
    process.env.SETTINGS_ENCRYPTION_KEY ??
    process.env.DASHBOARD_PASSWORD ??
    process.env.API_ADMIN_TOKEN ??
    ""
  ).trim() || null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function useSecureCookie(): boolean {
  return process.env.COOKIE_SECURE === "true";
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sign(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createSessionToken(secret: string): string {
  const payload = JSON.stringify({
    iat: Date.now(),
    nonce: crypto.randomBytes(16).toString("base64url"),
  });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

function isValidSessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || !safeEqual(signature, sign(encoded, secret))) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      iat?: number;
    };
    return typeof payload.iat === "number" && Date.now() - payload.iat < SESSION_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function isPublicEndpoint(req: Request): boolean {
  if (req.method === "GET" && req.path === "/healthz") return true;
  if (req.path === "/auth/status") return true;
  if (req.path === "/auth/login") return true;
  if (req.path === "/auth/logout") return true;
  return false;
}

export function isAuthConfigured(): boolean {
  return !!getAdminPassword() && !!getSessionSecret();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isPublicEndpoint(req)) {
    next();
    return;
  }

  const password = getAdminPassword();
  const secret = getSessionSecret();

  if (!password || !secret) {
    if (!isProduction()) {
      next();
      return;
    }
    res.status(503).json({
      error: "Dashboard authentication is not configured. Set DASHBOARD_PASSWORD and SESSION_SECRET.",
    });
    return;
  }

  const authHeader = req.header("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (bearer && safeEqual(bearer, password)) {
    next();
    return;
  }

  if (isValidSessionToken(req.cookies?.[COOKIE_NAME], secret)) {
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required" });
}

export const authRouter = Router();

authRouter.get("/auth/status", (req, res) => {
  const secret = getSessionSecret();
  const configured = isAuthConfigured();
  res.json({
    authRequired: configured || isProduction(),
    configured,
    authenticated: configured && secret ? isValidSessionToken(req.cookies?.[COOKIE_NAME], secret) : !isProduction(),
  });
});

authRouter.post("/auth/login", (req, res) => {
  const password = getAdminPassword();
  const secret = getSessionSecret();
  if (!password || !secret) {
    res.status(503).json({
      error: "Dashboard authentication is not configured. Set DASHBOARD_PASSWORD and SESSION_SECRET.",
    });
    return;
  }

  const candidate = typeof req.body?.password === "string" ? req.body.password : "";
  if (!safeEqual(candidate, password)) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  res.cookie(COOKIE_NAME, createSessionToken(secret), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_MS,
    sameSite: "strict",
    secure: useSecureCookie(),
  });
  res.json({ authenticated: true });
});

authRouter.post("/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: useSecureCookie(),
  });
  res.json({ authenticated: false });
});
