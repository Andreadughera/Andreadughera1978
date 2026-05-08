import { getKlines } from "./binance";
import { logger } from "./logger";
import { TRACKED_SYMBOLS } from "./binance";

export interface CorrelationEntry {
  symbolA: string;
  symbolB: string;
  correlation: number;
}

export interface CorrelationMatrix {
  symbols: string[];
  matrix: number[][];
  updatedAt: string;
}

// Cache for 30 min — correlation doesn't change rapidly
let correlationCache: { data: CorrelationMatrix; expiresAt: number } | null = null;

/** Pearson correlation between two return series. */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const xa = a.slice(0, n);
  const xb = b.slice(0, n);

  const meanA = xa.reduce((s, v) => s + v, 0) / n;
  const meanB = xb.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denA = 0;
  let denB = 0;

  for (let i = 0; i < n; i++) {
    const da = xa[i] - meanA;
    const db = xb[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const den = Math.sqrt(denA * denB);
  if (den === 0) return 0;
  return Math.round((num / den) * 1000) / 1000;
}

/** Compute hourly returns from close prices. */
function toReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] === 0) { returns.push(0); continue; }
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return returns;
}

/**
 * Build correlation matrix for all tracked symbols using 24h of 1h returns.
 * Runs in background — heavy operation, cached 30 min.
 */
export async function buildCorrelationMatrix(): Promise<CorrelationMatrix> {
  const now = Date.now();
  if (correlationCache && now < correlationCache.expiresAt) return correlationCache.data;

  // Only use main liquid pairs for the matrix (faster)
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "XRPUSDT", "DOTUSDT", "AVAXUSDT", "LINKUSDT", "BNBUSDT", "MATICUSDT"];

  try {
    // Fetch 24 hourly closes for each symbol
    const returnSeries: Map<string, number[]> = new Map();

    await Promise.allSettled(
      symbols.map(async (sym) => {
        try {
          const klines = await getKlines(sym, "1h", 48);
          const closes = klines.map((k) => parseFloat(k.close));
          returnSeries.set(sym, toReturns(closes));
        } catch {
          // Skip this symbol
        }
      }),
    );

    const validSymbols = symbols.filter((s) => returnSeries.has(s));
    const n = validSymbols.length;
    const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1.0; // diagonal
      for (let j = i + 1; j < n; j++) {
        const r = pearsonCorrelation(returnSeries.get(validSymbols[i])!, returnSeries.get(validSymbols[j])!);
        matrix[i][j] = r;
        matrix[j][i] = r;
      }
    }

    const result: CorrelationMatrix = {
      symbols: validSymbols,
      matrix,
      updatedAt: new Date().toISOString(),
    };

    correlationCache = { data: result, expiresAt: now + 30 * 60 * 1000 };
    logger.info({ symbols: validSymbols.length }, "Correlation matrix built");
    return result;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Correlation matrix build failed");
    return correlationCache?.data ?? { symbols, matrix: [], updatedAt: new Date().toISOString() };
  }
}

/**
 * Check if `symbol` is highly correlated with any of the `openSymbols`.
 * Returns the most-correlated open symbol if threshold exceeded.
 */
export async function findHighlyCorrelatedPosition(
  symbol: string,
  openSymbols: string[],
  threshold = 0.80,
): Promise<{ correlated: boolean; withSymbol?: string; correlation?: number }> {
  if (openSymbols.length === 0) return { correlated: false };

  try {
    const matrix = await buildCorrelationMatrix();
    const symIdx = matrix.symbols.indexOf(symbol);
    if (symIdx === -1) return { correlated: false };

    for (const openSym of openSymbols) {
      const openIdx = matrix.symbols.indexOf(openSym);
      if (openIdx === -1) continue;
      const corr = matrix.matrix[symIdx]?.[openIdx] ?? 0;
      if (corr >= threshold) {
        return { correlated: true, withSymbol: openSym, correlation: corr };
      }
    }

    return { correlated: false };
  } catch {
    return { correlated: false };
  }
}
